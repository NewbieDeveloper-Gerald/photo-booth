import React from 'react';
import type { TemplateSummary } from '../../features/layouts';
import { MAX_OFFERED_LAYOUTS } from '../../shared/constants/limits';

type GuestLayoutFieldProps = {
  templates: TemplateSummary[];
  defaultLayoutId: string;
  offeredLayoutIds: string[];
  onChange: (offeredLayoutIds: string[]) => void;
};

/**
 * Which layouts the guest picker shows. The event's default layout is always offered
 * and always first — the booth needs one layout even if the operator unticks the rest —
 * so that row is shown checked and locked instead of silently reappearing on save.
 */
export function GuestLayoutField({ templates, defaultLayoutId, offeredLayoutIds, onChange }: GuestLayoutFieldProps): React.JSX.Element {
  const isAtLimit = offeredLayoutIds.length >= MAX_OFFERED_LAYOUTS;
  const toggle = (templateId: string, isChecked: boolean): void => {
    const next = isChecked ? [...offeredLayoutIds, templateId] : offeredLayoutIds.filter((id) => id !== templateId);
    onChange([...new Set(next)]);
  };
  return (
    <fieldset className="guest-layout-field">
      <legend>Layouts guests may pick</legend>
      <p className="guest-layout-hint">The default layout leads the picker. Untick every other layout to skip the picker entirely. Up to {MAX_OFFERED_LAYOUTS} layouts.</p>
      <div className="guest-layout-options">
        {templates.map((template) => {
          const isDefault = template.id === defaultLayoutId;
          const isChecked = isDefault || offeredLayoutIds.includes(template.id);
          return (
            <label key={template.id} className={`guest-layout-option ${isDefault ? 'default' : ''}`}>
              <input
                type="checkbox"
                aria-label={`Offer ${template.name}`}
                checked={isChecked}
                disabled={isDefault || (!isChecked && isAtLimit)}
                onChange={(event) => toggle(template.id, event.target.checked)}
              />
              <span>{template.name}</span>
              <small>{template.pageLabel} · {template.shots} {template.shots === 1 ? 'photo' : 'photos'}{isDefault ? ' · default' : ''}</small>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
