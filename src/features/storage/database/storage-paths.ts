import fs from 'node:fs';
import path from 'node:path';

export type StoragePaths = { photosDirectory: string; backupDirectory: string };
export const STORAGE_CONFIG_FILE_NAME = 'photobooth-paths.json';

/** Reads the operator-editable folder configuration written on first launch. */
export function getConfiguredStoragePaths(userDataPath: string): StoragePaths {
  const configPath = path.join(userDataPath, STORAGE_CONFIG_FILE_NAME);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<StoragePaths>;
  if (!config.photosDirectory || !config.backupDirectory) throw new Error('Photo and backup paths are not configured');
  return { photosDirectory: config.photosDirectory, backupDirectory: config.backupDirectory };
}
