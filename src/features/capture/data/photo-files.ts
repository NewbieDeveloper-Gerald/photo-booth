import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { MAX_PHOTO_BYTES } from '../../../shared/constants/limits';
import type { StoragePaths } from '../../storage/database/storage-paths';

/** Resolves a stored path, preferring the photos folder and falling back to the backup copy. */
export function storedPhotoPath(paths: StoragePaths, filePath: string): string {
  try { return ensureInside(paths.photosDirectory, filePath); }
  catch { return ensureInside(paths.backupDirectory, filePath); }
}

/** Temp file + rename, so a crash never leaves a half-written photo or database-referenced file. */
export async function writeAtomically(filePath: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, bytes, { flag: 'wx' });
  await fs.promises.rename(temporaryPath, filePath);
}

/** Every version of a photo (including replaced ones) is copied here before anything else happens. */
export async function copyBackupVersion(paths: StoragePaths, eventId: string, sessionId: string, sourcePath: string): Promise<void> {
  const source = storedPhotoPath(paths, sourcePath);
  const folder = ensureInside(paths.backupDirectory, path.join(paths.backupDirectory, eventId, sessionId));
  const destination = ensureInside(paths.backupDirectory, path.join(folder, path.basename(source)));
  await fs.promises.mkdir(folder, { recursive: true });
  if (fs.existsSync(destination)) return;
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await fs.promises.copyFile(source, temporaryPath);
  await fs.promises.rename(temporaryPath, destination);
}

/** Copy-then-rename inside the photos folder; never overwrites an existing version file. */
export async function moveWithinPhotos(paths: StoragePaths, sourcePath: string, destinationPath: string): Promise<void> {
  const source = storedPhotoPath(paths, sourcePath);
  const destination = ensureInside(paths.photosDirectory, destinationPath);
  if (source === destination) return;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) throw new Error(`Photo version already exists: ${path.basename(destination)}`);
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await fs.promises.copyFile(source, temporaryPath);
  await fs.promises.rename(temporaryPath, destination);
}

/** Validates bytes arriving over IPC before they are written to disk. */
export function toPhotoBuffer(data: unknown): Buffer {
  if (!(data instanceof Uint8Array) || data.byteLength < 4 || data.byteLength > MAX_PHOTO_BYTES) {
    throw new Error('Invalid photo data');
  }
  return Buffer.from(data);
}
