import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import path from 'node:path';
import { toPhotoBuffer, writeAtomically } from './photo-files';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isSessionId } from '../../../shared/validation/identifiers';
import { loadTemplate } from '../../layouts/data/template-repository';

export async function saveSessionOutput(userDataPath: string, sessionIdValue: unknown, data: unknown, widthValue: unknown, heightValue: unknown): Promise<string> {
  if (!isSessionId(sessionIdValue) || !Number.isInteger(widthValue) || !Number.isInteger(heightValue)) throw new Error('Invalid finished image details');
  const bytes = toPhotoBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
  let session: { event_id: string; layout_id: string } | undefined;
  try { session = database.prepare("SELECT event_id, layout_id FROM sessions WHERE id = ? AND status = 'completed'").get(sessionIdValue) as typeof session; }
  finally { database.close(); }
  if (!session) throw new Error('Only completed sessions can save a finished image');
  const template = loadTemplate(userDataPath, session.layout_id);
  const { widthPx, heightPx } = template.page;
  if (widthValue !== widthPx || heightValue !== heightPx) throw new Error(`Finished image must be ${widthPx} by ${heightPx} pixels`);
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, session.event_id, sessionIdValue));
  const outputPath = ensureInside(folder, path.join(folder, `finished-${session.layout_id}-${randomUUID()}.jpg`));
  await writeAtomically(outputPath, bytes);
  const outputDatabase = openDatabase(userDataPath);
  try { outputDatabase.prepare('INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionIdValue, outputPath, `finished-${session.layout_id}`, widthValue, heightValue); }
  finally { outputDatabase.close(); }
  return outputPath;
}

/**
 * The animated extra (F23): a GIF loop or a boomerang, stored next to the session's photos so
 * the guest page can offer it like any other file. The bytes must really be a GIF — the type is
 * what the download page and the phone's image viewer will trust.
 */
export async function saveSessionAnimation(userDataPath: string, sessionIdValue: unknown, data: unknown, kindValue: unknown): Promise<string> {
  if (!isSessionId(sessionIdValue)) throw new Error('Invalid session id');
  if (kindValue !== 'gif' && kindValue !== 'boomerang') throw new Error('Animated extras are a GIF or a boomerang');
  const bytes = toPhotoBuffer(data);
  if (bytes.length < 13 || bytes.subarray(0, 4).toString('latin1') !== 'GIF8') throw new Error('Animated extra must be a GIF file');
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
  let session: { event_id: string } | undefined;
  try { session = database.prepare("SELECT event_id FROM sessions WHERE id = ? AND status = 'completed'").get(sessionIdValue) as typeof session; }
  finally { database.close(); }
  if (!session) throw new Error('Only completed sessions can save an animated extra');
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, session.event_id, sessionIdValue));
  const outputPath = ensureInside(folder, path.join(folder, `${kindValue}-${randomUUID()}.gif`));
  await writeAtomically(outputPath, bytes);
  const outputDatabase = openDatabase(userDataPath);
  try {
    outputDatabase.prepare('INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), sessionIdValue, outputPath, kindValue, bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  } finally { outputDatabase.close(); }
  return outputPath;
}

/**
 * A cut sheet is what actually goes through the printer for a 2 × 6 strip: the strip drawn
 * twice side by side on one 4 × 6 sheet, so two guests' copies come out of one piece of paper
 * (F18). It is stored next to the finished layout and printed in preference to it.
 */
export async function savePrintSheet(userDataPath: string, sessionIdValue: unknown, data: unknown, widthValue: unknown, heightValue: unknown): Promise<string> {
  if (!isSessionId(sessionIdValue) || typeof widthValue !== 'number' || typeof heightValue !== 'number'
    || !Number.isInteger(widthValue) || !Number.isInteger(heightValue) || widthValue < 1 || heightValue < 1) throw new Error('Invalid print sheet details');
  const bytes = toPhotoBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
  let session: { event_id: string; layout_id: string } | undefined;
  try { session = database.prepare("SELECT event_id, layout_id FROM sessions WHERE id = ? AND status = 'completed'").get(sessionIdValue) as typeof session; }
  finally { database.close(); }
  if (!session) throw new Error('Only completed sessions can save a print sheet');
  const template = loadTemplate(userDataPath, session.layout_id);
  if (template.page.id !== '2x6-strip') throw new Error('Only a 20 × 60 mm strip needs a cut sheet');
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, session.event_id, sessionIdValue));
  const outputPath = ensureInside(folder, path.join(folder, `print-sheet-${session.layout_id}-${randomUUID()}.jpg`));
  await writeAtomically(outputPath, bytes);
  const outputDatabase = openDatabase(userDataPath);
  try { outputDatabase.prepare('INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionIdValue, outputPath, `print-sheet-${session.layout_id}`, widthValue, heightValue); }
  finally { outputDatabase.close(); }
  return outputPath;
}
