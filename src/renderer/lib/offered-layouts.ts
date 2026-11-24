import type { TemplateSummary } from '../../features/layouts';
import type { ActiveEvent } from '../../shared/types/event';

/**
 * The layouts the booth may offer for one event, in the order the operator chose them.
 * Ids that no longer exist are ignored (a deleted layout must never break the booth),
 * and an event with no usable list still gets its default layout so guests are never
 * stuck on an empty picker.
 */
export function boothLayoutChoices(event: Pick<ActiveEvent, 'offeredLayoutIds' | 'defaultLayoutId'>, templates: TemplateSummary[]): TemplateSummary[] {
  const byId = new Map(templates.map((template) => [template.id, template]));
  const offered = event.offeredLayoutIds.flatMap((id) => { const template = byId.get(id); return template ? [template] : []; });
  if (offered.length > 0) return offered;
  const fallback = byId.get(event.defaultLayoutId) ?? templates[0];
  return fallback ? [fallback] : [];
}
