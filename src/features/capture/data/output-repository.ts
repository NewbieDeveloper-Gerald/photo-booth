import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import path from 'node:path';
import { toPhotoBuffer, writeAtomically } from './photo-files';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isSessionId } from '../../../shared/validation/identifiers';
import { getLayoutPreset } from '../../layouts/catalog';

export async function saveSessionOutput(userDataPath: string, sessionIdValue: unknown, data: unknown, widthValue: unknown, heightValue: unknown): Promise<string> {
  if (!isSessionId(sessionIdValue) || !Number.isInteger(widthValue) || !Number.isInteger(heightValue)) throw new Error('Invalid finished image details');
  const bytes = toPhotoBuffer(data);
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
  let session: { event_id: string; layout_id: string } | undefined;
  try { session = database.prepare("SELECT event_id, layout_id FROM sessions WHERE id = ? AND status = 'completed'").get(sessionIdValue) as typeof session; }
  finally { database.close(); }
  if (!session) throw new Error('Only completed sessions can save a finished image');
  const layout = getLayoutPreset(session.layout_id);
  if (widthValue !== layout.width || heightValue !== layout.height) throw new Error(`Finished image must be ${layout.width} by ${layout.height} pixels`);
  const folder = ensureInside(paths.photosDirectory, path.join(paths.photosDirectory, session.event_id, sessionIdValue));
  const outputPath = ensureInside(folder, path.join(folder, `finished-${session.layout_id}-${randomUUID()}.jpg`));
  await writeAtomically(outputPath, bytes);
  const outputDatabase = openDatabase(userDataPath);
  try { outputDatabase.prepare('INSERT INTO outputs (id, session_id, output_path, kind) VALUES (?, ?, ?, ?)').run(randomUUID(), sessionIdValue, outputPath, `finished-${session.layout_id}`); }
  finally { outputDatabase.close(); }
  return outputPath;
}
