/**
 * The camera controls Phase 1 promises, and the rule that keeps them safe: the booth may remember
 * a setting the camera has stopped offering (a different body, a different lens), so nothing is
 * ever sent to the camera without asking it what it supports first.
 *
 * Live view and capture are separate on purpose. A booth with studio strobes wants a bright preview
 * (high ISO, wide aperture) and a clean shot (low ISO, stopped down); the two lists travel and are
 * stored separately all the way to EDSDK.
 */
export const CAMERA_SETTING_IDS = ['iso', 'shutter', 'aperture', 'whiteBalance', 'quality'] as const;

export type CameraSettingId = (typeof CAMERA_SETTING_IDS)[number];

/** Values are the camera's own labels ("1/250", "f/8", "3200", "Auto"), never numbers we invent. */
export type CameraSettings = Partial<Record<CameraSettingId, string>>;

export type CameraSettingChoice = { value: string; label: string };

export type CameraCapabilities = Partial<Record<CameraSettingId, CameraSettingChoice[]>>;

/** Which of the two setting sets a call is about. */
export type CameraSettingRole = 'liveView' | 'capture';

export type CameraSettingsPair = { liveView: CameraSettings; capture: CameraSettings };

export const CAMERA_SETTING_LABELS: Record<CameraSettingId, string> = {
  iso: 'ISO',
  shutter: 'Shutter speed',
  aperture: 'Aperture',
  whiteBalance: 'White balance',
  quality: 'Image quality',
};

/** Keeps only what this camera offers, so a stale preference cannot be sent to a new body. */
export function pickSupported(capabilities: CameraCapabilities, wanted: CameraSettings): CameraSettings {
  const accepted: CameraSettings = {};
  for (const id of CAMERA_SETTING_IDS) {
    const value = wanted[id];
    if (value === undefined) continue;
    const choices = capabilities[id];
    if (choices?.some((choice) => choice.value === value)) accepted[id] = value;
  }
  return accepted;
}

/** Settings that the operator asked for but the camera does not offer — worth telling them about. */
export function unsupportedSettings(capabilities: CameraCapabilities, wanted: CameraSettings): CameraSettingId[] {
  const supported = pickSupported(capabilities, wanted);
  return CAMERA_SETTING_IDS.filter((id) => wanted[id] !== undefined && supported[id] === undefined);
}

/** True when at least one control can be set, so the settings panel knows whether to appear. */
export function hasAnyCapability(capabilities: CameraCapabilities): boolean {
  return CAMERA_SETTING_IDS.some((id) => (capabilities[id]?.length ?? 0) > 0);
}

/** The value a fresh booth starts from: the camera's own first choice, or nothing at all. */
export function defaultsFromCapabilities(capabilities: CameraCapabilities): CameraSettings {
  const defaults: CameraSettings = {};
  for (const id of CAMERA_SETTING_IDS) {
    const first = capabilities[id]?.[0];
    if (first) defaults[id] = first.value;
  }
  return defaults;
}
