import { openDatabase } from '../../storage/database/connection';
import { getConfiguredStoragePaths } from '../../storage/database/storage-paths';
import { ensureInside } from '../../../shared/fs/safe-paths';
import { isSessionId } from '../../../shared/validation/identifiers';
import { loadTemplate } from '../../layouts/data/template-repository';

/**
 * The page size comes from the session's stored template, so any template (4 × 6,
 * 2 × 6 strip, 5 × 7, square) prints at its own size without a printer-side list.
 */
export function getLatestSessionPrintInfo(userDataPath: string, sessionIdValue: unknown): { imagePath: string; width: number; height: number } {
  if (!isSessionId(sessionIdValue)) throw new Error('Invalid session id');
  const database = openDatabase(userDataPath);
  const paths = getConfiguredStoragePaths(userDataPath);
  let row: { imagePath: string; layoutId: string } | undefined;
  try {
    row = database.prepare(`SELECT o.output_path AS imagePath, s.layout_id AS layoutId
      FROM outputs o JOIN sessions s ON s.id = o.session_id
      WHERE o.session_id = ? AND o.kind LIKE 'finished-%'
      ORDER BY o.created_at DESC, o.rowid DESC LIMIT 1`).get(sessionIdValue) as { imagePath: string; layoutId: string } | undefined;
  } finally { database.close(); }
  if (!row) throw new Error('No finished layout is saved for this session');
  const template = loadTemplate(userDataPath, row.layoutId);
  return { imagePath: ensureInside(paths.photosDirectory, row.imagePath), width: template.page.widthPx, height: template.page.heightPx };
}
