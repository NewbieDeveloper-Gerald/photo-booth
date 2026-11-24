// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrintQueueCard } from './PrintQueueCard';
import type { PrintJob, PrintQueueSummary } from '../../features/printing/domain/print-queue-types';

const summary = (overrides: Partial<PrintQueueSummary> = {}): PrintQueueSummary => ({
  queued: 1, printing: 0, done: 2, failed: 0, paused: false, paperCount: 0, sessionLimit: 2, paperWarning: null, ...overrides,
});

const job = (overrides: Partial<PrintJob> = {}): PrintJob => ({
  id: 'job-1', sessionId: 'session-1', eventId: 'event-1', printerName: 'DNP QW410', status: 'queued',
  attempts: 0, error: null, createdAt: '2026-11-24 10:00:00', ...overrides,
});

describe('PrintQueueCard (F18)', () => {
  it('shows what is waiting, printing and printed', () => {
    render(<PrintQueueCard summary={summary({ queued: 2, printing: 1, done: 4 })} jobs={[]} onSetPaused={() => {}} onCancel={() => {}} />);
    const text = screen.getByLabelText('Print queue status').textContent ?? '';
    expect(text).toContain('4 printed');
    expect(text).toContain('2 waiting');
    expect(text).toContain('1 printing');
    expect(text).toContain('up to 2 prints per session');
    expect(text).not.toContain('papered');
  });

  it('counts the sheets planned against the paper the operator loaded', () => {
    render(<PrintQueueCard summary={summary({ queued: 1, printing: 1, done: 4, paperCount: 20 })} jobs={[]} onSetPaused={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText('Print queue status').textContent).toContain('6 of 20 sheets papered');
  });

  it('warns before the paper runs out and names the failed sheet', () => {
    const warning = 'Paper warning: all 3 sheets of paper are planned — reload paper and raise the paper count to keep printing.';
    render(<PrintQueueCard summary={summary({ paperWarning: warning })} jobs={[job({ status: 'failed', error: 'Out of paper', attempts: 2 })]} onSetPaused={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe(warning);
    expect(screen.getByLabelText('Print queue status').textContent).toContain('failed · Out of paper');
    expect(screen.getByLabelText('Print queue status').textContent).toContain('attempt 2');
  });

  it('pauses and resumes through one control', () => {
    const onSetPaused = vi.fn();
    const { rerender } = render(<PrintQueueCard summary={summary()} jobs={[]} onSetPaused={onSetPaused} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause queue' }));
    expect(onSetPaused).toHaveBeenCalledWith(true);
    rerender(<PrintQueueCard summary={summary({ paused: true })} jobs={[]} onSetPaused={onSetPaused} onCancel={() => {}} />);
    expect(screen.getByLabelText('Print queue status').textContent).toContain('wait until the queue is resumed');
    fireEvent.click(screen.getByRole('button', { name: 'Resume queue' }));
    expect(onSetPaused).toHaveBeenLastCalledWith(false);
  });

  it('only offers cancel for a job that has not printed yet', () => {
    const onCancel = vi.fn();
    render(<PrintQueueCard summary={summary()} jobs={[job({ id: 'queued' }), job({ id: 'done', status: 'done' })]} onSetPaused={() => {}} onCancel={onCancel} />);
    const cancel = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveLength(1);
    fireEvent.click(cancel[0]!);
    expect(onCancel).toHaveBeenCalledWith('queued');
  });
});
