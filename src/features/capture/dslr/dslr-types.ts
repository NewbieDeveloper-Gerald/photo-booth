/**
 * The one camera this feature promises (F26). Other PTP cameras may work through the same
 * helper, but nothing beyond this model is promised or tested.
 */
export const TETHER_MODEL = {
  id: 'canon-eos-250d',
  label: 'Canon EOS 250D',
  /** The id the camera picker shows; the prefix is how the booth tells a tether camera apart. */
  deviceId: 'tether:canon-eos-250d',
} as const;

export const TETHER_DEVICE_PREFIX = 'tether:';

export type TetherStatus = {
  /** True when the helper answered and saw a camera on the USB bus. */
  available: boolean;
  /** The helper binary the booth looks for, e.g. "gphoto2". */
  helper: string;
  /** Model name reported by the helper, or the promised model when nothing answered. */
  model: string;
  /** Every camera the helper listed; the first is the one the booth uses. */
  cameras: string[];
  /** Operator wording for why the tether camera is not usable; null when it is. */
  reason: string | null;
};

/** What the renderer needs from the main process; the Electron bridge and a mock both fit. */
export type TetherBridge = {
  status(): Promise<TetherStatus>;
  /**
   * Starts live view and hands each JPEG frame to the caller. A camera that dies mid-event
   * reports it through `onError` instead of leaving the preview frozen.
   */
  startLiveView(onFrame: (jpeg: Uint8Array) => void, onError?: (message: string) => void): Promise<void>;
  stopLiveView(): Promise<void>;
  /** A full-resolution still, straight from the camera. */
  capture(): Promise<Uint8Array>;
};

/** One command run of the helper, so tests can drive it without a camera or a process. */
export type RunCommand = (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: Uint8Array; stderr: string; code: number }>;
