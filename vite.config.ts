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
  },
});
