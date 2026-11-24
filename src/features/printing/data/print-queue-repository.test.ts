import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/data/template-repository';
import { createSession } from '../../capture/node';
import { MockPrinter } from '../devices/printer';
import {
  cancelPrintJob, enqueuePrintJob, getPrintQueueSummary, isPrintQueuePaused, listPrintJobs, processNextPrintJob,
  reprintPrintJob, setPrintQueuePaused,
} from './print-queue-repository';
import type { PrintJob } from '../domain/print-queue-types';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

type Fixture = { directory: string; sessionId: string; eventId: string; outputPath: string };

type FixtureOptions = { printLimitPerSession?: number; paperCount?: number; status?: string; finish?: boolean };

/** A completed session with a saved finished layout, ready to be queued for printing. */
function setup({ printLimitPerSession = 2, paperCount = 0, status = 'completed', finish = true }: FixtureOptions = {}): Fixture {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-print-queue-'));
  directories.push(directory);
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
  const { sessionId } = createSession(directory, 'double-strip-3');
  const paths = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
  const db = new Database(path.join(directory, 'photobooth.sqlite'));
  const eventId = (db.prepare('SELECT event_id AS eventId FROM sessions WHERE id = ?').get(sessionId) as { eventId: string }).eventId;
  const folder = path.join(paths.photosDirectory, eventId, sessionId);
  fs.mkdirSync(folder, { recursive: true });
  const outputPath = path.join(folder, 'finished-double-strip-3.jpg');
  fs.writeFileSync(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  if (finish) db.prepare("INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES ('output-1', ?, ?, 'finished-double-strip-3', 1200, 1800)").run(sessionId, outputPath);
  db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, sessionId);
  db.prepare('UPDATE events SET print_limit_per_session = ?, paper_count = ? WHERE id = ?').run(printLimitPerSession, paperCount, eventId);
  db.close();
  return { directory, sessionId, eventId, outputPath };
}

