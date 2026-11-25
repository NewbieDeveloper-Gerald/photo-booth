import type Database from 'better-sqlite3';

export type Migration = { name: string; sql: string };

/**
 * SQLite's way of saying "the work this migration does is already in the schema": the table, index
 * or column exists because an older build of the app created it, or because the migration was
 * split out of one that had already run.
 */
const ALREADY_PRESENT = /^(?:table|index|view|trigger) .+ already exists$|^duplicate column name: /i;

/** Splits a migration into single statements, respecting quoted text. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      current += character;
      if (character === quote) {
        // '' inside a string literal is an escaped quote, not the end of the literal.
        if (sql[index + 1] === quote) {
          current += quote;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function isAlreadyPresentError(error: unknown): boolean {
  return error instanceof Error && ALREADY_PRESENT.test(error.message.trim());
}

const NOT_A_COLUMN = /^(?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)\b/i;

/** Splits on a separator that is not inside parentheses or quoted text. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      current += character;
      if (character === quote) {
        if (text[index + 1] === quote) {
          current += quote;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    } else if (character === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Every column the migrations declare, per table, read back out of their own SQL.
 *
 * The repair below can only confirm that a table exists, not that it has the columns this build
 * queries. Reading the declarations back means the two can be compared afterwards.
 */
export function declaredColumns(list: Migration[] = migrations): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  const add = (table: string, column: string): void => {
    const columns = declared.get(table) ?? [];
    if (!columns.includes(column)) columns.push(column);
    declared.set(table, columns);
  };
  for (const migration of list) {
    for (const statement of splitStatements(migration.sql)) {
      const create = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/i.exec(statement);
      if (create) {
        for (const part of splitTopLevel(create[2], ',')) {
          const name = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
          if (name && !NOT_A_COLUMN.test(part.trim())) add(create[1], name);
        }
        continue;
      }
      const addColumn = /^ALTER\s+TABLE\s+([A-Za-z_]\w*)\s+ADD\s+COLUMN\s+([A-Za-z_]\w*)/i.exec(statement);
      if (addColumn) add(addColumn[1], addColumn[2]);
    }
  }
  return declared;
}

export type SchemaGap = { table: string; missingColumns: string[] };

/** What the migrations declare that the database does not actually have. */
export function schemaGaps(database: Database.Database, list: Migration[] = migrations): SchemaGap[] {
  const gaps: SchemaGap[] = [];
  for (const [table, columns] of declaredColumns(list)) {
    const actual = new Set(
      (database.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>).map((row) => row.name),
    );
    const missingColumns = columns.filter((column) => !actual.has(column));
    if (missingColumns.length > 0) gaps.push({ table, missingColumns });
  }
  return gaps;
}

export type MigrationResult = {
  /** Migration names applied in this call, in order. */
  applied: string[];
  /** `name: message` for each statement that was already in the schema and was therefore skipped. */
  repaired: string[];
};

/**
 * Applies the migrations that this database has not recorded yet, one transaction each.
 *
 * A statement that fails because its work is already present (see `isAlreadyPresentError`) is
 * skipped and the migration is still recorded, so the database is usable again and the same
 * statement is not retried on every start. Anything else — a syntax error, a missing table, a
 * constraint — rolls that migration back and is thrown, because a schema that half-applied is
 * worse than a booth that refuses to start and says why.
 *
 * The repair matters for databases created by builds that made schema changes outside this list:
 * they hold the tables but not the record, so the first start of a newer build died with
 * `table templates already exists` before any window appeared.
 */
