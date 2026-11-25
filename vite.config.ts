import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Electron loads the production build from disk (file://), so asset URLs must be relative.
  base: './',
  server: { allowedHosts: true },
  test: {
    // Logic tests run in node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock so the default stays fast.
    environment: 'node',
    setupFiles: ['src/renderer/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    // Half this suite is integration, not logic: every database or filesystem case makes a
    // temporary storage directory, writes the paths file, applies the migrations and then opens
    // better-sqlite3 connections that fsync on each commit. On a warm SSD that is milliseconds;
    // on Windows with a real-time antivirus scanning `%TEMP%`, or with the temp directory on a
    // spinning disk, one such test can take several seconds and Vitest's 5 s default then
    // reports "Test timed out in 5000ms" for a test that is merely slow. 30 s leaves room for
    // that without hiding a real hang, and `npm run test:doctor` measures the machine so the
    // cause is measured rather than guessed (docs/testing.md).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
