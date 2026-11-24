import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { isRecordId } from '../../../shared/validation/identifiers';
import { describeProfile, resolvePrinterProfile, validatePrinterProfileDraft, type PrinterProfile } from '../domain/printer-profile';
import { findPrinterModel } from '../domain/printer-models';

const PROFILE_COLUMNS = `id, name, model_id AS modelId, printer_name AS printerName, paper_id AS paperId,
  cut_mode AS cutMode, color_mode AS colorMode, brightness, contrast, saturation, is_default AS isDefault,
  verified_at AS verifiedAt, created_at AS createdAt, updated_at AS updatedAt`;

type ProfileRow = Omit<PrinterProfile, 'isDefault'> & { isDefault: number };

function mapProfile(row: ProfileRow): PrinterProfile {
  return {
    id: row.id, name: row.name, modelId: row.modelId, printerName: row.printerName, paperId: row.paperId,
    cutMode: row.cutMode, colorMode: row.colorMode, brightness: row.brightness, contrast: row.contrast,
    saturation: row.saturation, isDefault: Boolean(row.isDefault), verifiedAt: row.verifiedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function readProfile(database: ReturnType<typeof openDatabase>, id: string): PrinterProfile | undefined {
  const row = database.prepare(`SELECT ${PROFILE_COLUMNS} FROM printer_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
  return row ? mapProfile(row) : undefined;
}

/** The default profile first, then by name, so the panel opens on what the booth would use. */
export function listPrinterProfiles(userDataPath: string): PrinterProfile[] {
  const database = openDatabase(userDataPath);
  try {
    const rows = database.prepare(`SELECT ${PROFILE_COLUMNS} FROM printer_profiles ORDER BY is_default DESC, name COLLATE NOCASE`).all() as ProfileRow[];
    return rows.map(mapProfile);
  } finally { database.close(); }
}

export function getPrinterProfile(userDataPath: string, idValue: unknown): PrinterProfile | null {
  if (!isRecordId(idValue)) return null;
  const database = openDatabase(userDataPath);
  try { return readProfile(database, idValue) ?? null; } finally { database.close(); }
}

export function resolvePrintProfile(userDataPath: string, printerName: string): PrinterProfile | null {
  return resolvePrinterProfile(listPrinterProfiles(userDataPath), printerName);
}

function assertPrinterIsFree(database: ReturnType<typeof openDatabase>, printerName: string, id: string | undefined): void {
  if (!printerName) return;
  const clash = database.prepare('SELECT id, name FROM printer_profiles WHERE printer_name = ? COLLATE NOCASE AND id <> ?')
    .get(printerName, id ?? '') as { name: string } | undefined;
  if (clash) throw new Error(`That printer already has a profile ("${clash.name}"). Edit that one or unlink it first.`);
}

/** Settings that make a checked test print stale once they change. */
function settingsChanged(before: PrinterProfile, draft: PrinterProfile): boolean {
  return before.modelId !== draft.modelId || before.paperId !== draft.paperId || before.cutMode !== draft.cutMode
    || before.colorMode !== draft.colorMode || before.brightness !== draft.brightness
    || before.contrast !== draft.contrast || before.saturation !== draft.saturation;
}

/**
 * Creates or updates a profile. Changing anything that affected the last test print clears its
 * tick, because a checked sheet no longer describes these settings.
 */
export function savePrinterProfile(userDataPath: string, draftValue: unknown): PrinterProfile {
  const draft = validatePrinterProfileDraft(draftValue);
  const database = openDatabase(userDataPath);
  try {
    const existing = draft.id ? readProfile(database, draft.id) : undefined;
    if (draft.id && !existing) throw new Error('Printer profile not found');
    const id = existing?.id ?? randomUUID();
    assertPrinterIsFree(database, draft.printerName, existing?.id);
    const verifiedAt = existing && !settingsChanged(existing, draft as PrinterProfile) ? existing.verifiedAt : null;

    database.transaction(() => {
      if (draft.isDefault) {
        database.prepare('UPDATE printer_profiles SET is_default = 0, updated_at = datetime(\'now\') WHERE is_default = 1 AND id <> ?').run(id);
      }
      if (existing) {
        database.prepare(`UPDATE printer_profiles SET name = ?, model_id = ?, printer_name = ?, paper_id = ?, cut_mode = ?,
          color_mode = ?, brightness = ?, contrast = ?, saturation = ?, is_default = ?, verified_at = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(draft.name, draft.modelId, draft.printerName, draft.paperId, draft.cutMode, draft.colorMode,
            draft.brightness, draft.contrast, draft.saturation, draft.isDefault ? 1 : 0, verifiedAt, id);
      } else {
        database.prepare(`INSERT INTO printer_profiles (id, name, model_id, printer_name, paper_id, cut_mode, color_mode,
          brightness, contrast, saturation, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, draft.name, draft.modelId, draft.printerName, draft.paperId, draft.cutMode, draft.colorMode,
            draft.brightness, draft.contrast, draft.saturation, draft.isDefault ? 1 : 0);
      }
    })();
    return readProfile(database, id)!;
  } finally { database.close(); }
}

export function deletePrinterProfile(userDataPath: string, idValue: unknown): boolean {
  if (!isRecordId(idValue)) throw new Error('Invalid printer profile');
  const database = openDatabase(userDataPath);
  try {
    const changed = database.prepare('DELETE FROM printer_profiles WHERE id = ?').run(idValue).changes;
    if (!changed) throw new Error('Printer profile not found');
    return true;
  } finally { database.close(); }
}

/** The operator ticked (or cleared) the test print for this profile. */
export function markPrinterProfileChecked(userDataPath: string, idValue: unknown, checked: unknown): PrinterProfile {
  if (!isRecordId(idValue)) throw new Error('Invalid printer profile');
  if (typeof checked !== 'boolean') throw new Error('Invalid test print state');
  const database = openDatabase(userDataPath);
  try {
    const changed = database.prepare(`UPDATE printer_profiles SET verified_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(checked ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, idValue).changes;
    if (!changed) throw new Error('Printer profile not found');
    return readProfile(database, idValue)!;
  } finally { database.close(); }
}

/** The label stored on a print job, so queue history still reads after the profile is edited. */
export function profileLabelFor(profile: PrinterProfile | null): string | null {
  if (!profile) return null;
  const model = findPrinterModel(profile.modelId);
  return model ? describeProfile(profile) : profile.name;
}
