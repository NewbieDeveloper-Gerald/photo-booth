import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { isEventId } from '../../../shared/validation/identifiers';
import type { ActiveEvent, EventSettings } from '../../../shared/types/event';
import { storeEventLogoPath } from './event-assets';
import { isValidRetakeLimit } from '../../capture/domain/retake-rules';
import { validateEventSettings, validateGalleryPassword } from './event-validation';
import { hashSecret } from '../../../shared/crypto/secret-hash';

const EVENT_COLUMNS = `id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
  primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
  default_layout_id AS defaultLayoutId, offered_layout_ids AS offeredLayoutIds,
  consent_text AS consentText, contact_text AS contactText,
  gallery_token AS galleryToken, gallery_password_hash AS galleryPasswordHash,
  watermark_enabled AS watermarkEnabled, watermark_position AS watermarkPosition,
  watermark_scale_percent AS watermarkScalePercent, watermark_opacity AS watermarkOpacity,
  print_limit_per_session AS printLimitPerSession, paper_count AS paperCount`;

type EventListRow = Omit<EventSettings, 'galleryToken' | 'galleryPasswordSet' | 'watermarkEnabled'> & {
  offeredLayoutIds: string; galleryToken: string | null; galleryPasswordHash: string | null; watermarkEnabled: number;
};

/** The column is JSON; a corrupt value must not break the booth screen, so fall back to the default layout. */
function parseOfferedLayoutIds(raw: string, defaultLayoutId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
      if (ids.length > 0) return ids;
    }
  } catch { /* fall through to the default */ }
  return [defaultLayoutId];
}

/** Mapped field by field (never spread) so extra SELECT columns cannot leak into the public shape. */
function toEventSettings(row: EventListRow): EventSettings {
  return {
    id: row.id, name: row.name, shots: row.shots, expiryDays: row.expiryDays, eventDate: row.eventDate,
    logoPath: row.logoPath, primaryColor: row.primaryColor, accentColor: row.accentColor,
    welcomeText: row.welcomeText, thankYouText: row.thankYouText, defaultLayoutId: row.defaultLayoutId,
    offeredLayoutIds: parseOfferedLayoutIds(row.offeredLayoutIds, row.defaultLayoutId),
    consentText: row.consentText, contactText: row.contactText,
    galleryToken: row.galleryToken, galleryPasswordSet: row.galleryPasswordHash !== null,
    watermarkEnabled: Boolean(row.watermarkEnabled), watermarkPosition: row.watermarkPosition,
    watermarkScalePercent: row.watermarkScalePercent, watermarkOpacity: row.watermarkOpacity,
    printLimitPerSession: row.printLimitPerSession, paperCount: row.paperCount,
  };
}

/**
 * The guest list must reference real layouts: unknown ids are dropped, and an empty list
 * falls back to the event's default layout so the booth always has something to shoot.
 */
function resolveOfferedLayoutIds(database: ReturnType<typeof openDatabase>, offered: string[], defaultLayoutId: string): string[] {
  const known = new Set(database.prepare('SELECT id FROM templates').all().map((row) => (row as { id: string }).id));
  const valid = offered.filter((id) => known.has(id));
  if (valid.length === 0) return known.has(defaultLayoutId) ? [defaultLayoutId] : [];
  const ordered = [...new Set([defaultLayoutId, ...valid])].filter((id) => known.has(id));
  return ordered;
}

export function listEvents(userDataPath: string): EventSettings[] {
  const database = openDatabase(userDataPath);
  try { return (database.prepare(`SELECT ${EVENT_COLUMNS} FROM events ORDER BY name COLLATE NOCASE`).all() as EventListRow[]).map(toEventSettings); }
  finally { database.close(); }
}

