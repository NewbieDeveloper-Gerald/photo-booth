import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// Vitest runs without `globals`, so React Testing Library cannot register its own
// auto-cleanup: unmount every rendered tree between jsdom component tests.
afterEach(cleanup);

// Let the worker's event loop turn between tests.
//
// Vitest 3 reports every task update to the main process over birpc, whose call timeout is a
// hardcoded 60 s with no config knob. better-sqlite3 is synchronous, so a database test blocks
// the worker's event loop for its whole duration; the main process answers in milliseconds, but
// the reply sits unread in the IPC queue until the loop turns, and Node runs expired timers
// before polling I/O. A file whose tests block for 60 s in total therefore ends with
// `[vitest-worker]: Timeout calling "onTaskUpdate"` — every test passing and the run still
// failing with exit 1. That is what a slow Windows disk produced.
//
// One macrotask here per test keeps the loop turning, so the deadline never spans more than a
// single test (bounded by `testTimeout` in vite.config.ts). No test may block the loop for 60 s
// on its own; that is the one case this cannot save, and it is a test bug anyway.
beforeEach(async () => {
  await new Promise<void>((resolve) => { setImmediate(resolve); });
});
