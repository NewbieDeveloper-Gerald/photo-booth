import { createHash } from 'node:crypto';

/**
 * The slice of RFC 6455 the tablet screen needs (F22): a text-only WebSocket server, no
 * dependency, no extensions, no compression. Browsers mask what they send and the server
 * answers unmasked, one frame at a time.
 */
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODE = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa } as const;
/** State snapshots are a few hundred bytes; anything bigger is not this protocol. */
export const MAX_CLIENT_FRAME_BYTES = 16_384;

export type ClientFrame =
  | { type: 'text'; text: string }
  | { type: 'close' }
  | { type: 'ping'; payload: Buffer }
  | { type: 'pong'; payload: Buffer };

export class WebSocketProtocolError extends Error {}

export function acceptKey(clientKey: string): string {
  return createHash('sha1').update(`${clientKey}${WEBSOCKET_GUID}`).digest('base64');
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header = length < 126
    ? Buffer.from([0x80 | opcode, length])
    : length < 65_536
      ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
      : (() => { const big = Buffer.alloc(10); big[0] = 0x80 | opcode; big[1] = 127; big.writeBigUInt64BE(BigInt(length), 2); return big; })();
  return Buffer.concat([header, payload]);
}

export function encodeTextFrame(text: string): Buffer {
  return frame(OPCODE.text, Buffer.from(text, 'utf8'));
}

export function encodePingFrame(payload: Buffer = Buffer.alloc(0)): Buffer {
  return frame(OPCODE.ping, payload.subarray(0, 125));
}

export function encodePongFrame(payload: Buffer): Buffer {
  return frame(OPCODE.pong, payload.subarray(0, 125));
}

export function encodeCloseFrame(code = 1000): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return frame(OPCODE.close, payload);
}

/**
 * Reads whatever complete client frames the buffer holds and returns the rest untouched, so a
 * frame split across TCP packets is simply read on the next chunk. A protocol violation throws:
 * the caller closes that socket rather than guessing.
 */
export function decodeClientFrames(buffer: Buffer): { frames: ClientFrame[]; rest: Buffer } {
  const frames: ClientFrame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (!masked) throw new WebSocketProtocolError('client frames must be masked');
    if (!fin) throw new WebSocketProtocolError('fragmented frames are not supported');
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (big > BigInt(MAX_CLIENT_FRAME_BYTES)) throw new WebSocketProtocolError('frame too large');
      length = Number(big);
      cursor += 8;
    }
    if (length > MAX_CLIENT_FRAME_BYTES) throw new WebSocketProtocolError('frame too large');
    if (opcode >= 0x8 && length > 125) throw new WebSocketProtocolError('control frame too large');
    if (buffer.length - cursor < 4 + length) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
    cursor += length;
    switch (opcode) {
      case OPCODE.text: frames.push({ type: 'text', text: payload.toString('utf8') }); break;
      case OPCODE.close: frames.push({ type: 'close' }); break;
      case OPCODE.ping: frames.push({ type: 'ping', payload }); break;
      case OPCODE.pong: frames.push({ type: 'pong', payload }); break;
      default: throw new WebSocketProtocolError(`unsupported opcode ${opcode}`);
    }
    offset = cursor;
  }
  return { frames, rest: buffer.subarray(offset) };
}
