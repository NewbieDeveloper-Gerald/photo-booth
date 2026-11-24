import { describe, expect, it } from 'vitest';
import {
  MAX_CLIENT_FRAME_BYTES, WebSocketProtocolError, acceptKey, decodeClientFrames, encodeCloseFrame, encodePingFrame,
  encodePongFrame, encodeTextFrame,
} from './websocket-frame';

/** A client frame the way a browser sends it: masked, with the mask over the payload. */
function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) masked[index] = masked[index]! ^ mask[index % 4]!;
  const length = payload.length;
  const header = length < 126
    ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | length])
    : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, length >> 8, length & 0xff]);
  return Buffer.concat([header, mask, masked]);
}

describe('WebSocket frames (F22)', () => {
  it('computes the handshake answer the RFC specifies', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('writes unmasked text, ping, pong and close frames the browser can read', () => {
    expect(encodeTextFrame('hi')).toEqual(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    expect(encodePingFrame()).toEqual(Buffer.from([0x89, 0x00]));
    expect(encodePongFrame(Buffer.from('x'))).toEqual(Buffer.from([0x8a, 0x01, 0x78]));
    expect(encodeCloseFrame(1000)).toEqual(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
    const long = 'x'.repeat(200);
    const frame = encodeTextFrame(long);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(200);
  });

  it('reads masked client frames and keeps an incomplete tail for the next packet', () => {
    const first = maskedFrame(0x1, Buffer.from('{"type":"start"}'));
    const second = maskedFrame(0x1, Buffer.from('{"type":"done"}'));
    const { frames, rest } = decodeClientFrames(Buffer.concat([first, second.subarray(0, 5)]));
    expect(frames).toEqual([{ type: 'text', text: '{"type":"start"}' }]);
    expect(rest.equals(second.subarray(0, 5))).toBe(true);
    expect(decodeClientFrames(rest).frames).toEqual([]);
  });

  it('handles split packets, pings and closes', () => {
    const frame = maskedFrame(0x1, Buffer.from('abc'));
    expect(decodeClientFrames(frame.subarray(0, 3)).frames).toEqual([]);
    const { frames } = decodeClientFrames(frame);
    expect(frames).toEqual([{ type: 'text', text: 'abc' }]);
    expect(decodeClientFrames(maskedFrame(0x9, Buffer.from('p'))).frames).toEqual([{ type: 'ping', payload: Buffer.from('p') }]);
    expect(decodeClientFrames(maskedFrame(0x8, Buffer.from([0x03, 0xe8]))).frames).toEqual([{ type: 'close' }]);
  });

  it('refuses what a browser would never send', () => {
    const unmasked = Buffer.from([0x81, 0x02, 0x68, 0x69]);
    expect(() => decodeClientFrames(unmasked)).toThrow(WebSocketProtocolError);
    expect(() => decodeClientFrames(maskedFrame(0x1, Buffer.from('x'), false))).toThrow(/fragmented/);
    expect(() => decodeClientFrames(maskedFrame(0x2, Buffer.from('binary')))).toThrow(/opcode/);
    const huge = Buffer.alloc(10);
    huge[0] = 0x81; huge[1] = 0x80 | 127;
    huge.writeBigUInt64BE(BigInt(MAX_CLIENT_FRAME_BYTES + 1), 2);
    expect(() => decodeClientFrames(huge)).toThrow(/frame too large/);
  });
});
