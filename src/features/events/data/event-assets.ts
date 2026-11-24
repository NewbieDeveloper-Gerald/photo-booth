import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../storage/database/connection';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isEventId } from '../../../shared/validation/identifiers';
import { MAX_LOGO_BYTES } from '../../../shared/constants/limits';

function eventAssetsPath(userDataPath: string, eventId: string): string {
  return ensureInside(userDataPath, path.join(userDataPath, 'event-assets', eventId));
}

export function storeEventLogoPath(userDataPath: string, eventId: string, sourcePath: string): string {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('Choose a PNG or JPEG logo');
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile() || stats.size < 12 || stats.size > MAX_LOGO_BYTES) throw new Error('Logo must be an image file no larger than 5 MB');
  const data = fs.readFileSync(sourcePath);
  const valid = ext === '.png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!valid) throw new Error('Logo contents do not match a supported PNG or JPEG file');
  const dir = eventAssetsPath(userDataPath, eventId);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `logo${ext}`);
  fs.copyFileSync(sourcePath, target);
  return target;
}

export function setEventLogo(userDataPath: string, eventId: unknown, sourcePath: unknown): string {
  if (!isEventId(eventId) || typeof sourcePath !== 'string') throw new Error('Invalid logo request');
  const db = openDatabase(userDataPath);
  try { if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw new Error('Event not found'); }
  finally { db.close(); }
  const logoPath = storeEventLogoPath(userDataPath, eventId, sourcePath);
  const update = openDatabase(userDataPath);
  try { update.prepare('UPDATE events SET logo_path = ? WHERE id = ?').run(logoPath, eventId); }
  finally { update.close(); }
  return logoPath;
}

export function getEventLogoDataUrl(userDataPath: string, eventId: unknown): string | null {
  if (!isEventId(eventId)) return null;
  const db = openDatabase(userDataPath);
  let logoPath: string | null;
  try { logoPath = (db.prepare('SELECT logo_path FROM events WHERE id = ?').get(eventId) as { logo_path: string | null } | undefined)?.logo_path ?? null; }
  finally { db.close(); }
  if (!logoPath || !fs.existsSync(logoPath)) return null;
  const ext = path.extname(logoPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
  return `data:${ext === '.png' ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(logoPath).toString('base64')}`;
}
