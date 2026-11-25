import type { CameraDevice, CameraInfo, CameraResolution } from '../devices/camera';
import { canvasFrameStream, type FrameStreamFactory } from '../dslr/tether-camera';
import {
  pickSupported, unsupportedSettings,
  type CameraCapabilities, type CameraSettingId, type CameraSettingRole, type CameraSettings,
  type CameraSettingsPair,
} from './camera-settings';
import type { CameraHostStatus } from './host-protocol';

/**
 * The DSLR as the booth sees it (Phase 1). Canon's EDSDK lives in a separate helper process; the
 * renderer only knows this bridge, so the app can run — and the whole flow can be tested — with a
 * webcam or the simulated camera when no DSLR or no EDSDK is present.
 */
export const EDSDK_DEVICE_PREFIX = 'edsdk:';

export function isEdsdkDeviceId(deviceId: unknown): boolean {
  return typeof deviceId === 'string' && deviceId.startsWith(EDSDK_DEVICE_PREFIX);
}

export class EdsdkCameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdsdkCameraError';
  }
}

/** What the preload bridge offers; the main process owns the actual host process. */
export type CameraHostBridge = {
  status(): Promise<CameraHostStatus>;
  list(): Promise<CameraInfo[]>;
  capabilities(deviceId: string): Promise<CameraCapabilities>;
  settings(deviceId: string): Promise<CameraSettingsPair>;
  setSettings(deviceId: string, role: CameraSettingRole, settings: CameraSettings): Promise<void>;
  startLiveView(deviceId: string, onFrame: (jpeg: Uint8Array) => void, onError: (message: string) => void): Promise<void>;
  stopLiveView(): Promise<void>;
  /** Half-press: focus without firing, so the countdown is not the first time the lens moves. */
  focus(deviceId: string): Promise<void>;
  /** Full press, without downloading — used by the setup wizard's test shot. */
  shutter(deviceId: string): Promise<void>;
  /** The full-resolution JPEG of the shot just taken. */
  download(deviceId: string): Promise<Uint8Array>;
};

export type SettingsApplyResult = { applied: CameraSettings; ignored: CameraSettingId[] };

export class EdsdkCameraDevice implements CameraDevice {
  constructor(
    private readonly bridge: CameraHostBridge,
    private readonly createFrameStream: FrameStreamFactory = canvasFrameStream,
    /** Called when live view dies after it started, so the booth can fall back to a webcam. */
    private readonly onLiveViewError: (message: string) => void = () => undefined,
  ) {}

  async status(): Promise<CameraHostStatus> {
    return this.bridge.status().catch(() => ({ available: false, connected: false, restarts: 0, reason: 'The camera host did not answer.' }));
  }

  async listCameras(): Promise<CameraInfo[]> {
    const status = await this.status();
    if (!status.available) return [];
    return this.bridge.list().catch(() => []);
  }

  async startPreview(deviceId: string, resolution: CameraResolution): Promise<MediaStream> {
    if (!isEdsdkDeviceId(deviceId)) throw new EdsdkCameraError('That camera is not the EDSDK camera.');
    const sink = this.createFrameStream(resolution);
    try {
      await this.bridge.startLiveView(deviceId, (jpeg) => { void sink.push(jpeg).catch(() => undefined); }, (message) => this.onLiveViewError(message));
    } catch (error) {
      sink.close();
      throw new EdsdkCameraError(error instanceof Error ? error.message : 'The camera could not start its live view.');
    }
    return sink.stream;
  }

  stopPreview(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
    void this.bridge.stopLiveView().catch(() => undefined);
  }

  async capabilities(deviceId: string): Promise<CameraCapabilities> {
    return this.bridge.capabilities(deviceId);
  }

  async settings(deviceId: string): Promise<CameraSettingsPair> {
    return this.bridge.settings(deviceId);
  }

  /**
   * Applies a set of settings to the live view or to the capture, dropping anything this body does
   * not offer rather than sending a value the camera would refuse.
   */
  async applySettings(deviceId: string, role: CameraSettingRole, wanted: CameraSettings): Promise<SettingsApplyResult> {
    const capabilities = await this.capabilities(deviceId);
    const applied = pickSupported(capabilities, wanted);
    if (Object.keys(applied).length > 0) await this.bridge.setSettings(deviceId, role, applied);
    return { applied, ignored: unsupportedSettings(capabilities, wanted) };
  }

  async focus(deviceId: string): Promise<void> {
    await this.bridge.focus(deviceId);
  }

  async shutter(deviceId: string): Promise<void> {
    await this.bridge.shutter(deviceId);
  }

  async captureStill(deviceId: string): Promise<Uint8Array> {
    // The host's download waits for the file the camera announces, so the shutter fires first:
    // one call from the booth, the sequence the body expects.
    await this.bridge.shutter(deviceId);
    return this.bridge.download(deviceId);
  }
}

/** Test double: records the calls and hands back predictable data. */
export class MockCameraHostBridge implements CameraHostBridge {
  starts = 0;
  stops = 0;
  focuses = 0;
  shutters = 0;
  applied: Array<{ role: CameraSettingRole; settings: CameraSettings }> = [];
  private frame: ((jpeg: Uint8Array) => void) | null = null;
  private failure: ((message: string) => void) | null = null;

  constructor(
    private statusValue: CameraHostStatus = { available: true, connected: true, restarts: 0, reason: null },
    private readonly still = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    private readonly caps: CameraCapabilities = {
      iso: [{ value: '100', label: '100' }, { value: '3200', label: '3200' }],
      shutter: [{ value: '1/200', label: '1/200' }],
      aperture: [{ value: 'f/5.6', label: 'f/5.6' }],
      whiteBalance: [{ value: 'Auto', label: 'Auto' }],
      quality: [{ value: 'jpeg-large', label: 'Large JPEG' }],
    },
  ) {}

  setStatus(status: CameraHostStatus): void { this.statusValue = status; }

  async status(): Promise<CameraHostStatus> { return this.statusValue; }

  async list(): Promise<CameraInfo[]> { return [{ deviceId: `${EDSDK_DEVICE_PREFIX}0`, label: 'Canon EOS 200D' }]; }

  async capabilities(): Promise<CameraCapabilities> { return this.caps; }

  async settings(): Promise<CameraSettingsPair> { return { liveView: { iso: '3200' }, capture: { iso: '100' } }; }

  async setSettings(_deviceId: string, role: CameraSettingRole, settings: CameraSettings): Promise<void> {
    this.applied.push({ role, settings });
  }

  async startLiveView(_deviceId: string, onFrame: (jpeg: Uint8Array) => void, onError: (message: string) => void): Promise<void> {
    this.starts += 1;
    this.frame = onFrame;
    this.failure = onError;
    if (!this.statusValue.available) throw new Error(this.statusValue.reason ?? 'unavailable');
  }

  async stopLiveView(): Promise<void> { this.stops += 1; }

  async focus(): Promise<void> { this.focuses += 1; }

  async shutter(): Promise<void> { this.shutters += 1; }

  async download(): Promise<Uint8Array> { return this.still; }

  /** Test hook: one live-view frame, the way the helper would push it. */
  emit(jpeg: Uint8Array): void { this.frame?.(jpeg); }

  /** Test hook: live view died after it started. */
  fail(message: string): void { this.failure?.(message); }
}
