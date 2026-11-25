import type { CameraDevice, CameraInfo } from '../devices/camera';
import type { CameraSettingId, CameraSettings } from './camera-settings';

/**
 * The camera the booth ships with, so the whole flow can be rehearsed on any PC: a test card drawn
 * on a canvas, streamed at the requested rate, and a real JPEG still at the end. It answers the
 * same interface as an EDSDK body, which is the point — the guest flow cannot tell the difference,
 * so an event can be run through end to end before the camera is on the table.
 */
export const SIMULATED_DEVICE_PREFIX = 'simulated:';
export const SIMULATED_DEVICE_ID = `${SIMULATED_DEVICE_PREFIX}camera`;
export const SIMULATED_LABEL = 'Simulated camera (test mode)';

export function isSimulatedDeviceId(deviceId: unknown): boolean {
  return typeof deviceId === 'string' && deviceId.startsWith(SIMULATED_DEVICE_PREFIX);
}

/** The slice of a canvas the simulated camera needs; tests provide their own. */
export type SimulatedCanvas = {
  width: number;
  height: number;
  getContext(kind: '2d'): SimulatedContext | null;
  captureStream?(fps?: number): MediaStream;
  toDataURL?(type?: string, quality?: number): string;
};

export type SimulatedContext = {
  fillStyle: string;
  font: string;
  textAlign: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
};

export type SimulatedCameraOptions = {
  createCanvas?: () => SimulatedCanvas;
  now?: () => number;
  fps?: number;
  /** How often a preview frame is drawn. */
  frameIntervalMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

const PREVIEW_SIZE = { width: 1280, height: 720 };
const STILL_SIZE = { width: 2400, height: 1600 };

export type SimulatedCamera = CameraDevice & {
  captureStill(): Promise<Uint8Array>;
  /** Always the test card; the simulated body has no state to paint. */
  applySettings(settings: CameraSettings): CameraSettings;
};

export function createSimulatedCamera(options: SimulatedCameraOptions = {}): SimulatedCamera {
  const {
    createCanvas = () => document.createElement('canvas') as unknown as SimulatedCanvas,
    now = () => Date.now(),
    fps = 30,
    frameIntervalMs = Math.round(1000 / 30),
    setInterval: schedule = (callback, ms) => setInterval(callback, ms),
    clearInterval: cancel = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  } = options;

  let timer: unknown = null;
  let frame = 0;
  let stream: MediaStream | null = null;
  let canvas: SimulatedCanvas | null = null;

  const draw = (target: SimulatedCanvas, size: { width: number; height: number }, shot: number): void => {
    target.width = size.width;
    target.height = size.height;
    const context = target.getContext('2d');
    if (!context) return;
    context.fillStyle = '#161513';
    context.fillRect(0, 0, size.width, size.height);
    // A moving band makes a frozen preview obvious at a glance.
    const bandWidth = size.width / 6;
    context.fillStyle = '#2a2723';
    context.fillRect(((shot * size.width) / 40) % size.width, 0, bandWidth, size.height);
    context.fillStyle = '#f7f6f3';
    context.textAlign = 'center';
    context.font = `${Math.round(size.width / 22)}px system-ui, sans-serif`;
    context.fillText('BOOTHWRIGHT', size.width / 2, size.height / 2 - size.width / 40);
    context.font = `${Math.round(size.width / 46)}px system-ui, sans-serif`;
    context.fillText(shot < 0 ? 'TEST CAMERA · STILL' : `TEST CAMERA · FRAME ${shot}`, size.width / 2, size.height / 2 + size.width / 30);
    context.font = `${Math.round(size.width / 60)}px system-ui, sans-serif`;
    context.fillText(new Date(now()).toISOString().slice(11, 19), size.width / 2, size.height - size.width / 30);
  };

  const stopTimer = (): void => {
    if (timer !== null) { cancel(timer); timer = null; }
  };

  return {
    async listCameras(): Promise<CameraInfo[]> {
      return [{ deviceId: SIMULATED_DEVICE_ID, label: SIMULATED_LABEL }];
    },

    // The test camera has one sensor size and one device, so the arguments are accepted and ignored.
    async startPreview(): Promise<MediaStream> {
      stopTimer();
      canvas = createCanvas();
      draw(canvas, PREVIEW_SIZE, frame);
      // A canvas without captureStream (a bare test double) still returns a stream-shaped value.
      stream = canvas.captureStream?.(fps) ?? ({ getTracks: () => [] } as unknown as MediaStream);
      timer = schedule(() => {
        if (!canvas) return;
        frame += 1;
        draw(canvas, PREVIEW_SIZE, frame);
      }, frameIntervalMs);
      return stream;
    },

    stopPreview(current: MediaStream | null): void {
      stopTimer();
      (current ?? stream)?.getTracks().forEach((track) => track.stop());
      stream = null;
    },

    /** A real JPEG, encoded by the browser's own encoder — the pipeline gets real pixels. */
    async captureStill(): Promise<Uint8Array> {
      const still = createCanvas();
      draw(still, STILL_SIZE, -1);
      const encoded = still.toDataURL?.('image/jpeg', 0.92) ?? '';
      const base64 = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : '';
      if (!base64) throw new Error('The simulated camera could not encode a photo.');
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    },

    applySettings(settings: CameraSettings): CameraSettings {
      const applied: CameraSettings = {};
      for (const [key, value] of Object.entries(settings) as Array<[CameraSettingId, string | undefined]>) {
        if (value !== undefined) applied[key] = value;
      }
      return applied;
    },
  };
}
