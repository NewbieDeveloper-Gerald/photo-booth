import { CameraHostError, createCameraHostClient, type CameraHostClient, type HostTransport } from './host-client';
import type { CameraHostStatus, HostEvent } from './host-protocol';

/**
 * The camera host is a child process, and a child process dies: a camera unplugged at the USB
 * level, a driver update, an EDSDK fault. The supervisor is what keeps that from being the
 * operator's problem — reconnect with a growing backoff, say so in the panel, and give up loudly
 * after a few tries instead of spawning a process per frame forever.
 */
export const DEFAULT_BACKOFF_MS = 1_500;
export const DEFAULT_MAX_RESTARTS = 5;

export type SupervisorOptions = {
  /** Spawns the host and wires its stdio. Throws when the program is not installed. */
  connect: () => HostTransport;
  requestTimeoutMs?: number;
  backoffMs?: number;
  maxRestarts?: number;
  onFrame?: (jpeg: Uint8Array) => void;
  onEvent?: (event: HostEvent) => void;
  onStatus?: (status: CameraHostStatus) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type CameraHostSupervisor = {
  call: <T>(method: string, params?: unknown) => Promise<T>;
  status: () => CameraHostStatus;
  dispose: () => void;
};

export const HOST_MISSING_REASON = 'The camera host is not installed, so the DSLR cannot be used. Reinstall Boothwright, or keep using the webcam.';

function isMissingProgram(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === 'ENOENT' || (error instanceof Error && /ENOENT/.test(error.message));
}

export function createCameraHostSupervisor(options: SupervisorOptions): CameraHostSupervisor {
  const {
    connect, requestTimeoutMs, backoffMs = DEFAULT_BACKOFF_MS, maxRestarts = DEFAULT_MAX_RESTARTS,
    onFrame, onEvent, onStatus,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let client: CameraHostClient | null = null;
  let timer: unknown = null;
  let disposed = false;
  let restarts = 0;
  let state: CameraHostStatus = { available: false, connected: false, restarts: 0, reason: 'The camera host has not started yet.' };

  const publish = (next: CameraHostStatus): void => {
    state = next;
    onStatus?.(next);
  };

  const open = (): void => {
    if (disposed) return;
    try {
      client = createCameraHostClient({
        transport: connect(), requestTimeoutMs, onFrame, onEvent,
        onClosed: (reason) => { client = null; scheduleRestart(reason); },
        setTimer, clearTimer,
      });
      publish({ available: true, connected: true, restarts, reason: null });
    } catch (error) {
      client = null;
      if (isMissingProgram(error)) {
        publish({ available: false, connected: false, restarts, reason: HOST_MISSING_REASON });
        return;
      }
      const message = error instanceof Error ? error.message : 'The camera host could not start.';
      scheduleRestart(message);
    }
  };

  const scheduleRestart = (reason: string): void => {
    if (disposed) return;
    restarts += 1;
    if (restarts > maxRestarts) {
      publish({ available: false, connected: false, restarts, reason: `The camera host stopped ${restarts - 1} times: ${reason}` });
      return;
    }
    publish({ available: true, connected: false, restarts, reason });
    timer = setTimer(() => { timer = null; open(); }, backoffMs * restarts);
  };

  open();

  return {
    call: <T>(method: string, params?: unknown): Promise<T> => {
      const active = client;
      if (!active) {
        return Promise.reject(new CameraHostError('not-running', state.reason ?? 'The camera host is not running.'));
      }
      // An answered call is the only proof the host is healthy again: a process that spawns and
      // then dies on the first request must still spend its restart budget.
      return active.call<T>(method, params).then((result) => {
        if (restarts > 0) {
          restarts = 0;
          publish({ available: true, connected: true, restarts, reason: null });
        }
        return result;
      });
    },
    status: () => state,
    dispose: () => {
      disposed = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      client?.dispose('The booth is closing.');
      client = null;
      publish({ available: false, connected: false, restarts, reason: 'The booth closed the camera host.' });
    },
  };
}
