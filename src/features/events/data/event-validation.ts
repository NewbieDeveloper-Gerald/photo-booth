import { MAX_CONSENT_LENGTH, MAX_EVENT_CONTACT_LENGTH, MAX_EVENT_NAME_LENGTH, MAX_EVENT_TEXT_LENGTH, MAX_OFFERED_LAYOUTS } from '../../../shared/constants/limits';
import type { EventSettings } from '../../../shared/types/event';
import { defaultLayoutIdForShots, isSupportedShotCount } from '../domain/default-layouts';

const MAX_LAYOUT_ID_LENGTH = 64;

/** Optional per-event text: blank means "fall back to the booth-wide setting". */
function optionalText(value: unknown, limit: number, message: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > limit) throw new Error(message);
  return value.trim();
}

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
  if (typeof shots !== 'number' || !isSupportedShotCount(shots)) throw new Error('Choose between 1 and 6 photos per session');
  const eventDate = item.eventDate === '' || item.eventDate === null ? null : item.eventDate;
  if (eventDate !== null && (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)) || new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate)) throw new Error('Enter a valid event date');
  for (const key of ['primaryColor', 'accentColor'] as const) if (typeof item[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(item[key])) throw new Error(`${key === 'primaryColor' ? 'Primary' : 'Accent'} color must be a six-digit hex color`);
  for (const key of ['welcomeText', 'thankYouText'] as const) if (typeof item[key] !== 'string' || item[key].trim().length > MAX_EVENT_TEXT_LENGTH) throw new Error(`${key === 'welcomeText' ? 'Welcome' : 'Thank-you'} text must be 160 characters or fewer`);
  const expiryDays = item.expiryDays;
  if (typeof expiryDays !== 'number' || !Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 365) throw new Error('QR link expiry must be from 1 to 365 days');
  const offered = validateOfferedLayoutIds(item.offeredLayoutIds);
  const consentText = optionalText(item.consentText, MAX_CONSENT_LENGTH, `Consent notice must be ${MAX_CONSENT_LENGTH} characters or fewer`);
  const contactText = optionalText(item.contactText, MAX_EVENT_CONTACT_LENGTH, `Contact details must be ${MAX_EVENT_CONTACT_LENGTH} characters or fewer`);
  return { name: item.name.trim(), shots, expiryDays, eventDate: eventDate as string | null, primaryColor: item.primaryColor as string, accentColor: item.accentColor as string,
    welcomeText: (item.welcomeText as string).trim(), thankYouText: (item.thankYouText as string).trim(),
    defaultLayoutId: defaultLayoutIdForShots(shots), offeredLayoutIds: offered, consentText, contactText };
}
