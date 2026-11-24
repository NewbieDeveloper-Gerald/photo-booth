// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MockTetherBridge, TetherCameraDevice, TetherCameraError, isTetherDeviceId, type FrameStream } from './tether-camera';
import { TETHER_MODEL } from './dslr-types';

function fakeStream(): FrameStream & { pushed: Uint8Array[]; closed: boolean; stopped: number } {
  const tracks = [{ stop: vi.fn() }];
  const sink = {
    stream: { getTracks: () => tracks } as unknown as MediaStream,
    pushed: [] as Uint8Array[],
    closed: false,
    stopped: 0,
    push: async (jpeg: Uint8Array) => { sink.pushed.push(jpeg); },
    close: () => { sink.closed = true; },
  };
  return sink;
}

describe('tether camera device (F26)', () => {
  it('is only listed when the helper sees a camera', async () => {
    const device = new TetherCameraDevice(new MockTetherBridge());
    expect(await device.listCameras()).toEqual([{ deviceId: TETHER_MODEL.deviceId, label: 'Canon EOS 250D (tethered)' }]);

    const bridge = new MockTetherBridge({ available: false, helper: 'gphoto2', model: 'Canon EOS 250D', cameras: [], reason: 'No camera' });
    expect(await new TetherCameraDevice(bridge).listCameras()).toEqual([]);
  });

  it('turns helper frames into a preview stream', async () => {
    const bridge = new MockTetherBridge();
    const sink = fakeStream();
    const device = new TetherCameraDevice(bridge, () => sink);
    const stream = await device.startPreview(TETHER_MODEL.deviceId, '1920x1080');
    expect(stream).toBe(sink.stream);
    expect(bridge.starts).toBe(1);

    bridge.emit(new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]));
    await vi.waitFor(() => expect(sink.pushed.length).toBe(1));
    expect(Array.from(sink.pushed[0]!)).toEqual([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  });

  it('refuses to open live view when the helper has no camera, in the helper’s words', async () => {
    const bridge = new MockTetherBridge({ available: false, helper: 'gphoto2', model: 'Canon EOS 250D', cameras: [], reason: 'No Canon EOS 250D was found. Check the USB cable.' });
    const device = new TetherCameraDevice(bridge, () => fakeStream());
    await expect(device.startPreview(TETHER_MODEL.deviceId, 'best')).rejects.toThrow('No Canon EOS 250D was found');
    await expect(device.startPreview(TETHER_MODEL.deviceId, 'best')).rejects.toBeInstanceOf(TetherCameraError);
    await expect(device.startPreview('webcam-1', 'best')).rejects.toBeInstanceOf(TetherCameraError);
  });

  it('closes the preview it opened when live view cannot start', async () => {
    const bridge = new MockTetherBridge();
    const sink = fakeStream();
    bridge.startLiveView = async () => { throw new Error('Live view stopped: camera unplugged'); };
    const device = new TetherCameraDevice(bridge, () => sink);
    await expect(device.startPreview(TETHER_MODEL.deviceId, 'best')).rejects.toThrow('camera unplugged');
    expect(sink.closed).toBe(true);
  });

  it('stops the preview and the helper together, and hands over a real still', async () => {
    const bridge = new MockTetherBridge();
    const sink = fakeStream();
    const device = new TetherCameraDevice(bridge, () => sink);
    await device.startPreview(TETHER_MODEL.deviceId, 'best');
    device.stopPreview(sink.stream);
    await vi.waitFor(() => expect(bridge.stops).toBe(1));
    expect((sink.stream.getTracks()[0] as unknown as { stop: () => void })).toBeDefined();

    const still = await device.captureStill();
    expect(Array.from(still)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(bridge.captures).toBe(1);
  });

  it('passes a dead live view on to the booth screen', async () => {
    const bridge = new MockTetherBridge();
    const onLiveViewError = vi.fn();
    const device = new TetherCameraDevice(bridge, () => fakeStream(), onLiveViewError);
    await device.startPreview(TETHER_MODEL.deviceId, 'best');
    bridge.fail('Live view stopped: the camera is busy');
    expect(onLiveViewError).toHaveBeenCalledWith('Live view stopped: the camera is busy');
  });

  it('recognises the tether device id and nothing else', () => {
    expect(isTetherDeviceId(TETHER_MODEL.deviceId)).toBe(true);
    expect(isTetherDeviceId('abc123')).toBe(false);
    expect(isTetherDeviceId(undefined)).toBe(false);
  });
});
