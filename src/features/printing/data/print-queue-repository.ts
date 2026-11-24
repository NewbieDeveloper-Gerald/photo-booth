import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../storage/database/connection';
import { isSessionId } from '../../../shared/validation/identifiers';
import { toErrorMessage } from '../../../shared/errors';
import { getLatestSessionPrintInfo } from './print-job-repository';
import { pageSizeMicrons } from '../devices/printer';
import type { PrintJob, PrintJobStatus, PrintQueuePrinter, PrintQueueSummary } from '../domain/print-queue-types';

const PAUSED_KEY = 'printQueuePaused';
const MAX_PRINTER_NAME_LENGTH = 256;
const MAX_PRINT_ERROR_LENGTH = 300;
/** Prints that count against the per-session limit; a cancelled job never does. */
const COUNTED_STATUSES = "('queued', 'printing', 'done', 'failed')";

function mapJob(row: Record<string, unknown>): PrintJob {
  return {
    id: String(row.id), sessionId: String(row.session_id), eventId: String(row.event_id), printerName: String(row.printer_name),
    status: row.status as PrintJobStatus, attempts: Number(row.attempts),
    error: row.error === null ? null : String(row.error), createdAt: String(row.created_at),
  };
}

function assertPrinterName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PRINTER_NAME_LENGTH) throw new Error('Choose a valid printer');
  return value.trim();
}

type EventPrintRules = { id: string; printLimitPerSession: number; paperCount: number };

function readEventForSession(database: ReturnType<typeof openDatabase>, sessionId: string): EventPrintRules | undefined {
  return database.prepare(`SELECT e.id, e.print_limit_per_session AS printLimitPerSession, e.paper_count AS paperCount
    FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = ? AND s.status = 'completed'`).get(sessionId) as EventPrintRules | undefined;
}

