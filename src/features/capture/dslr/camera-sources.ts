import type { CameraDevice, CameraInfo, CameraResolution } from '../devices/camera';
import { captureOriginalJpeg, originalFromJpegBytes } from '../domain/photo-pipeline';
import { isTetherDeviceId } from './tether-camera';

/** A camera device that can also hand over a real still, which only the tether camera can (F26). */
export type CameraSourceDevice = CameraDevice & { captureStill?: (deviceId: string) => Promise<Uint8Array> };

export type CameraSources = { webcam?: CameraDevice | null; tether?: CameraDevice | null };

/**
 * One device for the booth screen: webcams first, then the tether camera. The screen keeps
 * calling the same three methods, and the device id decides who answers — which is what lets the
 * booth swap a dead DSLR for a webcam without changing anything else.
 */
export function createCameraSources({ webcam, tether }: CameraSources): CameraSourceDevice | null {
  if (!webcam && !tether) return null;
  const tetherDevice = tether as (CameraDevice & { captureStill?: (deviceId: string) => Promise<Uint8Array> }) | null | undefined;
  if (!webcam || !tetherDevice) {
    const only = (webcam ?? tetherDevice)!;
    return {
      listCameras: () => only.listCameras(),
      startPreview: (deviceId: string, resolution: CameraResolution) => only.startPreview(deviceId, resolution),
      stopPreview: (stream: MediaStream | null) => only.stopPreview(stream),
      ...(only === tetherDevice && tetherDevice.captureStill
        ? { captureStill: (deviceId: string) => tetherDevice.captureStill!(deviceId) }
        : {}),
    };
  }

  let lastWasTether = false;
  return {
    async listCameras(): Promise<CameraInfo[]> {
      const [webcams, tethered] = await Promise.all([
        webcam.listCameras().catch(() => []),
        tetherDevice.listCameras().catch(() => []),
      ]);
      return [...webcams, ...tethered];
    },
    startPreview(deviceId: string, resolution: CameraResolution): Promise<MediaStream> {
      lastWasTether = isTetherDeviceId(deviceId);
      return lastWasTether ? tetherDevice.startPreview(deviceId, resolution) : webcam.startPreview(deviceId, resolution);
    },
    stopPreview(stream: MediaStream | null): void {
      (lastWasTether ? tetherDevice : webcam).stopPreview(stream);
    },
    ...(tetherDevice.captureStill ? { captureStill: (deviceId: string) => tetherDevice.captureStill!(deviceId) } : {}),
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
export async function capturePhotoFrom({ device, deviceId, video }: CaptureSource): Promise<{ blob: Blob; width: number; height: number }> {
  if (isTetherDeviceId(deviceId)) {
    if (!device?.captureStill) throw new Error('This camera cannot hand over a full-resolution photo.');
    return originalFromJpegBytes(await device.captureStill(deviceId));
  }
  if (!video) throw new Error('The camera is not ready for capture.');
  return captureOriginalJpeg(video);
}
