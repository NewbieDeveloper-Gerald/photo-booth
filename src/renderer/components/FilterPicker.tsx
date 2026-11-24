import React from 'react';
import { PHOTO_FILTERS, cssPhotoFilter, type PhotoFilterId } from '../../features/capture';

type FilterPickerProps = {
  selected: PhotoFilterId;
  onSelect: (filterId: PhotoFilterId) => void;
  disabled?: boolean;
};

/**
 * The guest's look picker (F20). Each swatch is a two-colour ramp with the look's own CSS
 * filter applied, so the choice is visible before a single photo is taken; the live camera
 * preview is deliberately left unfiltered to keep a 4K stream cheap.
 */
export function FilterPicker({ selected, onSelect, disabled = false }: FilterPickerProps): React.JSX.Element {
  return (
    <div className="filter-picker" role="group" aria-label="Photo filter">
      <p className="filter-picker-title">Choose a look</p>
      <div className="filter-options">
        {PHOTO_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`filter-option${selected === filter.id ? ' selected' : ''}`}
            aria-pressed={selected === filter.id}
            aria-label={filter.label}
            onClick={() => onSelect(filter.id)}
            disabled={disabled}
          >
            <span className="filter-swatch" style={{ background: `linear-gradient(135deg, ${filter.swatch[0]}, ${filter.swatch[1]})`, filter: cssPhotoFilter(filter.id) }} aria-hidden="true" />
            <span className="filter-label">{filter.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