function countPrintsForSession(database: ReturnType<typeof openDatabase>, sessionId: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM print_jobs WHERE session_id = ? AND status IN ${COUNTED_STATUSES}`).get(sessionId) as { count: number };
  return row.count;
}

/**
 * Adds a print to the queue. The per-session limit is enforced here rather than in the UI, so
 * an automatic print plus reprints can never quietly spend more paper than the operator set.
 */
export function enqueuePrintJob(userDataPath: string, sessionIdValue: unknown, printerNameValue: unknown): PrintJob {
  if (!isSessionId(sessionIdValue)) throw new Error('Invalid session id');
  const printerName = assertPrinterName(printerNameValue);
  const database = openDatabase(userDataPath);
  try {
    const event = readEventForSession(database, sessionIdValue);
    if (!event) throw new Error('Only completed sessions can be printed');
    const prints = countPrintsForSession(database, sessionIdValue);
    if (prints >= event.printLimitPerSession) {
      throw new Error(`This session reached its print limit (${event.printLimitPerSession}). Raise the limit in event setup to print again.`);
    }
    const id = randomUUID();
    database.prepare(`INSERT INTO print_jobs (id, session_id, event_id, printer_name, status) VALUES (?, ?, ?, ?, 'queued')`)
      .run(id, sessionIdValue, event.id, printerName);
    return mapJob(database.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id) as Record<string, unknown>);
  } finally { database.close(); }
}

/** Reprinting is just another queued print, so it obeys the same limit and the same paper total. */
export function reprintPrintJob(userDataPath: string, jobIdValue: unknown): PrintJob {
  if (typeof jobIdValue !== 'string' || !jobIdValue) throw new Error('Invalid print job');
  const database = openDatabase(userDataPath);
  let job: { session_id: string; printer_name: string } | undefined;
  try { job = database.prepare('SELECT session_id, printer_name FROM print_jobs WHERE id = ?').get(jobIdValue) as typeof job; }
  finally { database.close(); }
  if (!job) throw new Error('Print job not found');
  return enqueuePrintJob(userDataPath, job.session_id, job.printer_name);
}

export function listPrintJobs(userDataPath: string, eventId?: string): PrintJob[] {
  const database = openDatabase(userDataPath);
  try {
    const rows = eventId
      ? database.prepare('SELECT * FROM print_jobs WHERE event_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50').all(eventId)
      : database.prepare('SELECT * FROM print_jobs ORDER BY created_at DESC, rowid DESC LIMIT 50').all();
    return (rows as Array<Record<string, unknown>>).map(mapJob);
  } finally { database.close(); }
}

export function isPrintQueuePaused(userDataPath: string): boolean {
  const database = openDatabase(userDataPath);
  try {
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(PAUSED_KEY) as { value: string } | undefined;
    return row?.value === '1';
  } finally { database.close(); }
}

export function setPrintQueuePaused(userDataPath: string, paused: unknown): boolean {
  if (typeof paused !== 'boolean') throw new Error('Invalid queue state');
  const database = openDatabase(userDataPath);
  try {
    database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(PAUSED_KEY, paused ? '1' : '0');
    return paused;
  } finally { database.close(); }
}

/**
 * Only a job that has not reached the printer can be cancelled; the paper either goes
 * through or it does not, so cancelling a printing job would lie to the operator.
 */
export function cancelPrintJob(userDataPath: string, jobIdValue: unknown): PrintJob {
  if (typeof jobIdValue !== 'string' || !jobIdValue) throw new Error('Invalid print job');
  const database = openDatabase(userDataPath);
  try {
    const changed = database.prepare("UPDATE print_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status IN ('queued', 'failed')")
      .run(jobIdValue).changes;
    if (!changed) throw new Error('Only a queued print can be cancelled');
    return mapJob(database.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobIdValue) as Record<string, unknown>);
  } finally { database.close(); }
}

export function getPrintQueueSummary(userDataPath: string, eventIdValue?: unknown): PrintQueueSummary {
  const database = openDatabase(userDataPath);
  try {
    const eventId = typeof eventIdValue === 'string' ? eventIdValue : undefined;
    const rows = (eventId
      ? database.prepare('SELECT status, COUNT(*) AS count FROM print_jobs WHERE event_id = ? GROUP BY status').all(eventId)
      : database.prepare('SELECT status, COUNT(*) AS count FROM print_jobs GROUP BY status').all()) as Array<{ status: string; count: number }>;
    const counts = new Map(rows.map((row) => [row.status, row.count]));
    const event = eventId
      ? database.prepare('SELECT print_limit_per_session AS sessionLimit, paper_count AS paperCount FROM events WHERE id = ?').get(eventId) as { sessionLimit: number; paperCount: number } | undefined
      : undefined;
    const paused = (database.prepare('SELECT value FROM settings WHERE key = ?').get(PAUSED_KEY) as { value: string } | undefined)?.value === '1';
    const done = counts.get('done') ?? 0;
    const queued = counts.get('queued') ?? 0;
    const printing = counts.get('printing') ?? 0;
    const paperCount = event?.paperCount ?? 0;
    const planned = done + queued + printing;
    // The sheet count is what the operator typed into event setup, so once the planned prints
    // reach it they need to reload paper and raise the number rather than guess.
    const paperWarning = paperCount === 0 || planned < paperCount
      ? null
      : planned > paperCount
        ? `Paper warning: ${planned} sheets planned for ${paperCount} sheets of paper — reload paper and raise the paper count.`
        : `Paper warning: all ${paperCount} sheets of paper are planned — reload paper and raise the paper count to keep printing.`;
    return { queued, printing, done, failed: counts.get('failed') ?? 0, paused, paperCount, sessionLimit: event?.sessionLimit ?? 0, paperWarning };
  } finally { database.close(); }
}

/**
 * Sends the oldest queued job. The row is claimed before printing so a second worker (or a
 * restart mid-job) cannot send the same sheet twice; failures stay visible with their error.
 */
export async function processNextPrintJob(
  userDataPath: string,
  printer: PrintQueuePrinter,
): Promise<PrintJob | null> {
  const database = openDatabase(userDataPath);
  let job: PrintJob | undefined;
  try {
    if ((database.prepare('SELECT value FROM settings WHERE key = ?').get(PAUSED_KEY) as { value: string } | undefined)?.value === '1') return null;
    const row = database.prepare("SELECT * FROM print_jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1").get() as Record<string, unknown> | undefined;
    if (!row) return null;
    job = mapJob(row);
    database.prepare("UPDATE print_jobs SET status = 'printing', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ? AND status = 'queued'").run(job.id);
  } finally { database.close(); }
  if (!job) return null;

  const finish = (status: PrintJobStatus, error: string | null): PrintJob | null => {
    const update = openDatabase(userDataPath);
    try {
      update.prepare("UPDATE print_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
        .run(status, error, job!.id);
      return mapJob(update.prepare('SELECT * FROM print_jobs WHERE id = ?').get(job!.id) as Record<string, unknown>);
    } finally { update.close(); }
  };

  try {
    const info = getLatestSessionPrintInfo(userDataPath, job.sessionId);
    const result = await printer.printImage(info.imagePath, { printerName: job.printerName, ...pageSizeMicrons(info.width, info.height) });
    return finish(result.success ? 'done' : 'failed', result.success ? null : (result.error ?? 'Printer reported a failure').slice(0, MAX_PRINT_ERROR_LENGTH));
  } catch (error) {
    return finish('failed', toErrorMessage(error, 'Could not print').slice(0, MAX_PRINT_ERROR_LENGTH));
  }
}
