import React from 'react';
import type { TemplateDocument, TemplateSummary } from '../../features/layouts';
import { LayoutPreview } from './LayoutPreview';

export type LayoutChoice = { summary: TemplateSummary; document: TemplateDocument | null };

type LayoutPickerProps = { choices: LayoutChoice[]; selectedId: string; onSelect: (layoutId: string) => void; disabled?: boolean };

/**
 * Guest-facing step before shooting. One layout means there is nothing to decide, so
 * the picker steps out of the flow entirely (F13) and the session starts on that layout.
 */
export function LayoutPicker({ choices, selectedId, onSelect, disabled = false }: LayoutPickerProps): React.JSX.Element | null {
  if (choices.length < 2) return null;
  return (
    <section className="layout-picker" aria-label="Choose a layout">
      <p className="eyebrow">STEP 1 · PICK YOUR PRINT</p>
      <h2>Choose your layout</h2>
      <div className="layout-picker-grid" role="radiogroup" aria-label="Available layouts">
        {choices.map(({ summary, document }) => {
          const isSelected = summary.id === selectedId;
          return (
            <button
              key={summary.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`layout-choice-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(summary.id)}
              disabled={disabled}
            >
              <span className="layout-choice-art">
                {document ? <LayoutPreview document={document} label={summary.name} /> : <span className="layout-choice-fallback">{summary.pageLabel}</span>}
              </span>
              <span className="layout-choice-name">{summary.name}</span>
              <span className="layout-choice-meta">{summary.pageLabel} · {summary.shots} {summary.shots === 1 ? 'photo' : 'photos'}{summary.copies > 1 ? ` · ${summary.copies} copies` : ''}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
