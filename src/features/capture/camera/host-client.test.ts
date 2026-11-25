import { describe, expect, it, vi } from 'vitest';
import { CameraHostError, createCameraHostClient, type HostTransport } from './host-client';
import { encodeControl, encodeFrame, FRAME_KIND_LIVE_VIEW } from './host-protocol';

function fakeTransport(): HostTransport & { written: Uint8Array[]; emit: (bytes: Uint8Array) => void; close: (reason?: string) => void; killed: boolean } {
  let data: (chunk: Uint8Array) => void = () => undefined;
  let closed: (reason: string) => void = () => undefined;
  const transport = {
    written: [] as Uint8Array[],
    killed: false,
    write(bytes: Uint8Array) { transport.written.push(bytes); },
    onData(listener: (chunk: Uint8Array) => void) { data = listener; },
    onClose(listener: (reason: string) => void) { closed = listener; },
    kill() { transport.killed = true; },
    emit(bytes: Uint8Array) { data(bytes); },
    close(reason = 'gone') { closed(reason); },
  };
  return transport;
}

/** Reads the request the client wrote, so a test can answer it the way the host would. */
function lastRequest(frame: Uint8Array): { id: number; method: string; params?: unknown } {
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
  const json = new TextDecoder().decode(frame.subarray(5, 4 + length));
  const request = JSON.parse(json) as { id?: unknown; method?: unknown };
  if (typeof request.id !== 'number' || typeof request.method !== 'string') throw new Error('no request was written');
  return request as { id: number; method: string };
}

describe('camera host client', () => {
  it('numbers a request, sends it, and resolves with the matching reply', async () => {
    const transport = fakeTransport();
    const client = createCameraHostClient({ transport });
    const pending = client.call<{ model: string }>('list');
    const request = lastRequest(transport.written[0]!);
    expect(request.method).toBe('list');
    transport.emit(encodeControl({ id: request.id, ok: true, result: { model: 'Canon EOS 200D' } }));
    await expect(pending).resolves.toEqual({ model: 'Canon EOS 200D' });
    expect(client.pendingCount()).toBe(0);
  });

  it('turns a host failure into a typed error with the host’s own sentence', async () => {
    const transport = fakeTransport();
    const client = createCameraHostClient({ transport });
    const pending = client.call('open');
    const request = lastRequest(transport.written[0]!);
    transport.emit(encodeControl({ id: request.id, ok: false, error: { code: 'no-camera', message: 'No camera is connected.' } }));
    await expect(pending).rejects.toBeInstanceOf(CameraHostError);
    await expect(pending).rejects.toThrow('No camera is connected.');
  });

  it('gives up on a call the camera never answers, instead of freezing the booth', async () => {
    const timers: Array<() => void> = [];
    const transport = fakeTransport();
    const client = createCameraHostClient({
      transport,
      setTimer: (callback) => { timers.push(callback); return timers.length; },
      clearTimer: () => undefined,
    });
    const pending = client.call('focus');
    timers.forEach((callback) => callback());
    await expect(pending).rejects.toThrow('did not answer "focus" in time');
    expect(client.pendingCount()).toBe(0);
  });

  it('rejects everything in flight when the host dies, then refuses new calls', async () => {
    const transport = fakeTransport();
    const onClosed = vi.fn();
    const client = createCameraHostClient({ transport, onClosed });
    const pending = client.call('download');
    transport.close('the camera was unplugged');
    await expect(pending).rejects.toThrow('the camera was unplugged');
    expect(onClosed).toHaveBeenCalledTimes(1);
    await expect(client.call('list')).rejects.toMatchObject({ code: 'closed' });
  });

  it('routes live-view frames to the frame callback and events to the event callback', () => {
    const transport = fakeTransport();
    const onFrame = vi.fn();
    const onEvent = vi.fn();
    createCameraHostClient({ transport, onFrame, onEvent });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    transport.emit(new Uint8Array([
      ...encodeFrame(FRAME_KIND_LIVE_VIEW, jpeg),
      ...encodeControl({ event: 'battery', level: 55, label: 'Half charge' }),
    ]));
    expect(onFrame).toHaveBeenCalledWith(jpeg);
    expect(onEvent).toHaveBeenCalledWith({ event: 'battery', level: 55, label: 'Half charge' });
  });

  it('kills the child when the booth closes the camera', () => {
    const transport = fakeTransport();
    const client = createCameraHostClient({ transport });
    client.dispose();
    expect(transport.killed).toBe(true);
  });
});
