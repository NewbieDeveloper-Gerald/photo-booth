import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureInside } from '../../../shared/fs/safe-paths';

/** Layout artwork is copied into the booth's user data, never referenced in place. */
const ASSET_DIRECTORY = 'layout-assets';
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ASSET_NAME_PATTERN = /^[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$/;

function assetDirectory(userDataPath: string): string {
  const directory = path.join(userDataPath, ASSET_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/** Copies a chosen picture into the layout asset store and returns its relative name. */
export function saveLayoutAsset(userDataPath: string, sourcePath: string): { assetName: string; bytes: number } {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('Choose a PNG, JPEG or WebP picture');
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile()) throw new Error('Choose a picture file');
  if (stats.size > MAX_ASSET_BYTES) throw new Error('That picture is larger than 8 MB');
  const assetName = `${randomUUID()}${extension === '.jpeg' ? '.jpg' : extension}`;
  const directory = assetDirectory(userDataPath);
  fs.copyFileSync(sourcePath, ensureInside(directory, path.join(directory, assetName)));
  return { assetName, bytes: stats.size };
}

/** Reads a stored picture back for previews and printing; the name is validated, not trusted. */
export function readLayoutAsset(userDataPath: string, assetNameValue: unknown): Uint8Array {
  if (typeof assetNameValue !== 'string' || !ASSET_NAME_PATTERN.test(assetNameValue)) throw new Error('Invalid layout picture');
  const directory = assetDirectory(userDataPath);
  const assetPath = ensureInside(directory, path.join(directory, assetNameValue));
  if (!fs.existsSync(assetPath)) throw new Error('That layout picture is missing from this booth');
  return new Uint8Array(fs.readFileSync(assetPath));
}

/** Deletes artwork that no stored template refers to; called after a template is deleted. */
export function removeUnusedLayoutAssets(userDataPath: string, usedAssetNames: string[]): number {
  const directory = assetDirectory(userDataPath);
  const used = new Set(usedAssetNames);
  let removed = 0;
  for (const name of fs.readdirSync(directory)) {
    if (used.has(name) || !ASSET_NAME_PATTERN.test(name)) continue;
    fs.rmSync(path.join(directory, name), { force: true });
    removed += 1;
  }
  return removed;
}

export function listLayoutAssets(userDataPath: string): string[] {
  return fs.readdirSync(assetDirectory(userDataPath)).filter((name) => ASSET_NAME_PATTERN.test(name));
}
