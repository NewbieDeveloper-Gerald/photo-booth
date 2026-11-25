import { describe, expect, it } from 'vitest';
import { BRANDED_FOLDER, LEGACY_FOLDER, chooseUserDataFolder } from './user-data-path';

function folders(...names: string[]): { exists: (folder: string) => boolean } {
  return { exists: (folder) => names.includes(folder) };
}

describe('the booth data folder survives the rename', () => {
  it('uses the branded folder on a fresh install', () => {
    expect(chooseUserDataFolder(folders())).toBe(BRANDED_FOLDER);
  });

  it('keeps a booth that has been running: its old folder still holds the database', () => {
    expect(chooseUserDataFolder(folders(LEGACY_FOLDER))).toBe(LEGACY_FOLDER);
  });

  it('prefers the branded folder once it exists, so a deliberate move is not undone', () => {
    expect(chooseUserDataFolder(folders(BRANDED_FOLDER, LEGACY_FOLDER))).toBe(BRANDED_FOLDER);
  });
});
