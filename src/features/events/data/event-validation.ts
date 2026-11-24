import { MAX_EVENT_NAME_LENGTH, MAX_EVENT_TEXT_LENGTH } from '../../../shared/constants/limits';
import type { EventSettings } from '../../../shared/types/event';

/**
 * Default template per shot count. 2–4 photos keep the Phase 1 branded strips; 1 and
 * 5–6 use the 5 × 7 grid templates, which exist for every supported shot count (F11).
 */
const DEFAULT_TEMPLATE_BY_SHOTS: Record<number, string> = {
  1: '5x7-1x1', 2: 'double-strip-2', 3: 'double-strip-3', 4: 'double-strip-4', 5: '5x7-5x1', 6: '5x7-6x1',
};

const MAX_OFFERED_LAYOUTS = 12;
const MAX_LAYOUT_ID_LENGTH = 64;

/** Layout ids the guest may pick from; empty means "just the event's default". */
export function validateOfferedLayoutIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Invalid list of guest layouts');
  const ids = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (ids.length !== value.length) throw new Error('Invalid list of guest layouts');
  if (ids.length > MAX_OFFERED_LAYOUTS) throw new Error(`Offer at most ${MAX_OFFERED_LAYOUTS} layouts to guests`);
  if (ids.some((id) => id.length > MAX_LAYOUT_ID_LENGTH)) throw new Error('Invalid list of guest layouts');
  return [...new Set(ids)];
}

export function validateEventSettings(value: unknown): Omit<EventSettings, 'id' | 'logoPath'> {
  if (!value || typeof value !== 'object') throw new Error('Invalid event details');
  const item = value as Record<string, unknown>;
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > MAX_EVENT_NAME_LENGTH) throw new Error('Event name is required (80 characters maximum)');
  const shots = item.shots;
  if (typeof shots !== 'number' || !Object.hasOwn(DEFAULT_TEMPLATE_BY_SHOTS, shots)) throw new Error('Choose between 1 and 6 photos per session');
  const eventDate = item.eventDate === '' || item.eventDate === null ? null : item.eventDate;
  if (eventDate !== null && (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)) || new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate)) throw new Error('Enter a valid event date');
  for (const key of ['primaryColor', 'accentColor'] as const) if (typeof item[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(item[key])) throw new Error(`${key === 'primaryColor' ? 'Primary' : 'Accent'} color must be a six-digit hex color`);
  for (const key of ['welcomeText', 'thankYouText'] as const) if (typeof item[key] !== 'string' || item[key].trim().length > MAX_EVENT_TEXT_LENGTH) throw new Error(`${key === 'welcomeText' ? 'Welcome' : 'Thank-you'} text must be 160 characters or fewer`);
  const expiryDays = item.expiryDays;
  if (typeof expiryDays !== 'number' || !Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 365) throw new Error('QR link expiry must be from 1 to 365 days');
  const offered = validateOfferedLayoutIds(item.offeredLayoutIds);
  return { name: item.name.trim(), shots, expiryDays, eventDate: eventDate as string | null, primaryColor: item.primaryColor as string, accentColor: item.accentColor as string,
    welcomeText: (item.welcomeText as string).trim(), thankYouText: (item.thankYouText as string).trim(),
    defaultLayoutId: DEFAULT_TEMPLATE_BY_SHOTS[shots]!, offeredLayoutIds: offered };
}
