import {
  FRAME_KIND_CONTROL, FRAME_KIND_LIVE_VIEW, createFrameParser, decodeControl, encodeControl,
  type HostEvent,
} from './host-protocol';

/**
 * The main process's side of the camera host: it owns one long-lived child process, numbers the
 * requests, and answers only what was asked. Every call has a deadline — a camera that stops
 * answering must not freeze a booth mid-session — and a host that dies rejects everything in
 * flight instead of leaving promises hanging until the next guest.
 */
export type HostTransport = {
  write(bytes: Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: (reason: string) => void): void;
  kill(): void;
};

export class CameraHostError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CameraHostError';
  }
}

export type CameraHostClientOptions = {
  transport: HostTransport;
  /** How long one helper call may take before the booth gives up on it. */
  requestTimeoutMs?: number;
  onFrame?: (jpeg: Uint8Array) => void;
  onEvent?: (event: HostEvent) => void;
  onClosed?: (reason: string) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type CameraHostClient = {
  call<T>(method: string, params?: unknown): Promise<T>;
  pendingCount: () => number;
  dispose: (reason?: string) => void;
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** A still is downloaded after the shutter, which on a slow card can take a while. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

export function createCameraHostClient(options: CameraHostClientOptions): CameraHostClient {
  const {
    transport, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, onFrame, onEvent, onClosed,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: unknown;
  }>();

  const failAll = (error: Error): void => {
    for (const [, entry] of pending) {
      clearTimer(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const parse = createFrameParser((kind, payload) => {
    if (kind === FRAME_KIND_LIVE_VIEW) {
      onFrame?.(payload);
      return;
    }
    if (kind !== FRAME_KIND_CONTROL) return;
    const message = decodeControl(payload);
    if (!message) return;
    if ('event' in message) {
      onEvent?.(message);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimer(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new CameraHostError(message.error.code, message.error.message));
  });

  transport.onData(parse);
  transport.onClose((reason) => {
    disposed = true;
    failAll(new CameraHostError('closed', reason || 'The camera host stopped.'));
    onClosed?.(reason);
  });

  const call = <T>(method: string, params?: unknown): Promise<T> => {
    if (disposed) return Promise.reject(new CameraHostError('closed', 'The camera host is not running.'));
    const id = nextId++;
    const timeoutMs = method === 'download' ? DOWNLOAD_TIMEOUT_MS : requestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimer(() => {
        pending.delete(id);
        reject(new CameraHostError('timeout', `The camera did not answer "${method}" in time.`));
      }, timeoutMs);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        transport.write(encodeControl({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        clearTimer(timer);
        reject(error instanceof Error ? error : new CameraHostError('write-failed', 'Could not talk to the camera host.'));
      }
    });
  };

  return {
    call,
    pendingCount: () => pending.size,
    dispose: (reason = 'The booth closed the camera.') => {
      if (disposed) return;
      disposed = true;
      failAll(new CameraHostError('closed', reason));
      transport.kill();
      onClosed?.(reason);
    },
  };
}
