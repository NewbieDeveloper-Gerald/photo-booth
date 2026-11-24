import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals`, so React Testing Library cannot register its own
// auto-cleanup: unmount every rendered tree between jsdom component tests.
afterEach(cleanup);
