import {
  GPHOTO_HELPER, LIST_TIMEOUT_MS, PREVIEW_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, autoDetectArgs, capturePreviewArgs,
  captureStillArgs, describeGphotoFailure, describeHelperFailure, extractJpeg, parseDetectedCameras,
} from './gphoto';
import { TETHER_MODEL, type RunCommand, type TetherStatus } from './dslr-types';

/** Each live-view frame is one helper run, so the rate is roughly 2–5 frames a second. */
export const DEFAULT_FRAME_INTERVAL_MS = 350;
/** Three failed frames in a row means the cable or the camera is gone, not a dropped frame. */
const MAX_CONSECUTIVE_FRAME_FAILURES = 3;

export type TetherServiceOptions = {
  run: RunCommand;
  /** Called with every live-view JPEG. */
  onFrame: (jpeg: Uint8Array) => void;
  /** Called with operator wording when live view gives up. */
  onError?: (message: string) => void;
  frameIntervalMs?: number;
  /** Injected so tests do not wait on real timers. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type TetherService = {
  status: () => Promise<TetherStatus>;
  /** Starts the live-view loop; throws when there is no camera to stream from. */
  start: () => Promise<void>;
  stop: () => void;
  isStreaming: () => boolean;
  capture: () => Promise<Uint8Array>;
};

function isMissingHelper(error: unknown, stderr: string, code: number): { failed: true; reason: string } | { failed: false } {
  const errorCode = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (errorCode) return { failed: true, reason: describeHelperFailure(error) };
  if (code !== 0) return { failed: true, reason: describeGphotoFailure(stderr, code) };
  return { failed: false };
}

/**
 * The tether helper behind `CameraDevice` (F26): it asks gphoto2 what is on the USB bus, loops
 * one preview command at a time, and pulls a full-resolution still out of stdout. Every failure
 * is turned into a sentence an operator can act on, and a camera that fails mid-event stops the
 * loop instead of hammering a dead port.
 */
export function createTetherService(options: TetherServiceOptions): TetherService {
  const {
    run, onFrame, onError, frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS,
    setTimer = (callback, ms) => setTimeout(callback, ms), clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;
  let timer: unknown = null;
  let streaming = false;
  let failures = 0;

  const status = async (): Promise<TetherStatus> => {
    try {
      const result = await run(autoDetectArgs(), { timeoutMs: LIST_TIMEOUT_MS });
      const cameras = parseDetectedCameras(new TextDecoder().decode(result.stdout));
      if (result.code !== 0) {
        return { available: false, helper: GPHOTO_HELPER, model: TETHER_MODEL.label, cameras, reason: describeGphotoFailure(result.stderr, result.code) };
      }
      if (cameras.length === 0) {
        return {
          available: false, helper: GPHOTO_HELPER, model: TETHER_MODEL.label, cameras,
          reason: `No ${TETHER_MODEL.label} was found. Check the USB cable and set the camera to its PC connection mode.`,
        };
      }
      return { available: true, helper: GPHOTO_HELPER, model: cameras[0]!, cameras, reason: null };
    } catch (error) {
      return { available: false, helper: GPHOTO_HELPER, model: TETHER_MODEL.label, cameras: [], reason: describeHelperFailure(error) };
    }
  };

  const stop = (): void => {
    streaming = false;
    failures = 0;
    if (timer !== null) { clearTimer(timer); timer = null; }
  };

  const scheduleFrame = (): void => {
    timer = setTimer(() => { void tick(); }, frameIntervalMs);
  };

  const tick = async (): Promise<void> => {
    if (!streaming) return;
    try {
      const result = await run(capturePreviewArgs(), { timeoutMs: PREVIEW_TIMEOUT_MS });
      const failure = isMissingHelper(null, result.stderr ?? '', result.code);
      if (failure.failed) throw new Error(failure.reason);
      onFrame(extractJpeg(result.stdout));
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FRAME_FAILURES) {
        const reason = error instanceof Error && error.message.startsWith('The ') ? error.message : describeHelperFailure((error as { cause?: unknown })?.cause ?? error);
        stop();
        onError?.(`Live view stopped: ${reason}`);
        return;
      }
    }
    if (streaming) scheduleFrame();
  };

  const start = async (): Promise<void> => {
    if (streaming) return;
    const current = await status();
    if (!current.available) throw new Error(current.reason ?? 'The tether camera is not available.');
    streaming = true;
    failures = 0;
    scheduleFrame();
  };

  const capture = async (): Promise<Uint8Array> => {
    const result = await run(captureStillArgs(), { timeoutMs: CAPTURE_TIMEOUT_MS });
    const failure = isMissingHelper(null, result.stderr ?? '', result.code);
    if (failure.failed) throw new Error(failure.reason);
    return extractJpeg(result.stdout);
  };

  return { status, start, stop, isStreaming: () => streaming, capture };
}
