import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPrintQueueScheduler } from './scheduler';
import type { PrintJob, PrintQueuePrinter } from './domain/print-queue-types';

const printer: PrintQueuePrinter = { printImage: async () => ({ success: true }) };

function job(id: string): PrintJob {
  return {
    id, sessionId: 'session-1', eventId: 'event-1', printerName: 'DNP QW410', profileId: null, profileLabel: null,
    status: 'done', attempts: 1, error: null, createdAt: '2026-11-24 10:00:00',
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('print worker loop (F18)', () => {
  it('drains a backlog ten sheets at a time', async () => {
    const runOnce = vi.fn(async () => job('job'));
    const scheduler = startPrintQueueScheduler({ userDataPath: '/tmp/unused', printer, runOnce });
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(10));
    scheduler.stop();
  });

  it('picks the queue up again when it is woken after going idle', async () => {
    const pending: Array<PrintJob | null> = [job('first'), null, job('second'), null];
    const runOnce = vi.fn(async () => pending.shift() ?? null);
    const scheduler = startPrintQueueScheduler({ userDataPath: '/tmp/unused', printer, runOnce, intervalMs: 60_000 });
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(2));
    scheduler.wake();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(4));
    scheduler.stop();
  });

  it('reports a broken run and keeps the worker alive', async () => {
    const onError = vi.fn();
    let calls = 0;
    const runOnce = vi.fn(async () => { calls += 1; if (calls === 1) throw new Error('database is locked'); return job('later'); });
    const scheduler = startPrintQueueScheduler({ userDataPath: '/tmp/unused', printer, runOnce, onError, intervalMs: 10 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('database is locked'));
    await vi.waitFor(() => expect(runOnce.mock.calls.length).toBeGreaterThan(1));
    scheduler.stop();
  });

  it('stops ticking once the booth is quitting', async () => {
    const runOnce = vi.fn(async () => job('job'));
    const scheduler = startPrintQueueScheduler({ userDataPath: '/tmp/unused', printer, runOnce, intervalMs: 10 });
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalled());
    scheduler.stop();
    const seen = runOnce.mock.calls.length;
    scheduler.wake();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(runOnce.mock.calls.length).toBe(seen);
  });
});
