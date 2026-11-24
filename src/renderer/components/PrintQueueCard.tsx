import React from 'react';
import type { PrintJob, PrintQueueSummary } from '../../features/printing/domain/print-queue-types';

type PrintQueueCardProps = {
  summary: PrintQueueSummary;
  jobs: PrintJob[];
  busy?: boolean;
  onSetPaused: (paused: boolean) => void;
  onCancel: (jobId: string) => void;
};

/** Only the newest few jobs fit on the operator panel; the rest stay in the database. */
const VISIBLE_JOBS = 5;

function describeJob(job: PrintJob): string {
  switch (job.status) {
    case 'queued': return 'waiting';
    case 'printing': return 'printing now';
    case 'done': return 'printed';
    case 'failed': return job.error ? `failed · ${job.error}` : 'failed';
    case 'cancelled': return 'cancelled';
    default: return job.status;
  }
}

/**
 * The operator's view of the print queue (F18): how many sheets are waiting, whether the
 * queue is paused, and a warning before the event runs through the paper it was given.
 * A failed job stays here with its error so a sheet is never lost silently.
 */
export function PrintQueueCard({ summary, jobs, busy = false, onSetPaused, onCancel }: PrintQueueCardProps): React.JSX.Element {
  const shown = jobs.slice(0, VISIBLE_JOBS);
  return (
    <section className="recovery-card print-queue-card" aria-label="Print queue status">
      <div className="print-queue-heading">
        <div>
          <p className="eyebrow">PRINT QUEUE</p>
          <h2>{summary.paused ? 'Paused' : 'Printing'}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => onSetPaused(!summary.paused)} disabled={busy}>
          {summary.paused ? 'Resume queue' : 'Pause queue'}
        </button>
      </div>
      <p className="print-queue-counts">
        {summary.done} printed · {summary.queued} waiting · {summary.printing} printing · {summary.failed} failed
        {summary.paperCount > 0 ? ` · ${summary.done + summary.queued + summary.printing} of ${summary.paperCount} sheets papered` : ''}
        {summary.sessionLimit > 0 ? ` · up to ${summary.sessionLimit} prints per session` : ''}
      </p>
      {summary.paperWarning && <p className="print-queue-warning" role="status">{summary.paperWarning}</p>}
      {summary.paused && <p className="print-queue-note">Queued sheets wait until the queue is resumed; nothing is sent to the printer while paused.</p>}
      {shown.length > 0 && (
        <ul className="print-queue-list">
          {shown.map((job) => (
            <li key={job.id} className={`print-queue-job ${job.status}`}>
              <span className="print-queue-job-printer">{job.printerName}</span>
              <span className="print-queue-job-status">{describeJob(job)}</span>
              {job.attempts > 1 && <span className="print-queue-job-attempts">attempt {job.attempts}</span>}
              {(job.status === 'queued' || job.status === 'failed') && (
                <button type="button" className="secondary-button print-queue-cancel" onClick={() => onCancel(job.id)} disabled={busy}>
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
