/** Every booth preference the renderer may read or write through the preload bridge. */
export const BOOTH_SETTING_KEYS = [
  'selectedCameraId',
  'countdownSeconds',
  'cameraResolution',
  'lowDiskWarningGB',
  'selectedPrinterName',
  'downloadBaseUrl',
  'consentText',
  /** 'on' puts the shipped test camera in the camera list, so a booth can be rehearsed without hardware. */
  'simulatedCamera',
] as const;

export type BoothSettingKey = (typeof BOOTH_SETTING_KEYS)[number];

export function isBoothSettingKey(value: unknown): value is BoothSettingKey {
  return typeof value === 'string' && (BOOTH_SETTING_KEYS as readonly string[]).includes(value);
}
