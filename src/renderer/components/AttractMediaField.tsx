import React from 'react';
import type { AttractMedia } from '../../shared/types/attract';
import { MAX_ATTRACT_MEDIA_FILES } from '../../shared/constants/limits';

type AttractMediaFieldProps = {
  media: AttractMedia[];
  busy?: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (mediaId: string) => void;
};

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The media list for the attract loop (F19). Files are copied into the event's folder, so the
 * operator can take the memory card home; removing one here removes it from the booth.
 */
export function AttractMediaField({ media, busy = false, disabled = false, onAdd, onRemove }: AttractMediaFieldProps): React.JSX.Element {
  return (
    <div className="attract-field">
      <div className="attract-field-heading">
        <div>
          <p className="eyebrow">ATTRACT SCREEN</p>
          <p className="gallery-hint">
            {media.length === 0
              ? "Without photos or a video the idle loop shows this event's layouts."
              : `${media.length} of ${MAX_ATTRACT_MEDIA_FILES} files · each 25 MB or smaller`}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onAdd} disabled={busy || disabled || media.length >= MAX_ATTRACT_MEDIA_FILES}>
          Add photos or video
        </button>
      </div>
      {media.length > 0 && (
        <ul className="attract-media-list" aria-label="Attract screen files">
          {media.map((item) => (
            <li key={item.id} className={`attract-media-item ${item.kind}`}>
              <span className="attract-media-kind">{item.kind === 'video' ? 'VIDEO' : 'PHOTO'}</span>
              <span className="attract-media-label">{item.label}</span>
              <span className="attract-media-size">{megabytes(item.bytes)}</span>
              <button type="button" className="secondary-button" onClick={() => onRemove(item.id)} disabled={busy || disabled} aria-label={`Remove ${item.label}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
