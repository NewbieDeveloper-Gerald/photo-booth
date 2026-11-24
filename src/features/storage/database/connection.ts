import Database from 'better-sqlite3';
import path from 'node:path';

export const DATABASE_FILE_NAME = 'photobooth.sqlite';

/** Every connection enables foreign keys, matching what each repository used to do inline. */
export function openDatabase(userDataPath: string): Database.Database {
  const database = new Database(path.join(userDataPath, DATABASE_FILE_NAME));
  database.pragma('foreign_keys = ON');
  return database;
}

/** The share server never writes; a missing file must fail rather than create an empty database. */
export function openReadOnlyDatabase(databasePath: string): Database.Database {
  return new Database(databasePath, { readonly: true, fileMustExist: true });
}

/** Opens, runs `work`, and always closes — the pattern every repository repeats. */
export function withDatabase<T>(userDataPath: string, work: (database: Database.Database) => T): T {
  const database = openDatabase(userDataPath);
  try {
    return work(database);
  } finally {
    database.close();
  }
}
