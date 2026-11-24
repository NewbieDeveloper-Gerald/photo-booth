import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { isEventId } from '../../../shared/validation/identifiers';
import type { ActiveEvent, EventSettings } from '../../../shared/types/event';
import { storeEventLogoPath } from './event-assets';
import { isValidRetakeLimit } from '../../capture/domain/retake-rules';
import { validateEventSettings } from './event-validation';

type EventRow = { id: string; name: string; shots: number; retake_limit: number; print_enabled: number; expiry_days: number };

export function listEvents(userDataPath: string): EventSettings[] {
  const database = openDatabase(userDataPath);
  try { return database.prepare(`SELECT id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
    primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
    default_layout_id AS defaultLayoutId FROM events ORDER BY name COLLATE NOCASE`).all() as EventSettings[]; }
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
    if (exists) database.prepare(`UPDATE events SET name = ?, shots = ?, expiry_days = ?, event_date = ?, primary_color = ?, accent_color = ?,
      welcome_text = ?, thank_you_text = ?, default_layout_id = ? WHERE id = ?`).run(fields.name, fields.shots, fields.expiryDays, fields.eventDate,
      fields.primaryColor, fields.accentColor, fields.welcomeText, fields.thankYouText, fields.defaultLayoutId, id);
    else database.prepare(`INSERT INTO events (id, name, shots, retake_limit, print_enabled, expiry_days, event_date, primary_color, accent_color,
      welcome_text, thank_you_text, default_layout_id) VALUES (?, ?, ?, 3, 1, ?, ?, ?, ?, ?, ?, ?)`).run(id, fields.name, fields.shots, fields.expiryDays,
      fields.eventDate, fields.primaryColor, fields.accentColor, fields.welcomeText, fields.thankYouText, fields.defaultLayoutId);
    return database.prepare(`SELECT id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
      primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
      default_layout_id AS defaultLayoutId FROM events WHERE id = ?`).get(id) as EventSettings;
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
  try { source = database.prepare(`SELECT id, name, shots, expiry_days AS expiryDays, event_date AS eventDate, logo_path AS logoPath,
    primary_color AS primaryColor, accent_color AS accentColor, welcome_text AS welcomeText, thank_you_text AS thankYouText,
    default_layout_id AS defaultLayoutId FROM events WHERE id = ?`).get(eventId) as EventSettings | undefined; }
  finally { database.close(); }
  if (!source) throw new Error('Event not found');
  const copy = saveEventSettings(userDataPath, { ...source, id: undefined, name: `${source.name} Copy` });
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
    const row = database.prepare(`SELECT e.id, e.name, e.shots, e.retake_limit, e.print_enabled, e.expiry_days,
      e.event_date AS eventDate, e.logo_path AS logoPath, e.primary_color AS primaryColor, e.accent_color AS accentColor,
      e.welcome_text AS welcomeText, e.thank_you_text AS thankYouText, e.default_layout_id AS defaultLayoutId
      FROM events e JOIN settings s ON s.key = 'activeEventId' AND s.value = e.id LIMIT 1`).get() as (EventRow & {
        eventDate: string | null; logoPath: string | null; primaryColor: string; accentColor: string;
        welcomeText: string; thankYouText: string; defaultLayoutId: string;
      }) | undefined;
    if (!row) throw new Error('No active event is configured');
    return { id: row.id, name: row.name, shots: row.shots, retakeLimit: row.retake_limit, printEnabled: Boolean(row.print_enabled), expiryDays: row.expiry_days,
      eventDate: row.eventDate, logoPath: row.logoPath, primaryColor: row.primaryColor, accentColor: row.accentColor,
      welcomeText: row.welcomeText, thankYouText: row.thankYouText, defaultLayoutId: row.defaultLayoutId };
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
