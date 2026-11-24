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
  {
    name: '002_capture_sessions',
    sql: `
      ALTER TABLE events ADD COLUMN shots INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE events ADD COLUMN retake_limit INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE events ADD COLUMN print_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE events ADD COLUMN expiry_days INTEGER NOT NULL DEFAULT 30;
      ALTER TABLE sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
      ALTER TABLE slots ADD COLUMN captured_at TEXT;
      ALTER TABLE photos ADD COLUMN download_path TEXT;
      ALTER TABLE photos ADD COLUMN width INTEGER;
      ALTER TABLE photos ADD COLUMN height INTEGER;
      INSERT OR IGNORE INTO events (id, name, shots, retake_limit, print_enabled, expiry_days)
        VALUES ('default-event', 'Default Event', 3, 3, 1, 30);
      INSERT OR IGNORE INTO settings (key, value) VALUES ('activeEventId', 'default-event');
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_slots_session ON slots(session_id, slot_number);
    `,
  },
  {
    name: '003_slot_retake_history',
    sql: `
      ALTER TABLE sessions ADD COLUMN retakes_used INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN retake_limit INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE slots ADD COLUMN current_photo_id TEXT;
      ALTER TABLE slots ADD COLUMN previous_photo_id TEXT;
      ALTER TABLE photos ADD COLUMN photo_state TEXT NOT NULL DEFAULT 'current';
      UPDATE slots SET current_photo_id = (
        SELECT p.id FROM photos p WHERE p.slot_id = slots.id ORDER BY p.created_at DESC LIMIT 1
      ) WHERE status = 'captured';
      CREATE INDEX IF NOT EXISTS idx_photos_slot_state ON photos(slot_id, photo_state);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_retake_per_slot ON photos(slot_id) WHERE photo_state = 'pending';
    `,
  },
  {
    name: '004_session_layout_choice',
    sql: `ALTER TABLE sessions ADD COLUMN layout_id TEXT NOT NULL DEFAULT 'double-strip-3';`,
  },
  {
    name: '005_private_download_links',
    sql: `
      ALTER TABLE sessions ADD COLUMN public_token TEXT;
      ALTER TABLE sessions ADD COLUMN token_expires_at TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_public_token ON sessions(public_token) WHERE public_token IS NOT NULL;
    `,
  },
  {
    name: '006_persistent_upload_queue',
    sql: `
      ALTER TABLE upload_queue ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_queue_session_file ON upload_queue(session_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_upload_queue_due ON upload_queue(status, next_retry_at, created_at);
    `,
  },
  {
    name: '007_event_branding',
    sql: `
      ALTER TABLE events ADD COLUMN event_date TEXT;
      ALTER TABLE events ADD COLUMN logo_path TEXT;
      ALTER TABLE events ADD COLUMN primary_color TEXT NOT NULL DEFAULT '#c90000';
      ALTER TABLE events ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#f4f0ec';
      ALTER TABLE events ADD COLUMN welcome_text TEXT NOT NULL DEFAULT 'Ready for your event. Check the preview, then start a session.';
      ALTER TABLE events ADD COLUMN thank_you_text TEXT NOT NULL DEFAULT 'Your layout is ready.';
      ALTER TABLE events ADD COLUMN default_layout_id TEXT NOT NULL DEFAULT 'double-strip-3';
      UPDATE events SET default_layout_id = CASE shots WHEN 2 THEN 'single-2-portrait' WHEN 4 THEN 'double-strip-4' ELSE 'double-strip-3' END;
    `,
  },
  {
    name: '008_templates',
    sql: `
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shots INTEGER NOT NULL CHECK (shots BETWEEN 1 AND 6),
        copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
        page_preset TEXT NOT NULL,
        page_width_px INTEGER NOT NULL,
        page_height_px INTEGER NOT NULL,
        dpi INTEGER NOT NULL DEFAULT 300,
        margin_px INTEGER NOT NULL,
        header_height_px INTEGER NOT NULL,
        footer_height_px INTEGER NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE template_elements (
        template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        element_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        kind TEXT NOT NULL,
        layer INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        slot_number INTEGER,
        text TEXT,
        color TEXT,
        font_size INTEGER,
        font_weight INTEGER,
        align TEXT,
        max_width INTEGER,
        qr_avoid INTEGER,
        frame_gutter INTEGER,
        inset INTEGER,
        panel_color TEXT,
        PRIMARY KEY (template_id, element_id)
      );
      CREATE INDEX IF NOT EXISTS idx_template_elements_order ON template_elements(template_id, layer);
    `,
  },
  {
    name: '009_template_assets',
    sql: `ALTER TABLE template_elements ADD COLUMN asset_name TEXT;`,
  },
  {
    name: '010_event_layout_choices',
    sql: `
      ALTER TABLE events ADD COLUMN offered_layout_ids TEXT NOT NULL DEFAULT '[]';
      UPDATE events SET offered_layout_ids = '["' || default_layout_id || '"]';
    `,
  },
  {
    name: '011_event_consent_and_contact',
    sql: `
      ALTER TABLE events ADD COLUMN consent_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE events ADD COLUMN contact_text TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: '012_event_gallery',
    sql: `
      ALTER TABLE events ADD COLUMN gallery_token TEXT;
      ALTER TABLE events ADD COLUMN gallery_password_hash TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_gallery_token ON events(gallery_token) WHERE gallery_token IS NOT NULL;
    `,
  },
  {
    name: '013_event_watermark',
    sql: `
      ALTER TABLE events ADD COLUMN watermark_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE events ADD COLUMN watermark_position TEXT NOT NULL DEFAULT 'bottom-right';
      ALTER TABLE events ADD COLUMN watermark_scale_percent INTEGER NOT NULL DEFAULT 18;
      ALTER TABLE events ADD COLUMN watermark_opacity REAL NOT NULL DEFAULT 0.6;
    `,
  },
  {
    name: '014_print_queue',
    sql: `
      CREATE TABLE print_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        printer_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at);
      ALTER TABLE events ADD COLUMN print_limit_per_session INTEGER NOT NULL DEFAULT 2;
      ALTER TABLE events ADD COLUMN paper_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE outputs ADD COLUMN width INTEGER;
      ALTER TABLE outputs ADD COLUMN height INTEGER;
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
