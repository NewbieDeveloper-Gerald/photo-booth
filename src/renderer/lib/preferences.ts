import type { BoothSettingKey } from '../../shared/constants/settings-keys';

/**
 * Preferences live in SQLite in the desktop app. `npm run dev:web` has no bridge,
 * so the browser preview falls back to localStorage with the same keys.
 */
export async function readPreference(key: BoothSettingKey): Promise<string | null> {
  if (window.photobooth) return window.photobooth.getSetting(key);
  return localStorage.getItem(`photobooth.${key}`);
}

export async function savePreference(key: BoothSettingKey, value: string): Promise<void> {
  if (window.photobooth) return window.photobooth.setSetting(key, value);
  localStorage.setItem(`photobooth.${key}`, value);
}