describe('print queue (F18)', () => {
  it('queues a completed session and refuses a session that is still running', () => {
    const { directory, sessionId } = setup();
    const job = enqueuePrintJob(directory, sessionId, ' DNP QW410 ');
    expect(job).toMatchObject({ sessionId, printerName: 'DNP QW410', status: 'queued', attempts: 0, error: null });

    const running = setup({ status: 'in_progress' });
    expect(() => enqueuePrintJob(running.directory, running.sessionId, 'DNP QW410')).toThrow('Only completed sessions can be printed');
    expect(() => enqueuePrintJob(directory, sessionId, '   ')).toThrow('Choose a valid printer');
  });

  it('enforces the per-session limit, counting reprints but not cancelled jobs', () => {
    const { directory, sessionId } = setup({ printLimitPerSession: 1 });
    const first = enqueuePrintJob(directory, sessionId, 'DNP QW410');
    expect(() => enqueuePrintJob(directory, sessionId, 'DNP QW410')).toThrow('This session reached its print limit (1)');
    expect(() => reprintPrintJob(directory, first.id)).toThrow('reached its print limit');

    cancelPrintJob(directory, first.id);
    const retry = enqueuePrintJob(directory, sessionId, 'DNP QW410');
    expect(retry.status).toBe('queued');
    expect(listPrintJobs(directory, first.eventId).map((job) => job.status)).toEqual(['queued', 'cancelled']);
  });

  it('only cancels a job that has not reached the printer', async () => {
    const { directory, sessionId } = setup();
    const job = enqueuePrintJob(directory, sessionId, 'DNP QW410');
    await processNextPrintJob(directory, new MockPrinter());
    expect(() => cancelPrintJob(directory, job.id)).toThrow('Only a queued print can be cancelled');
    expect(listPrintJobs(directory)[0]?.status).toBe('done');
  });

  it('prints a queued job at the finished layout size and marks it done', async () => {
    const { directory, sessionId, outputPath } = setup();
    const job = enqueuePrintJob(directory, sessionId, 'DNP QW410');
    const printer = new MockPrinter();
    const printed = await processNextPrintJob(directory, printer);
    expect(printed).toMatchObject({ id: job.id, status: 'done', attempts: 1, error: null });
    expect(printer.jobs).toEqual([{ imagePath: outputPath, options: { printerName: 'DNP QW410', widthMicrons: 101_600, heightMicrons: 152_400 } }]);
    expect(await processNextPrintJob(directory, printer)).toBeNull();
    expect(printer.jobs).toHaveLength(1);
  });

  it('prints the paired strip sheet when one is saved', async () => {
    const { directory, sessionId, eventId, outputPath } = setup();
    const sheetPath = path.join(path.dirname(outputPath), 'print-sheet-double-strip-3.jpg');
    fs.writeFileSync(sheetPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    db.prepare("INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES ('output-2', ?, ?, 'print-sheet-double-strip-3', 1200, 1800)").run(sessionId, sheetPath);
    db.close();
    enqueuePrintJob(directory, sessionId, 'DNP QW410');
    const printer = new MockPrinter();
    await processNextPrintJob(directory, printer);
    expect(printer.jobs[0]?.imagePath).toBe(sheetPath);
    expect(listPrintJobs(directory, eventId)[0]?.status).toBe('done');
  });

  it('keeps a failed sheet with its error instead of losing it', async () => {
    const { directory, sessionId } = setup();
    const job = enqueuePrintJob(directory, sessionId, 'DNP QW410');
    const failed = await processNextPrintJob(directory, new MockPrinter({ success: false, error: 'Out of paper'.repeat(60) }));
    expect(failed?.status).toBe('failed');
    expect(failed?.attempts).toBe(1);
    expect(failed?.error?.length).toBe(300);
    expect(failed?.error?.startsWith('Out of paper')).toBe(true);
    expect(listPrintJobs(directory)[0]?.id).toBe(job.id);
  });

  it('claims a job before printing so a second look cannot print it twice', async () => {
    const { directory, sessionId } = setup();
    enqueuePrintJob(directory, sessionId, 'DNP QW410');
    const printer = new MockPrinter();
    let concurrent: PrintJob | null = null;
    const reentrant = { printImage: async (imagePath: string, options: Parameters<MockPrinter['printImage']>[1]) => {
      // A second worker tick that lands mid-print must find nothing left to claim.
      concurrent = await processNextPrintJob(directory, new MockPrinter());
      return printer.printImage(imagePath, options);
    } };
    const finished = await processNextPrintJob(directory, reentrant);
    expect(concurrent).toBeNull();
    expect(finished?.status).toBe('done');
    expect(printer.jobs).toHaveLength(1);
  });

  it('waits while the queue is paused and resumes with the same job', async () => {
    const { directory, sessionId } = setup();
    enqueuePrintJob(directory, sessionId, 'DNP QW410');
    expect(setPrintQueuePaused(directory, true)).toBe(true);
    expect(isPrintQueuePaused(directory)).toBe(true);
    const printer = new MockPrinter();
    expect(await processNextPrintJob(directory, printer)).toBeNull();
    expect(printer.jobs).toHaveLength(0);
    expect(listPrintJobs(directory)[0]?.status).toBe('queued');

    setPrintQueuePaused(directory, false);
    expect((await processNextPrintJob(directory, printer))?.status).toBe('done');
    expect(() => setPrintQueuePaused(directory, 'yes' as never)).toThrow('Invalid queue state');
  });

  it('reports counts, the pause state and a paper warning once the sheets are planned', async () => {
    const { directory, sessionId, eventId } = setup({ paperCount: 3, printLimitPerSession: 3 });
    enqueuePrintJob(directory, sessionId, 'DNP QW410');
    await processNextPrintJob(directory, new MockPrinter());
    enqueuePrintJob(directory, sessionId, 'DNP QW410');
    enqueuePrintJob(directory, sessionId, 'DNP QW410');

    const summary = getPrintQueueSummary(directory, eventId);
    expect(summary).toMatchObject({ queued: 2, printing: 0, done: 1, failed: 0, paused: false, paperCount: 3, sessionLimit: 3 });
    expect(summary.paperWarning).toContain('all 3 sheets of paper are planned');

    setPrintQueuePaused(directory, true);
    expect(getPrintQueueSummary(directory).paused).toBe(true);

    const spare = setup({ paperCount: 50 });
    enqueuePrintJob(spare.directory, spare.sessionId, 'DNP QW410');
    expect(getPrintQueueSummary(spare.directory, spare.eventId).paperWarning).toBeNull();
    const uncounted = setup();
    enqueuePrintJob(uncounted.directory, uncounted.sessionId, 'DNP QW410');
    expect(getPrintQueueSummary(uncounted.directory, uncounted.eventId).paperWarning).toBeNull();
  });

  it('rejects a session with nothing saved to print', async () => {
    const { directory, sessionId } = setup({ finish: false });
    enqueuePrintJob(directory, sessionId, 'DNP QW410');
    const failed = await processNextPrintJob(directory, new MockPrinter());
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('No finished layout is saved for this session');
  });
});
