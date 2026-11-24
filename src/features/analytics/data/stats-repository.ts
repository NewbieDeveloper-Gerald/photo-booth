import Database from 'better-sqlite3';
import { openDatabase } from '../../storage/database/connection';
import { boothTotals } from '../domain/stats';
import type { BoothStats, EventStats } from '../../../shared/types/analytics';
import { isSessionId } from '../../../shared/validation/identifiers';

type StatsRow = {
  eventId: string; eventName: string; sessions: number; photos: number; retakes: number;
  prints: number; downloads: number; averageSeconds: number | null;
};

const DOWNLOAD_KINDS = ['photo', 'layout', 'gif', 'boomerang', 'zip'];

/**
 * One query for the whole dashboard (F24): every number is a sub-select on the records the
 * booth already keeps, so the page cannot drift from the sessions it describes.
 */
export function readBoothStats(userDataPath: string, now = new Date()): BoothStats {
  const database = openDatabase(userDataPath);
  try {
    const rows = database.prepare(`
      SELECT e.id AS eventId, e.name AS eventName,
        (SELECT COUNT(*) FROM sessions s WHERE s.event_id = e.id AND s.status = 'completed') AS sessions,
        (SELECT COUNT(*) FROM photos p
          JOIN slots sl ON sl.id = p.slot_id
          JOIN sessions sp ON sp.id = sl.session_id
          WHERE sp.event_id = e.id) AS photos,
        (SELECT COALESCE(SUM(sr.retakes_used), 0) FROM sessions sr WHERE sr.event_id = e.id) AS retakes,
        (SELECT COUNT(*) FROM print_jobs pj WHERE pj.event_id = e.id AND pj.status = 'done') AS prints,
        (SELECT COUNT(*) FROM download_events d WHERE d.event_id = e.id) AS downloads,
        (SELECT AVG(strftime('%s', su.updated_at) - strftime('%s', su.created_at)) FROM sessions su
          WHERE su.event_id = e.id AND su.status = 'completed') AS averageSeconds
      FROM events e
      ORDER BY e.name COLLATE NOCASE`).all() as StatsRow[];
    const events: EventStats[] = rows.map((row) => ({
      eventId: row.eventId,
      eventName: row.eventName,
      sessions: Number(row.sessions),
      photos: Number(row.photos),
      retakes: Number(row.retakes),
      prints: Number(row.prints),
      downloads: Number(row.downloads),
      averageSessionSeconds: row.averageSeconds === null ? null : Math.round(Number(row.averageSeconds)),
    }));
    return { generatedAt: now.toISOString(), events, totals: boothTotals(events) };
  } finally { database.close(); }
}

/**
 * One row per guest request (F24). Only ids, a kind and a time are kept — no address, no agent,
 * nothing that identifies a person — because a booth's photos are already the private part.
 */
export function recordDownloadEvent(databasePath: string, sessionId: unknown, kind: unknown): void {
  if (!isSessionId(sessionId) || typeof kind !== 'string' || !DOWNLOAD_KINDS.includes(kind)) return;
  // The share server hands over the database file, not the booth's data folder, so this opens
  // the file directly rather than going through openDatabase(userDataPath).
  const database = new Database(databasePath);
  try {
    const session = database.prepare('SELECT event_id FROM sessions WHERE id = ?').get(sessionId) as { event_id: string } | undefined;
    if (!session) return;
    database.prepare('INSERT INTO download_events (id, session_id, event_id, kind) VALUES (lower(hex(randomblob(16))), ?, ?, ?)')
      .run(sessionId, session.event_id, kind);
  } catch { /* a dashboard counter must never break a guest download */ }
  finally { try { database.close(); } catch { /* already gone */ } }
}
