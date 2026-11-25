import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyMigrations, declaredColumns, isAlreadyPresentError, migrations, schemaGaps, splitStatements } from './migrations';

function memoryDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  return database;
}

function recordedNames(database: Database.Database): string[] {
  return (database.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as Array<{ name: string }>)
    .map((row) => row.name);
}

describe('splitStatements', () => {
  it('splits a multi-statement migration and drops the empty tail', () => {
    expect(splitStatements("CREATE TABLE a (id TEXT);\nCREATE INDEX i ON a(id);\n")).toEqual([
      'CREATE TABLE a (id TEXT)',
      'CREATE INDEX i ON a(id)',
    ]);
  });

  it('keeps a semicolon inside a quoted default value', () => {
    expect(splitStatements("CREATE TABLE a (name TEXT NOT NULL DEFAULT 'stop; go');")).toEqual([
      "CREATE TABLE a (name TEXT NOT NULL DEFAULT 'stop; go')",
    ]);
  });

  it('treats a doubled quote as an escaped quote, not the end of the literal', () => {
    expect(splitStatements("INSERT INTO a VALUES ('it''s; fine'); INSERT INTO a VALUES ('x');")).toEqual([
      "INSERT INTO a VALUES ('it''s; fine')",
      "INSERT INTO a VALUES ('x')",
    ]);
  });

  it('returns nothing for whitespace', () => {
    expect(splitStatements('  \n\t ')).toEqual([]);
  });
});

describe('applyMigrations', () => {
  it('applies and records every shipped migration on a new database', () => {
    // The guard for the splitter: a statement cut in the wrong place cannot be executed, so this
    // fails loudly if a future migration is added with a semicolon the splitter does not expect.
    const database = memoryDatabase();
    const result = applyMigrations(database);
    expect(result.repaired).toEqual([]);
    expect(result.applied).toEqual(migrations.map((migration) => migration.name));
    expect(recordedNames(database)).toEqual(migrations.map((migration) => migration.name));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'").get()).toBeTruthy();
    database.close();
  });

  it('is a no-op on the second run', () => {
    const database = memoryDatabase();
    applyMigrations(database);
    expect(applyMigrations(database)).toEqual({ applied: [], repaired: [] });
    database.close();
  });

  it('repairs a database where a migration ran outside the list: objects present, row missing', () => {
    // This is the state a build before this one left behind: the template tables existed, but
    // `008_templates` was never recorded, so the next start died on `table templates already
    // exists` and the booth never opened a window.
    const database = memoryDatabase();
    applyMigrations(database);
    database.prepare("INSERT INTO templates (id, name, shots, copies, page_preset, page_width_px, page_height_px, margin_px, header_height_px, footer_height_px) VALUES ('t1', 'Kept', 3, 1, '4x6', 1200, 1800, 36, 120, 300)").run();
    database.prepare("DELETE FROM schema_migrations WHERE name IN ('008_templates', '009_template_assets')").run();

    const result = applyMigrations(database);

    // One line per statement that was already in the schema, not one per migration: 008 creates
    // two tables, and the repair is decided statement by statement.
    expect(result.repaired).toEqual([
      '008_templates: table templates already exists',
      '008_templates: table template_elements already exists',
      '009_template_assets: duplicate column name: asset_name',
    ]);
    expect(result.applied).toEqual(['008_templates', '009_template_assets']);
    expect(recordedNames(database)).toContain('008_templates');
    // The data the booth already had is untouched, and the table it was missing is there.
    expect(database.prepare('SELECT name FROM templates').get()).toEqual({ name: 'Kept' });
    expect((database.prepare('PRAGMA table_info(template_elements)').all() as Array<{ name: string }>).map((column) => column.name)).toContain('asset_name');
    // And a third run has nothing left to do.
    expect(applyMigrations(database)).toEqual({ applied: [], repaired: [] });
    database.close();
  });

  it('still throws, and records nothing, for a migration that is genuinely broken', () => {
    const database = memoryDatabase();
    expect(() => applyMigrations(database, [
      { name: '900_ok', sql: 'CREATE TABLE fine (id TEXT);' },
      { name: '901_broken', sql: 'CREATE TABLE fine (id TEXT); CREATE TABLE nope (' },
    ])).toThrow();
    expect(recordedNames(database)).toEqual(['900_ok']);
    database.close();
  });
});

describe('declaredColumns and schemaGaps', () => {
  it('reads the columns out of the migration SQL, including the ones added later by ALTER', () => {
    const declared = declaredColumns();
    expect(declared.get('templates')).toEqual(expect.arrayContaining(['id', 'is_builtin', 'page_width_px']));
    expect(declared.get('templates')).not.toContain('PRIMARY');
    // `asset_name` is not in the CREATE TABLE for template_elements; 009 adds it.
    expect(declared.get('template_elements')).toContain('asset_name');
    expect(declared.get('events')).toEqual(expect.arrayContaining(['shots', 'welcome_text', 'send_link_enabled']));
  });

  it('finds nothing missing on a database built by these migrations', () => {
    const database = memoryDatabase();
    applyMigrations(database);
    expect(schemaGaps(database)).toEqual([]);
    database.close();
  });

  it('names the table and column when an adopted database is older than this build', () => {
    // A database whose `templates` table predates a column this build queries cannot be repaired
    // by recording the migration, and must say so rather than fail later inside a screen.
    const database = memoryDatabase();
    applyMigrations(database);
    database.exec('ALTER TABLE templates DROP COLUMN is_builtin');
    database.prepare("DELETE FROM schema_migrations WHERE name = '008_templates'").run();

    expect(() => applyMigrations(database)).toThrow(/from an older build/);
    expect(() => applyMigrations(database)).toThrow(/table templates has no is_builtin/);
    database.close();
  });
});

describe('isAlreadyPresentError', () => {
  it('recognises the "the work is already done" messages and nothing else', () => {
    expect(isAlreadyPresentError(new Error('table templates already exists'))).toBe(true);
    expect(isAlreadyPresentError(new Error('index idx_x already exists'))).toBe(true);
    expect(isAlreadyPresentError(new Error('duplicate column name: asset_name'))).toBe(true);
    expect(isAlreadyPresentError(new Error('no such table: templates'))).toBe(false);
    expect(isAlreadyPresentError(new Error('near "(": syntax error'))).toBe(false);
    expect(isAlreadyPresentError('table templates already exists')).toBe(false);
  });
});
