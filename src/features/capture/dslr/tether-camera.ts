import { TETHER_DEVICE_PREFIX, TETHER_MODEL, type TetherBridge, type TetherStatus } from './dslr-types';
import type { CameraDevice, CameraInfo, CameraResolution } from '../devices/camera';

export function isTetherDeviceId(deviceId: unknown): boolean {
  return typeof deviceId === 'string' && deviceId.startsWith(TETHER_DEVICE_PREFIX);
}

/** Carries its own wording, so the operator panel shows why the camera failed, not a generic line. */
export class TetherCameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TetherCameraError';
  }
}

export type FrameStream = {
  stream: MediaStream;
  /** Draws one decoded JPEG frame; implementations swallow a decode that arrives after close. */
  push: (jpeg: Uint8Array) => Promise<void>;
  close: () => void;
};

export type FrameStreamFactory = (resolution: CameraResolution) => FrameStream;

const PREVIEW_MAX_WIDTH: Record<CameraResolution, number> = {
  best: 1920, '1280x720': 1280, '1920x1080': 1920, '3840x2160': 1920,
};

/**
 * Live view for a still camera: the helper's JPEG frames are drawn into a canvas and the canvas
 * is exposed as a MediaStream, so the booth screen — and the tablet preview path — keep working
 * exactly as they do with a webcam. The photo itself is never a canvas grab: `captureStill` asks
 * the camera for a full-resolution JPEG.
 */
export function canvasFrameStream(resolution: CameraResolution): FrameStream {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new TetherCameraError('Could not prepare the tether live view.');
  let closed = false;
  let sized = false;
  const stream = canvas.captureStream(12);
  return {
    stream,
    push: async (jpeg: Uint8Array) => {
      if (closed) return;
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
      try {
        if (!sized) {
          const scale = Math.min(1, PREVIEW_MAX_WIDTH[resolution] / bitmap.width);
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          sized = true;
        }
        if (!closed) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally { bitmap.close(); }
    },
    close: () => {
      closed = true;
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

/**
 * The DSLR/mirrorless camera as a `CameraDevice` (F26). Only the one promised model is listed;
 * if the helper or the camera is missing, `listCameras` returns nothing and `startPreview`
 * fails with the helper's reason, which is what triggers the webcam fallback.
 */
export class TetherCameraDevice implements CameraDevice {
  constructor(
    private readonly bridge: TetherBridge,
    private readonly createFrameStream: FrameStreamFactory = canvasFrameStream,
    /** Called when live view dies after it started — the booth screen uses it to fall back. */
    private readonly onLiveViewError: (message: string) => void = () => undefined,
  ) {}

  async listCameras(): Promise<CameraInfo[]> {
    const status = await this.bridge.status().catch(() => null);
    if (!status?.available) return [];
    return [{ deviceId: TETHER_MODEL.deviceId, label: `${status.model || TETHER_MODEL.label} (tethered)` }];
  }

  async startPreview(deviceId: string, resolution: CameraResolution): Promise<MediaStream> {
    if (!isTetherDeviceId(deviceId)) throw new TetherCameraError('That camera is not the tether camera.');
    const status: TetherStatus = await this.bridge.status().catch(() => ({
      available: false, helper: 'gphoto2', model: TETHER_MODEL.label, cameras: [], reason: null,
    }));
    if (!status.available) throw new TetherCameraError(status.reason ?? 'The tether camera is not available.');
    const sink = this.createFrameStream(resolution);
    try {
      await this.bridge.startLiveView(
        (jpeg) => { void sink.push(jpeg).catch(() => undefined); },
        (message) => this.onLiveViewError(message),
      );
    } catch (error) {
      sink.close();
      throw new TetherCameraError(error instanceof Error ? error.message : 'The tether camera could not start.');
    }
    return sink.stream;
  }

  stopPreview(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
    void this.bridge.stopLiveView().catch(() => undefined);
  }

  /** A full-resolution still from the camera, not a frame of the preview. */
  async captureStill(): Promise<Uint8Array> {
    return this.bridge.capture();
  }
}

/** Test double: records what the booth asked for and hands back predictable frames. */
export class MockTetherBridge implements TetherBridge {
  private lastHandler: ((jpeg: Uint8Array) => void) | null = null;
  private lastErrorHandler: ((message: string) => void) | null = null;
  starts = 0;
  stops = 0;
  captures = 0;
  constructor(
    private statusValue: TetherStatus = { available: true, helper: 'gphoto2', model: TETHER_MODEL.label, cameras: [TETHER_MODEL.label], reason: null },
    private readonly still = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  ) {}

  setStatus(status: TetherStatus): void { this.statusValue = status; }

  async status(): Promise<TetherStatus> { return this.statusValue; }

  async startLiveView(onFrame: (jpeg: Uint8Array) => void, onError?: (message: string) => void): Promise<void> {
    this.starts += 1;
    this.lastHandler = onFrame;
    this.lastErrorHandler = onError ?? null;
    if (!this.statusValue.available) throw new Error(this.statusValue.reason ?? 'unavailable');
  }

  async stopLiveView(): Promise<void> { this.stops += 1; }

  async capture(): Promise<Uint8Array> { this.captures += 1; return this.still; }

  /** Test hook: pushes a frame through the live-view subscription. */
  emit(jpeg: Uint8Array): void {
    this.lastHandler?.(jpeg);
  }

  /** Test hook: reports a live-view failure the way the helper would. */
  fail(message: string): void {
    this.lastErrorHandler?.(message);
  }
}
