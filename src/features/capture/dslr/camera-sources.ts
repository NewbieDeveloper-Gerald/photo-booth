import type { CameraDevice, CameraInfo, CameraResolution } from '../devices/camera';
import { captureOriginalJpeg, originalFromJpegBytes } from '../domain/photo-pipeline';
import { isTetherDeviceId } from './tether-camera';
import { isEdsdkDeviceId as isEdsdkSource } from '../camera/edsdk-camera';
import { isSimulatedDeviceId as isSimulatedSource } from '../camera/simulated-camera';

/** A camera device that can also hand over a real still, which only the tether camera can (F26). */
export type CameraSourceDevice = CameraDevice & { captureStill?: (deviceId: string) => Promise<Uint8Array> };

export type CameraSources = {
  webcam?: CameraDevice | null;
  /** Canon EDSDK through the camera host (Phase 1). */
  edsdk?: CameraDevice | null;
  /** The gphoto2 helper (F26); kept until the EDSDK path has been run on real bodies. */
  tether?: CameraDevice | null;
  /** The shipped test camera, so the booth can be rehearsed without hardware. */
  simulated?: CameraDevice | null;
};

type StillCapable = CameraDevice & { captureStill: (deviceId: string) => Promise<Uint8Array> };

/**
 * One device for the booth screen: webcams first, then the EDSDK camera, then the older tether
 * helper, then the simulated camera. The screen keeps calling the same three methods, and the
 * device id decides who answers — which is what lets the booth swap a dead DSLR for a webcam, or
 * run an entire rehearsal on the test camera, without changing anything else.
 */
export function createCameraSources(sources: CameraSources): CameraSourceDevice | null {
  const devices: Array<{ owns: (id: string) => boolean; device: CameraDevice; listOrder: number }> = [];
  const add = (device: CameraDevice | null | undefined, owns: (id: string) => boolean, listOrder: number): void => {
    if (device) devices.push({ owns, device, listOrder });
  };
  add(sources.webcam, () => false, 0);
  add(sources.edsdk, isEdsdkSource, 1);
  add(sources.tether, isTetherDeviceId, 2);
  add(sources.simulated, isSimulatedSource, 3);
  if (devices.length === 0) return null;

  const owner = (deviceId: string): CameraDevice => {
    const match = devices.find((entry) => entry.owns(deviceId));
    if (match) return match.device;
    // A prefixed id belongs to a camera that is not plugged in — falling back to the webcam would
    // take the wrong photo silently. Unprefixed ids are the browser's own webcam ids.
    if (deviceId.includes(':')) throw new Error('That camera is not connected.');
    const webcam = devices.find((entry) => entry.listOrder === 0);
    if (!webcam) throw new Error('That camera is not connected.');
    return webcam.device;
  };

  const stillDevice = devices.find((entry): entry is { owns: (id: string) => boolean; device: StillCapable; listOrder: number } =>
    typeof (entry.device as Partial<StillCapable>).captureStill === 'function');

  return {
    async listCameras(): Promise<CameraInfo[]> {
      const listings = await Promise.all(devices.map((entry) => entry.device.listCameras().catch(() => [] as CameraInfo[])));
      return listings.flat();
    },
    startPreview(deviceId: string, resolution: CameraResolution): Promise<MediaStream> {
      return owner(deviceId).startPreview(deviceId, resolution);
    },
    stopPreview(stream: MediaStream | null): void {
      for (const entry of devices) entry.device.stopPreview(stream);
    },
    ...(stillDevice
      ? {
        captureStill: async (deviceId: string): Promise<Uint8Array> => {
          const device = owner(deviceId) as Partial<StillCapable>;
          if (typeof device.captureStill !== 'function') throw new Error('This camera cannot hand over a full-resolution photo.');
          return device.captureStill(deviceId);
        },
      }
      : {}),
  };
}

/** The webcam to fall back to: any camera that is not the tether camera. */
export function webcamFallback(cameras: CameraInfo[]): string {
  return cameras.find((camera) => !isTetherDeviceId(camera.deviceId))?.deviceId ?? '';
}

export type CaptureSource = { device: CameraSourceDevice | null; deviceId: string; video: HTMLVideoElement | null };

/**
 * The photo for a slot. With the tether camera the still comes from the camera at full
 * resolution; with a webcam it is a frame of the preview, exactly as before F26.
 */
/**
 * The cameras that hand over a real file. Everything else — a webcam, a phone in the browser —
 * only has the preview canvas, and that is what gets captured. Getting this wrong is expensive:
 * the canvas is 1024 px wide, which looks fine on screen and prints soft.
 */
function isStillSource(deviceId: string): boolean {
  return isTetherDeviceId(deviceId) || isEdsdkSource(deviceId) || isSimulatedSource(deviceId);
}

export async function capturePhotoFrom({ device, deviceId, video }: CaptureSource): Promise<{ blob: Blob; width: number; height: number }> {
  if (isStillSource(deviceId)) {
    if (!device?.captureStill) throw new Error('This camera cannot hand over a full-resolution photo.');
    return originalFromJpegBytes(await device.captureStill(deviceId));
  }
  if (!video) throw new Error('The camera is not ready for capture.');
  return captureOriginalJpeg(video);
}
