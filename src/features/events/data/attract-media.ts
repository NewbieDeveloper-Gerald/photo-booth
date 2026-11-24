import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isEventId } from '../../../shared/validation/identifiers';
import { MAX_ATTRACT_MEDIA_BYTES, MAX_ATTRACT_MEDIA_FILES } from '../../../shared/constants/limits';
import type { AttractMedia, AttractMediaKind } from '../../../shared/types/attract';

export type { AttractMedia, AttractMediaKind } from '../../../shared/types/attract';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
/** Chromium plays these; a .mov from an iPhone is usually H.264 and works when renamed. */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.m4v'];

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4',
};

function kindOf(fileName: string): AttractMediaKind | null {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}

export function attractMimeType(fileName: string): string {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

function attractFolder(userDataPath: string, eventId: string): string {
  return ensureInside(userDataPath, path.join(userDataPath, 'event-assets', eventId, 'attract'));
}

function assertEvent(userDataPath: string, eventId: unknown): string {
  if (!isEventId(eventId)) throw new Error('Invalid event');
  const database = openDatabase(userDataPath);
  try { if (!database.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw new Error('Event not found'); }
  finally { database.close(); }
  return eventId;
}

/** A stored file name carries the original name so the operator can tell two clips apart. */
function storedName(sourcePath: string): { fileName: string; label: string } {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const label = base.replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || 'attract';
  const ext = path.extname(sourcePath).toLowerCase();
  return { fileName: `${label.replace(/ /g, '-').toLowerCase()}-${randomUUID().slice(0, 8)}${ext}`, label: `${label}${ext}` };
}

/** Magic bytes: a renamed .exe must not become a video the booth tries to play. */
function looksLikeMedia(filePath: string, kind: AttractMediaKind): boolean {
  const handle = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const read = fs.readSync(handle, head, 0, 16, 0);
    if (read < 12) return false;
    if (kind === 'image') {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.png') return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (ext === '.webp') return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    }
    if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return true;
    return head.subarray(4, 8).toString('ascii') === 'ftyp';
  } finally { fs.closeSync(handle); }
}

function listFolder(userDataPath: string, eventId: string): AttractMedia[] {
  const folder = attractFolder(userDataPath, eventId);
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter((fileName) => kindOf(fileName) !== null)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((fileName) => {
      const kind = kindOf(fileName);
      const full = ensureInside(folder, path.join(folder, fileName));
      try {
        const stats = fs.statSync(full);
        if (!stats.isFile()) return [];
        return [{ id: fileName, kind: kind as AttractMediaKind, label: fileName.replace(/-[0-9a-f]{8}(\.[^.]+)$/i, '$1'), bytes: stats.size }];
      } catch { return []; }
    });
}

export function listAttractMedia(userDataPath: string, eventId: unknown): AttractMedia[] {
  return listFolder(userDataPath, assertEvent(userDataPath, eventId));
}

/**
 * Copies chosen photos or clips into the event's own folder, so the loop keeps working when
 * the operator's memory card or USB stick goes home with them. The limit and the byte cap are
 * enforced here: the attract loop is decoration, it must never fill the booth's disk.
 */
export function addAttractMedia(userDataPath: string, eventIdValue: unknown, sourcePaths: unknown): AttractMedia[] {
  const eventId = assertEvent(userDataPath, eventIdValue);
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.some((item) => typeof item !== 'string')) {
    throw new Error('Choose photos or videos for the attract screen');
  }
  const existing = listFolder(userDataPath, eventId);
  if (existing.length + sourcePaths.length > MAX_ATTRACT_MEDIA_FILES) {
    throw new Error(`Keep at most ${MAX_ATTRACT_MEDIA_FILES} attract screen files; remove one first`);
  }
  const folder = attractFolder(userDataPath, eventId);
  const prepared = (sourcePaths as string[]).map((sourcePath) => {
    const kind = kindOf(sourcePath);
    if (!kind) throw new Error('Attract screen files must be PNG, JPEG, WebP, MP4, M4V or WebM');
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile() || stats.size < 12) throw new Error('That attract screen file is empty or unreadable');
    if (stats.size > MAX_ATTRACT_MEDIA_BYTES) throw new Error('Attract screen files must be 25 MB or smaller');
    if (!looksLikeMedia(sourcePath, kind)) throw new Error('That file is not the image or video its name claims');
    return { sourcePath, ...storedName(sourcePath) };
  });
  fs.mkdirSync(folder, { recursive: true });
  for (const item of prepared) fs.copyFileSync(item.sourcePath, ensureInside(folder, path.join(folder, item.fileName)));
  return listFolder(userDataPath, eventId);
}

export function removeAttractMedia(userDataPath: string, eventIdValue: unknown, mediaId: unknown): AttractMedia[] {
  const eventId = assertEvent(userDataPath, eventIdValue);
  if (typeof mediaId !== 'string' || !mediaId || kindOf(mediaId) === null || path.basename(mediaId) !== mediaId) {
    throw new Error('Invalid attract screen file');
  }
  const folder = attractFolder(userDataPath, eventId);
  const target = ensureInside(folder, path.join(folder, mediaId));
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  return listFolder(userDataPath, eventId);
}

/** Bytes for the renderer, which turns them into a blob URL the <img>/<video> can play. */
export function readAttractMedia(userDataPath: string, eventIdValue: unknown, mediaId: unknown): { kind: AttractMediaKind; mimeType: string; bytes: Buffer } {
  const eventId = assertEvent(userDataPath, eventIdValue);
  const kind = typeof mediaId === 'string' ? kindOf(mediaId) : null;
  if (!kind || path.basename(mediaId as string) !== mediaId) throw new Error('Invalid attract screen file');
  const folder = attractFolder(userDataPath, eventId);
  const target = ensureInside(folder, path.join(folder, mediaId as string));
  if (!fs.existsSync(target)) throw new Error('That attract screen file is no longer on this booth');
  return { kind, mimeType: attractMimeType(mediaId as string), bytes: fs.readFileSync(target) };
}
