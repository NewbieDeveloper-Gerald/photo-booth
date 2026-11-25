/**
 * Where the booth keeps its database, photos and settings.
 *
 * The product is Boothwright, but a booth that has already run at an event has all of its data in
 * the folder the app has used since its first build. A rename must not orphan that: the branded
 * folder is used for a fresh install, and the old folder keeps the data when it is the one that
 * exists. No filesystem access here, so the choice can be tested without a real AppData directory.
 */
export const BRANDED_FOLDER = 'boothwright';
export const LEGACY_FOLDER = 'photobooth-build';

export function chooseUserDataFolder(input: { exists: (folder: string) => boolean }): string {
  if (input.exists(BRANDED_FOLDER)) return BRANDED_FOLDER;
  if (input.exists(LEGACY_FOLDER)) return LEGACY_FOLDER;
  return BRANDED_FOLDER;
}
