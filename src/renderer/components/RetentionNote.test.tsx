// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RetentionNote } from './RetentionNote';

describe('RetentionNote (F15)', () => {
  it('says when the cleanup last ran', () => {
    render(<RetentionNote status={{ lastSweepAt: '2026-11-20T09:30:00.000Z', expiredSessions: 0 }} />);
    expect(screen.getByLabelText('Expiry cleanup status').textContent).toContain('nothing is past its expiry');
    expect(screen.getByLabelText('Expiry cleanup status').textContent).not.toContain('not run yet');
  });

  it('admits a cleanup that never ran', () => {
    render(<RetentionNote status={{ lastSweepAt: null, expiredSessions: 0 }} />);
    expect(screen.getByLabelText('Expiry cleanup status').textContent).toContain('last cleanup: not run yet');
  });

  it('counts sessions that are waiting for the next sweep', () => {
    render(<RetentionNote status={{ lastSweepAt: null, expiredSessions: 2 }} />);
    expect(screen.getByLabelText('Expiry cleanup status').textContent).toContain('2 sessions are past expiry');
  });

  it('uses the singular for one session', () => {
    render(<RetentionNote status={{ lastSweepAt: null, expiredSessions: 1 }} />);
    expect(screen.getByLabelText('Expiry cleanup status').textContent).toContain('1 session is past expiry');
  });
});
