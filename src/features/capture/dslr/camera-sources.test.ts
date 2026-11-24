// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePhotoFrom, createCameraSources, webcamFallback } from './camera-sources';
import { MockTetherBridge, TetherCameraDevice } from './tether-camera';
import { TETHER_MODEL } from './dslr-types';
import type { CameraDevice, CameraInfo } from '../devices/camera';

function fakeWebcam(cameras: CameraInfo[] = [{ deviceId: 'webcam-1', label: 'Logitech C920' }]) {
  const device = {
    listCameras: vi.fn(async () => cameras),
    startPreview: vi.fn(async () => ({ id: 'webcam-stream' } as unknown as MediaStream)),
    stopPreview: vi.fn(),
  } satisfies CameraDevice;
  return device;
}

describe('camera sources (F26)', () => {
  it('lists webcams first, then the tether camera', async () => {
    const sources = createCameraSources({ webcam: fakeWebcam(), tether: new TetherCameraDevice(new MockTetherBridge(), () => fakeSink()) })!;
    expect(await sources.listCameras()).toEqual([
      { deviceId: 'webcam-1', label: 'Logitech C920' },
      { deviceId: TETHER_MODEL.deviceId, label: 'Canon EOS 250D (tethered)' },
    ]);
  });

  it('sends each request to the camera that owns it', async () => {
    const webcam = fakeWebcam();
    const bridge = new MockTetherBridge();
    const device = new TetherCameraDevice(bridge, () => fakeSink());
    const sources = createCameraSources({ webcam, tether: device })!;
    await sources.startPreview('webcam-1', 'best');
    expect(webcam.startPreview).toHaveBeenCalledWith('webcam-1', 'best');
    await sources.startPreview(TETHER_MODEL.deviceId, 'best');
    expect(bridge.starts).toBe(1);
    sources.stopPreview(null);
    await vi.waitFor(() => expect(bridge.stops).toBe(1));
    expect(await sources.captureStill!(TETHER_MODEL.deviceId)).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  it('works with only one of the two cameras present', async () => {
    const onlyWebcam = createCameraSources({ webcam: fakeWebcam(), tether: null })!;
    expect(await onlyWebcam.listCameras()).toHaveLength(1);
    expect(onlyWebcam.captureStill).toBeUndefined();

    const onlyTether = createCameraSources({ tether: new TetherCameraDevice(new MockTetherBridge(), () => fakeSink()) })!;
    expect((await onlyTether.listCameras())[0]?.deviceId).toBe(TETHER_MODEL.deviceId);
    expect(typeof onlyTether.captureStill).toBe('function');
    expect(createCameraSources({})).toBeNull();
  });

  it('picks a webcam to fall back to, never the tether camera', () => {
    expect(webcamFallback([{ deviceId: TETHER_MODEL.deviceId, label: 'Tether' }, { deviceId: 'webcam-2', label: 'Webcam' }])).toBe('webcam-2');
    expect(webcamFallback([{ deviceId: TETHER_MODEL.deviceId, label: 'Tether' }])).toBe('');
  });

  it('takes the photo from the camera when it is tethered, and from the preview otherwise', async () => {
    stubImagePipeline();
    const sources = createCameraSources({ webcam: fakeWebcam(), tether: new TetherCameraDevice(new MockTetherBridge(), () => fakeSink()) })!;
    const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    const tethered = await capturePhotoFrom({ device: sources, deviceId: TETHER_MODEL.deviceId, video });
    expect(tethered).toMatchObject({ width: 4000, height: 3000 });
    expect(tethered.blob.type).toBe('image/jpeg');

    const webcamShot = await capturePhotoFrom({ device: sources, deviceId: 'webcam-1', video });
    expect(webcamShot).toMatchObject({ width: 640, height: 480 });

    // A tether still does not need a working preview element.
    await expect(capturePhotoFrom({ device: sources, deviceId: TETHER_MODEL.deviceId, video: null })).resolves.toBeDefined();
    await expect(capturePhotoFrom({ device: null, deviceId: TETHER_MODEL.deviceId, video })).rejects.toThrow('full-resolution photo');
    await expect(capturePhotoFrom({ device: sources, deviceId: 'webcam-1', video: null })).rejects.toThrow('not ready for capture');
  });
});

function fakeSink() {
  return { stream: { getTracks: () => [] } as unknown as MediaStream, push: async () => undefined, close: () => undefined };
}

/** jsdom has no canvas or image decoding: both are stubbed so the branch, not the pixels, is tested. */
function stubImagePipeline(): void {
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return originalCreate(tagName);
    return {
      width: 0, height: 0,
      getContext: () => ({ drawImage: () => undefined }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
    } as unknown as HTMLElement;
  }) as typeof document.createElement);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
