import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startUploadScheduler } from './scheduler';
import type { UploadTickResult } from './types';

const okTick: UploadTickResult = { processed: 0, uploaded: 0, failed: 0 };

function deferred(): { promise: Promise<UploadTickResult>; resolve: (result: UploadTickResult) => void } {
  let resolve!: (result: UploadTickResult) => void;
  const promise = new Promise<UploadTickResult>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('upload scheduler (F14)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('syncs once at startup so uploads queued before a restart resume', async () => {
    const runBatch = vi.fn(async () => okTick);
    const stop = startUploadScheduler({ userDataPath: '/booth', adapter: { upload: async () => {} }, runBatch });
    await vi.advanceTimersByTimeAsync(0);
    expect(runBatch).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps retrying on the interval', async () => {
    const runBatch = vi.fn(async () => okTick);
    const stop = startUploadScheduler({ userDataPath: '/booth', adapter: { upload: async () => {} }, intervalMs: 1_000, runBatch });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runBatch).toHaveBeenCalledTimes(4);
    stop();
  });

  it('never starts a second tick while one is still running', async () => {
    const pending = deferred();
    const runBatch = vi.fn(() => pending.promise);
    const stop = startUploadScheduler({ userDataPath: '/booth', adapter: { upload: async () => {} }, intervalMs: 1_000, runBatch });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runBatch).toHaveBeenCalledTimes(1);
    pending.resolve(okTick);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runBatch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reports a failed tick instead of throwing, and keeps the schedule alive', async () => {
    const onError = vi.fn();
    const runBatch = vi.fn(async () => { throw new Error('database is locked'); });
    const stop = startUploadScheduler({ userDataPath: '/booth', adapter: { upload: async () => {} }, intervalMs: 1_000, onError, runBatch });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onError).toHaveBeenCalledWith('database is locked');
    expect(runBatch.mock.calls.length).toBeGreaterThan(1);
    stop();
  });

  it('stops on request', async () => {
    const runBatch = vi.fn(async () => okTick);
    const stop = startUploadScheduler({ userDataPath: '/booth', adapter: { upload: async () => {} }, intervalMs: 1_000, runBatch });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runBatch).toHaveBeenCalledTimes(1);
  });
});