export function applyMigrations(database: Database.Database, list: Migration[] = migrations): MigrationResult {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const recorded = new Set(
    (database.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((row) => row.name),
  );
  const record = database.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)');
  const result: MigrationResult = { applied: [], repaired: [] };
  for (const migration of list) {
    if (recorded.has(migration.name)) continue;
    const skipped: string[] = [];
    database.transaction(() => {
      for (const statement of splitStatements(migration.sql)) {
        try {
          database.exec(statement);
        } catch (error) {
          if (!isAlreadyPresentError(error)) throw error;
          skipped.push((error as Error).message);
        }
      }
      record.run(migration.name);
    })();
    result.applied.push(migration.name);
    for (const message of skipped) result.repaired.push(`${migration.name}: ${message}`);
  }

  // Recording a migration whose objects already existed is only safe if those objects are the
  // ones this build expects. If they are not (a database from a much older build, with a table
  // that predates columns this build queries), say so here, in words, instead of failing later
  // inside a screen with `no such column`.
  const gaps = schemaGaps(database, list);
  if (gaps.length > 0) {
    const detail = gaps.map((gap) => `table ${gap.table} has no ${gap.missingColumns.join(', no ')}`).join('; ');
    throw new Error(
      `The photo booth database is from an older build and cannot be upgraded in place: ${detail}. ` +
      'Back up the database file, delete it, and start the booth again to create a new one.',
    );
  }
  return result;
}

/**
 * The database schema, as an ordered list of migrations.
 *
 * Migrations are recorded by name in `schema_migrations` and applied once. Nothing here may be
 * edited after it has shipped: a database that already ran `008_templates` will not run it again,
 * so a change to its SQL only ever reaches databases created after the edit. Add a new migration.
 *
 * The list was extracted from `initialize.ts` unchanged when the runner learned to repair an
 * older database (see `applyMigrations`): a build before this one created the template tables
 * outside the migration list, which left them present but unrecorded, and the next start failed
 * with `table templates already exists`.
 */
export const migrations: Migration[] = [
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
  {
    // F19: the idle attract loop. Media itself lives as files under event-assets/<event>/attract.
    name: '015_attract_screen',
    sql: `
      ALTER TABLE events ADD COLUMN attract_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE events ADD COLUMN attract_idle_seconds INTEGER NOT NULL DEFAULT 60;
    `,
  },
  {
    // F20: the guest look is an event default plus an optional per-session choice.
    name: '016_photo_filters',
    sql: `
      ALTER TABLE events ADD COLUMN filter_id TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE events ADD COLUMN filter_choice_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN filter_id TEXT NOT NULL DEFAULT 'none';
    `,
  },
  {
    // F23: the animated extra each session gets — a slideshow GIF, a boomerang, both or none.
    name: '017_animated_outputs',
    sql: `
      ALTER TABLE events ADD COLUMN animated_output TEXT NOT NULL DEFAULT 'gif';
    `,
  },
  {
    // F24: guest download hits, so the dashboard can count them. Ids and a kind only — never an
    // address or a browser, because nothing here should identify a person.
    name: '018_download_events',
    sql: `
      CREATE TABLE download_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_download_events_event ON download_events(event_id, created_at);
    `,
  },
  {
    // F25: saved printer profiles — model, paper, cut and colour per printer — plus the profile a
    // queued print used, kept on the job so history still reads after a profile is edited.
    name: '019_printer_profiles',
    sql: `
      CREATE TABLE printer_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        printer_name TEXT NOT NULL DEFAULT '',
        paper_id TEXT NOT NULL,
        cut_mode TEXT NOT NULL DEFAULT 'per-print',
        color_mode TEXT NOT NULL DEFAULT 'color',
        brightness INTEGER NOT NULL DEFAULT 0,
        contrast INTEGER NOT NULL DEFAULT 0,
        saturation INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_printer_profiles_printer ON printer_profiles(printer_name) WHERE printer_name <> '';
      CREATE UNIQUE INDEX idx_printer_profiles_default ON printer_profiles(is_default) WHERE is_default = 1;
      ALTER TABLE print_jobs ADD COLUMN profile_id TEXT;
      ALTER TABLE print_jobs ADD COLUMN profile_label TEXT;
    `,
  },
  {
    // F28: the guest may ask for the link by email or SMS. Only the switch is stored — never an
    // address or a number, because the booth does not keep them after sending.
    name: '020_link_delivery',
    sql: `
      ALTER TABLE events ADD COLUMN send_link_enabled INTEGER NOT NULL DEFAULT 1;
    `,
  },
];
