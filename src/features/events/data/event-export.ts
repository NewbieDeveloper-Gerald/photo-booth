import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isOverlappingPath } from '../../../shared/validation/paths';
import { copyBackupVersion } from '../../capture/data/photo-files';

export async function exportEventFolder(userDataPath: string, eventIdValue: unknown, destinationRootValue: unknown): Promise<string> {
  if (typeof eventIdValue !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(eventIdValue) || typeof destinationRootValue !== 'string') throw new Error('Invalid export request');
  const paths = getConfiguredStoragePaths(userDataPath);
  const database = openDatabase(userDataPath);
  let event: { id: string; name: string } | undefined;
  try { event = database.prepare('SELECT id, name FROM events WHERE id = ?').get(eventIdValue) as typeof event; }
  finally { database.close(); }
  if (!event) throw new Error('Event not found');
  const destinationRoot = path.resolve(destinationRootValue);
  if (isOverlappingPath(destinationRoot, path.resolve(paths.photosDirectory), path.sep) ||
      isOverlappingPath(destinationRoot, path.resolve(paths.backupDirectory), path.sep)) {
    throw new Error('Choose an export folder outside the booth photos and backup folders');
  }
  const photosSource = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, event.id));
  const backupSource = ensureInside(paths.backupDirectory, path.join(paths.backupDirectory, event.id));
  const photosTarget = path.join(destinationRoot, 'photos', event.id);
  const backupTarget = path.join(destinationRoot, 'backup', event.id);
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  for (const [source, target] of [[photosSource, photosTarget], [backupSource, backupTarget]] as const) {
    if (fs.existsSync(source)) await fs.promises.cp(source, target, { recursive: true, force: true, errorOnExist: false });
  }
  // Ensure sessions created before automatic backups are protected too.
  if (fs.existsSync(photosSource)) {
    for (const sessionEntry of await fs.promises.readdir(photosSource, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionFolder = path.join(photosSource, sessionEntry.name);
      for (const file of await fs.promises.readdir(sessionFolder, { withFileTypes: true })) {
        if (file.isFile() && file.name.startsWith('slot-') && file.name.toLowerCase().endsWith('.jpg')) await copyBackupVersion(paths, event.id, sessionEntry.name, path.join(sessionFolder, file.name));
      }
    }
    await fs.promises.cp(backupSource, backupTarget, { recursive: true, force: true, errorOnExist: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  return destinationRoot;
}
