import { describe, expect, it } from 'vitest';
import { EDSDK_DEVICE_PREFIX, EdsdkCameraDevice, MockCameraHostBridge, isEdsdkDeviceId } from './edsdk-camera';

const deviceId = `${EDSDK_DEVICE_PREFIX}0`;

function sink() {
  const frames: Uint8Array[] = [];
  return {
    frames,
    factory: () => ({ stream: { getTracks: () => [] } as unknown as MediaStream, push: async (jpeg: Uint8Array) => { frames.push(jpeg); }, close: () => undefined }),
  };
}

describe('EDSDK camera (Phase 1)', () => {
  it('lists the camera only when the host is installed, so the picker never shows a dead body', async () => {
    const available = new EdsdkCameraDevice(new MockCameraHostBridge(), sink().factory);
    expect(await available.listCameras()).toHaveLength(1);

    const bridge = new MockCameraHostBridge({ available: false, connected: false, restarts: 0, reason: 'No camera host.' });
    expect(await new EdsdkCameraDevice(bridge, sink().factory).listCameras()).toEqual([]);
  });

  it('runs live view as JPEG frames pushed into the canvas stream', async () => {
    const bridge = new MockCameraHostBridge();
    const fake = sink();
    const device = new EdsdkCameraDevice(bridge, fake.factory);
    const stream = await device.startPreview(deviceId, 'best');
    expect(stream).toBeDefined();
    bridge.emit(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    await Promise.resolve();
    expect(fake.frames).toHaveLength(1);
    device.stopPreview(stream);
    expect(bridge.stops).toBe(1);
  });

  it('reports a live view that dies after it started', async () => {
    const messages: string[] = [];
    const bridge = new MockCameraHostBridge();
    const device = new EdsdkCameraDevice(bridge, sink().factory, (message) => messages.push(message));
    await device.startPreview(deviceId, 'best');
    bridge.fail('The camera was unplugged.');
    expect(messages).toEqual(['The camera was unplugged.']);
  });

  it('refuses a camera id that is not the EDSDK camera', async () => {
    const device = new EdsdkCameraDevice(new MockCameraHostBridge(), sink().factory);
    await expect(device.startPreview('webcam-1', 'best')).rejects.toThrow('not the EDSDK camera');
  });

  it('applies only the settings the body offers, and names the ones it dropped', async () => {
    const bridge = new MockCameraHostBridge();
    const device = new EdsdkCameraDevice(bridge, sink().factory);
    const result = await device.applySettings(deviceId, 'capture', { iso: '3200', aperture: 'f/1.4', quality: 'raw' });
    expect(result.applied).toEqual({ iso: '3200' });
    expect(result.ignored).toEqual(['aperture', 'quality']);
    expect(bridge.applied).toEqual([{ role: 'capture', settings: { iso: '3200' } }]);
  });

  it('keeps the live-view and capture settings apart all the way to the host', async () => {
    const bridge = new MockCameraHostBridge();
    const device = new EdsdkCameraDevice(bridge, sink().factory);
    await device.applySettings(deviceId, 'liveView', { iso: '3200' });
    await device.applySettings(deviceId, 'capture', { iso: '100' });
    expect(bridge.applied.map((entry) => entry.role)).toEqual(['liveView', 'capture']);
    expect((await device.settings(deviceId))).toEqual({ liveView: { iso: '3200' }, capture: { iso: '100' } });
  });

  it('fires the shutter and takes the full-resolution file, not a preview frame', async () => {
    const bridge = new MockCameraHostBridge(undefined, new Uint8Array([1, 2, 3]));
    const device = new EdsdkCameraDevice(bridge, sink().factory);
    expect([...(await device.captureStill(deviceId))]).toEqual([1, 2, 3]);
    expect(bridge.shutters).toBe(1);
  });

  it('focusses and fires without downloading', async () => {
    const bridge = new MockCameraHostBridge();
    const device = new EdsdkCameraDevice(bridge, sink().factory);
    await device.focus(deviceId);
    await device.shutter(deviceId);
    expect([bridge.focuses, bridge.shutters]).toEqual([1, 1]);
  });

  it('tells the ids apart', () => {
    expect(isEdsdkDeviceId(deviceId)).toBe(true);
    expect(isEdsdkDeviceId('tether:canon-eos-250d')).toBe(false);
    expect(isEdsdkDeviceId(undefined)).toBe(false);
  });
});
