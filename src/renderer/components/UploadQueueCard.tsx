import React from 'react';
import type { UploadQueueSummary } from '../../features/sharing';

type UploadQueueCardProps = { summary: UploadQueueSummary };

/** Honest status for the mock-only queue: nothing leaves the booth until a provider exists. */
export function UploadQueueCard({ summary }: UploadQueueCardProps): React.JSX.Element {
  return (
    <section className="recovery-card upload-queue-card" aria-label="Upload queue status">
      <div>
        <p className="eyebrow">UPLOAD QUEUE · MOCK-ONLY</p>
        <strong>{summary.pending + summary.uploading} waiting · {summary.uploaded} completed</strong>
        <span>No cloud uploader is configured, so files remain on this booth and nothing is sent online. Queue items will wait until a provider is added.</span>
        {summary.lastError && <span>Last error: {summary.lastError}</span>}
      </div>
      <span className="queue-failed">{summary.failed} failed</span>
    </section>
  );
}
