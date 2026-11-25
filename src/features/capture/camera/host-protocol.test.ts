import { describe, expect, it, vi } from 'vitest';
import {
  FRAME_KIND_CONTROL, FRAME_KIND_LIVE_VIEW, createFrameParser, decodeControl, encodeControl, encodeFrame,
  isHostEvent, isHostReply, type HostReply,
} from './host-protocol';

function collect(): { frames: Array<{ kind: number; payload: Uint8Array }>; push: (chunk: Uint8Array) => void } {
  const frames: Array<{ kind: number; payload: Uint8Array }> = [];
  const push = createFrameParser((kind, payload) => frames.push({ kind, payload }));
  return { frames, push };
}

describe('camera host protocol', () => {
  it('round-trips one control message', () => {
    const { frames, push } = collect();
    push(encodeControl({ id: 7, ok: true, result: { model: 'Canon EOS 200D' } }));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind).toBe(FRAME_KIND_CONTROL);
    expect(decodeControl(frames[0]!.payload)).toEqual({ id: 7, ok: true, result: { model: 'Canon EOS 200D' } });
  });

  it('carries a live-view frame next to control messages without mixing them up', () => {
    const { frames, push } = collect();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const stream = new Uint8Array([...encodeFrame(FRAME_KIND_LIVE_VIEW, jpeg), ...encodeControl({ event: 'battery', level: 80, label: 'Battery OK' })]);
    push(stream);
    expect(frames.map((frame) => frame.kind)).toEqual([FRAME_KIND_LIVE_VIEW, FRAME_KIND_CONTROL]);
    expect([...frames[0]!.payload]).toEqual([...jpeg]);
    expect(decodeControl(frames[1]!.payload)).toEqual({ event: 'battery', level: 80, label: 'Battery OK' });
  });

  it('waits for the rest of a frame that arrives in pieces', () => {
    const { frames, push } = collect();
    const whole = encodeControl({ id: 1, ok: true, result: null });
    for (const byte of whole) push(new Uint8Array([byte]));
    expect(frames).toHaveLength(1);
  });

  it('decodes several messages from one chunk', () => {
    const { frames, push } = collect();
    const one = encodeControl({ id: 1, ok: true, result: 1 });
    const two = encodeControl({ id: 2, ok: true, result: 2 });
    push(new Uint8Array([...one, ...two]));
    expect(frames).toHaveLength(2);
  });

  it('refuses a length that could only mean the two sides disagree', () => {
    const { push } = collect();
    expect(() => push(new Uint8Array([0, 0, 0, 0, FRAME_KIND_CONTROL]))).toThrow('no kind byte');
  });

  it('drops a control payload that is not a reply or an event instead of crashing the booth', () => {
    expect(decodeControl(new TextEncoder().encode('not json'))).toBeNull();
    expect(decodeControl(new TextEncoder().encode('{"id":"x"}'))).toBeNull();
  });

  it('tells a reply from an event', () => {
    const reply: unknown = { id: 3, ok: false, error: { code: 'busy', message: 'Camera busy' } };
    const event: unknown = { event: 'error', code: 'e', message: 'm' };
    expect(isHostReply(reply)).toBe(true);
    expect(isHostEvent(reply)).toBe(false);
    expect(isHostEvent(event)).toBe(true);
    const failure = reply as HostReply;
    expect(failure.ok).toBe(false);
  });

  it('does not copy the input buffer, so a caller can reuse its chunk (regression guard)', () => {
    const spy = vi.fn();
    const push = createFrameParser(spy);
    const frame = encodeControl({ id: 1, ok: true, result: null });
    const chunk = frame.slice();
    push(chunk);
    chunk.fill(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
