/** Every booth preference the renderer may read or write through the preload bridge. */
export const BOOTH_SETTING_KEYS = [
  'selectedCameraId',
  'countdownSeconds',
  'cameraResolution',
  'lowDiskWarningGB',
  'selectedPrinterName',
  'downloadBaseUrl',
  'consentText',
] as const;

export type BoothSettingKey = (typeof BOOTH_SETTING_KEYS)[number];

export function isBoothSettingKey(value: unknown): value is BoothSettingKey {
  return typeof value === 'string' && (BOOTH_SETTING_KEYS as readonly string[]).includes(value);
}
