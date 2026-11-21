import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const migrations: Array<{ name: string; sql: string }> = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id),
        status TEXT NOT NULL DEFAULT 'in_progress',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE slots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        slot_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'empty',
        UNIQUE(session_id, slot_number)
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL REFERENCES slots(id),
        original_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE outputs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        output_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE upload_queue (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        file_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

export function initializeStorage(userDataPath: string): void {
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
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const migration of migrations) {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(migration.name);
    if (!applied) {
      database.transaction(() => {
        database.exec(migration.sql);
        database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(migration.name);
      })();
    }
  }
  database.close();
}
