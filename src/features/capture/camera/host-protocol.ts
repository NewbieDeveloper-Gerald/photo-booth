/**
 * The wire protocol between the booth's main process and the camera host (the .NET process that
 * owns Canon's EDSDK). One framing for everything:
 *
 *     [ 4 bytes big-endian length ][ 1 byte kind ][ payload of length - 1 bytes ]
 *
 * JSON control messages and JPEG live-view frames share the stream, so a frame can never be
 * mistaken for a reply and a reply can never be lost behind a frame. The parser is deliberately
 * incremental: a frame arrives in several chunks on a real serial bus and two replies can arrive
 * in one chunk.
 */
export const FRAME_KIND_CONTROL = 1;
export const FRAME_KIND_LIVE_VIEW = 2;

export type HostRequest = { id: number; method: string; params?: unknown };
export type HostSuccess = { id: number; ok: true; result: unknown };
export type HostFailure = { id: number; ok: false; error: { code: string; message: string } };
export type HostReply = HostSuccess | HostFailure;

/** What the operator panel shows about the helper process. */
export type CameraHostStatus = {
  /** The program exists on this machine at all (false means EDSDK was never installed here). */
  available: boolean;
  /** A live child process right now. */
  connected: boolean;
  /** How many times it had to be restarted since the booth started. */
  restarts: number;
  /** Operator wording for why it is not connected; null while healthy. */
  reason: string | null;
};

export type HostEvent = {
  event: 'battery';
  level: number;
  /** The camera's own wording, e.g. "Battery OK" or "Half charge". */
  label: string;
} | {
  event: 'media';
  /** Shots still available on the card, when the body reports it. */
  remaining: number | null;
} | {
  event: 'error';
  code: string;
  message: string;
} | {
  event: 'disconnected';
  message: string;
};

export function isHostReply(value: unknown): value is HostReply {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HostReply>;
  return typeof candidate.id === 'number' && typeof candidate.ok === 'boolean';
}

export function isHostEvent(value: unknown): value is HostEvent {
  return typeof value === 'object' && value !== null && typeof (value as { event?: unknown }).event === 'string';
}

const HEADER_BYTES = 5;
const KIND_OFFSET = 4;

/** One complete message, ready to be written to the host's stdin. */
export function encodeFrame(kind: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length + 1, false);
  frame[KIND_OFFSET] = kind;
  frame.set(payload, HEADER_BYTES);
  return frame;
}

export function encodeControl(message: unknown): Uint8Array {
  return encodeFrame(FRAME_KIND_CONTROL, new TextEncoder().encode(JSON.stringify(message)));
}

/**
 * Feeds arbitrary chunks in and calls back once per complete message. Throws on a length that the
 * protocol could produce only if both sides disagreed about it, because continuing would hand the
 * caller misaligned bytes forever.
 */
export function createFrameParser(onFrame: (kind: number, payload: Uint8Array) => void): (chunk: Uint8Array) => void {
  let buffer = new Uint8Array(0);
  return (chunk: Uint8Array): void => {
    if (buffer.length === 0) {
      buffer = chunk.slice();
    } else {
      const merged = new Uint8Array(buffer.length + chunk.length);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.length);
      buffer = merged;
    }
    for (;;) {
      if (buffer.length < HEADER_BYTES) return;
      const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0, false);
      if (length < 1) throw new Error('The camera host sent a message with no kind byte.');
      if (buffer.length < 4 + length) return;
      const kind = buffer[KIND_OFFSET]!;
      const payload = buffer.slice(HEADER_BYTES, 4 + length);
      onFrame(kind, payload);
      buffer = buffer.slice(4 + length);
    }
  };
}

/** Decodes one control payload; anything that is not a reply or an event is dropped, not thrown. */
export function decodeControl(payload: Uint8Array): HostReply | HostEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (isHostReply(parsed)) return parsed;
  if (isHostEvent(parsed)) return parsed;
  return null;
}
