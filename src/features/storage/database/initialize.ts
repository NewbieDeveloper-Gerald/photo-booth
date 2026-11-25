import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { applyMigrations } from './migrations';

/**
 * Creates the folders, the paths file and the database, and brings the schema up to date.
 *
 * Returns the migrations that were found already present in the schema and recorded rather than
 * re-applied (normally none); the caller can log them so an upgrade of an old database is visible
 * instead of silent.
 */
export function initializeStorage(userDataPath: string): string[] {
  const configPath = path.join(userDataPath, 'photobooth-paths.json');
  fs.mkdirSync(userDataPath, { recursive: true });

  let configured: { photosDirectory?: string; backupDirectory?: string } = {};
  if (fs.existsSync(configPath)) {
    try {
      configured = JSON.parse(fs.readFileSync(configPath, 'utf8')) as typeof configured;
    } catch {
      throw new Error(`Invalid storage configuration at ${configPath}`);
    }
  } else {
    configured = {
      photosDirectory: path.join(userDataPath, 'photos'),
      backupDirectory: path.join(userDataPath, 'backup'),
    };
    fs.writeFileSync(configPath, `${JSON.stringify(configured, null, 2)}\n`, { flag: 'wx' });
  }

  if (!configured.photosDirectory || !configured.backupDirectory) {
    throw new Error(`Storage configuration must define photosDirectory and backupDirectory in ${configPath}`);
  }
  fs.mkdirSync(configured.photosDirectory, { recursive: true });
  fs.mkdirSync(configured.backupDirectory, { recursive: true });

  const database = new Database(path.join(userDataPath, 'photobooth.sqlite'));
  database.pragma('foreign_keys = ON');
  try {
    return applyMigrations(database).repaired;
  } finally {
    database.close();
  }
}