export function saveEventSettings(userDataPath: string, input: unknown): EventSettings {
  if (!input || typeof input !== 'object') throw new Error('Invalid event details');
  const item = input as Record<string, unknown>;
  const fields = validateEventSettings(input);
  const id = typeof item.id === 'string' && item.id ? item.id : randomUUID();
  const database = openDatabase(userDataPath);
  try {
    const exists = database.prepare('SELECT 1 FROM events WHERE id = ?').get(id);
    if (item.id && !exists) throw new Error('Event not found');
    const offeredLayoutIds = resolveOfferedLayoutIds(database, fields.offeredLayoutIds, fields.defaultLayoutId);
    const offeredJson = JSON.stringify(offeredLayoutIds);
    if (exists) database.prepare(`UPDATE events SET name = ?, shots = ?, expiry_days = ?, event_date = ?, primary_color = ?, accent_color = ?,
      welcome_text = ?, thank_you_text = ?, default_layout_id = ?, offered_layout_ids = ?, consent_text = ?, contact_text = ?,
      watermark_enabled = ?, watermark_position = ?, watermark_scale_percent = ?, watermark_opacity = ?,
      print_limit_per_session = ?, paper_count = ? WHERE id = ?`).run(fields.name, fields.shots,
      fields.expiryDays, fields.eventDate, fields.primaryColor, fields.accentColor, fields.welcomeText, fields.thankYouText, fields.defaultLayoutId, offeredJson,
      fields.consentText, fields.contactText, Number(fields.watermarkEnabled), fields.watermarkPosition, fields.watermarkScalePercent, fields.watermarkOpacity,
      fields.printLimitPerSession, fields.paperCount, id);
    else database.prepare(`INSERT INTO events (id, name, shots, retake_limit, print_enabled, expiry_days, event_date, primary_color, accent_color,
      welcome_text, thank_you_text, default_layout_id, offered_layout_ids, consent_text, contact_text,
      watermark_enabled, watermark_position, watermark_scale_percent, watermark_opacity,
      print_limit_per_session, paper_count) VALUES (?, ?, ?, 3, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, fields.name,
      fields.shots, fields.expiryDays, fields.eventDate, fields.primaryColor, fields.accentColor, fields.welcomeText, fields.thankYouText, fields.defaultLayoutId,
      offeredJson, fields.consentText, fields.contactText, Number(fields.watermarkEnabled), fields.watermarkPosition, fields.watermarkScalePercent, fields.watermarkOpacity,
      fields.printLimitPerSession, fields.paperCount);
    const galleryPassword = validateGalleryPassword(item.galleryPassword);
    if (galleryPassword !== undefined) {
      database.prepare('UPDATE events SET gallery_password_hash = ? WHERE id = ?').run(galleryPassword === null ? null : hashSecret(galleryPassword), id);
    }
    return toEventSettings(database.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(id) as EventListRow);
  } finally { database.close(); }
}

export function selectActiveEvent(userDataPath: string, eventId: unknown): ActiveEvent {
  if (!isEventId(eventId)) throw new Error('Invalid event');
  const database = openDatabase(userDataPath);
  try {
    if (!database.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw new Error('Event not found');
    database.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('activeEventId', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(eventId);
  } finally { database.close(); }
  return getActiveEvent(userDataPath);
}

export function duplicateEvent(userDataPath: string, eventId: unknown): EventSettings {
  if (!isEventId(eventId)) throw new Error('Invalid event');
  const database = openDatabase(userDataPath);
  let source: EventSettings | undefined;
  try {
    const row = database.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(eventId) as EventListRow | undefined;
    source = row ? toEventSettings(row) : undefined;
  } finally { database.close(); }
  if (!source) throw new Error('Event not found');
  // A duplicate is a fresh event: it must not share the original's gallery link or password.
  const duplicateInput: Record<string, unknown> = { ...source, id: undefined, name: `${source.name} Copy` };
  delete duplicateInput.galleryToken;
  delete duplicateInput.galleryPasswordSet;
  const copy = saveEventSettings(userDataPath, duplicateInput);
  if (source.logoPath && fs.existsSync(source.logoPath)) {
    const copied = storeEventLogoPath(userDataPath, copy.id, source.logoPath);
    const update = openDatabase(userDataPath);
    try { update.prepare('UPDATE events SET logo_path = ? WHERE id = ?').run(copied, copy.id); }
    finally { update.close(); }
    return { ...copy, logoPath: copied };
  }
  return copy;
}

export function getActiveEvent(userDataPath: string): ActiveEvent {
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare(`SELECT ${EVENT_COLUMNS}, e.retake_limit AS retakeLimit, e.print_enabled AS printEnabled
      FROM events e JOIN settings s ON s.key = 'activeEventId' AND s.value = e.id LIMIT 1`).get() as
      (EventListRow & { retakeLimit: number; printEnabled: number }) | undefined;
    if (!row) throw new Error('No active event is configured');
    return { ...toEventSettings(row), retakeLimit: row.retakeLimit, printEnabled: Boolean(row.printEnabled) };
  } finally {
    database.close();
  }
}

export function setActiveEventRetakeLimit(userDataPath: string, limit: unknown): ActiveEvent {
  if (typeof limit !== 'number' || !isValidRetakeLimit(limit)) throw new Error('Retake limit must be a nonnegative whole number, or unlimited');
  const database = openDatabase(userDataPath);
  try {
    const activeEventId = database.prepare("SELECT value FROM settings WHERE key = 'activeEventId'").get() as { value: string } | undefined;
    if (!activeEventId) throw new Error('No active event is configured');
    database.prepare('UPDATE events SET retake_limit = ? WHERE id = ?').run(limit, activeEventId.value);
  } finally {
    database.close();
  }
  return getActiveEvent(userDataPath);
}
