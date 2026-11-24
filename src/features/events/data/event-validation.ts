import {
  MAX_ATTRACT_IDLE_SECONDS, MAX_CONSENT_LENGTH, MAX_EVENT_CONTACT_LENGTH, MAX_EVENT_NAME_LENGTH, MAX_EVENT_PAPER_COUNT,
  MAX_EVENT_TEXT_LENGTH,
  MAX_OFFERED_LAYOUTS, MAX_PRINT_LIMIT_PER_SESSION, MIN_ATTRACT_IDLE_SECONDS, MIN_PRINT_LIMIT_PER_SESSION,
  MAX_WATERMARK_OPACITY, MAX_WATERMARK_SCALE_PERCENT, MIN_WATERMARK_OPACITY, MIN_WATERMARK_SCALE_PERCENT,
} from '../../../shared/constants/limits';
import type { WatermarkPosition } from '../../../shared/types/watermark';
import { isWatermarkPosition } from '../../capture/domain/watermark';
import { isPhotoFilterId } from '../../capture/domain/photo-filters';
import type { PhotoFilterId } from '../../../shared/types/photo-filter';
import { isAnimatedOutput, type AnimatedOutput } from '../../animation/domain/animation-plan';
import type { EventSettings } from '../../../shared/types/event';
import { MAX_GALLERY_PASSWORD_LENGTH, MIN_GALLERY_PASSWORD_LENGTH } from '../../../shared/constants/limits';
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

/** Fields the operator may write; the gallery token and the stored hash are booth-owned. */
export type ValidatedEventFields = Omit<EventSettings, 'id' | 'logoPath' | 'galleryToken' | 'galleryPasswordSet'>;

/**
 * Gallery password input: `undefined` leaves the current password alone, an empty string
 * removes it, and anything else must be long enough to be worth asking for (F16).
 */
export function validateGalleryPassword(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid gallery password');
  if (value === '') return null;
  if (value.length < MIN_GALLERY_PASSWORD_LENGTH || value.length > MAX_GALLERY_PASSWORD_LENGTH) {
    throw new Error(`Gallery password must be ${MIN_GALLERY_PASSWORD_LENGTH} to ${MAX_GALLERY_PASSWORD_LENGTH} characters`);
  }
  return value;
}

/**
 * Watermark input (F17): every part is optional so older payloads keep working, and the
 * defaults match the migration so a missing field cannot change what the booth does.
 */
function validateWatermark(item: Record<string, unknown>): { watermarkEnabled: boolean; watermarkPosition: WatermarkPosition; watermarkScalePercent: number; watermarkOpacity: number } {
  const enabled = item.watermarkEnabled;
  if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('Invalid watermark setting');
  const position = item.watermarkPosition ?? 'bottom-right';
  if (!isWatermarkPosition(position)) throw new Error('Choose where the watermark sits on guest copies');
  const scale = item.watermarkScalePercent ?? 18;
  if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < MIN_WATERMARK_SCALE_PERCENT || scale > MAX_WATERMARK_SCALE_PERCENT) {
    throw new Error(`Watermark size must be ${MIN_WATERMARK_SCALE_PERCENT}–${MAX_WATERMARK_SCALE_PERCENT}% of the photo width`);
  }
  const opacity = item.watermarkOpacity ?? 0.6;
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < MIN_WATERMARK_OPACITY || opacity > MAX_WATERMARK_OPACITY) {
    throw new Error(`Watermark opacity must be from ${MIN_WATERMARK_OPACITY} to ${MAX_WATERMARK_OPACITY}`);
  }
  return { watermarkEnabled: enabled === true, watermarkPosition: position, watermarkScalePercent: scale, watermarkOpacity: Math.round(opacity * 100) / 100 };
}

/**
 * Print limits (F18): a session may be printed once by default and no more than the operator
 * allows, and the paper count is optional because many events never count their sheets.
 */
function validatePrintRules(item: Record<string, unknown>): { printLimitPerSession: number; paperCount: number } {
  const limit = item.printLimitPerSession ?? 2;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < MIN_PRINT_LIMIT_PER_SESSION || limit > MAX_PRINT_LIMIT_PER_SESSION) {
    throw new Error(`Prints per session must be ${MIN_PRINT_LIMIT_PER_SESSION} to ${MAX_PRINT_LIMIT_PER_SESSION}`);
  }
  const paperCount = item.paperCount ?? 0;
  if (typeof paperCount !== 'number' || !Number.isInteger(paperCount) || paperCount < 0 || paperCount > MAX_EVENT_PAPER_COUNT) {
    throw new Error(`Paper count must be 0 to ${MAX_EVENT_PAPER_COUNT} sheets`);
  }
  return { printLimitPerSession: limit, paperCount };
}

/**
 * Attract screen (F19): on by default, because an idle booth that keeps its controls on screen
 * looks broken. The wait is clamped to something a guest can sit through.
 */
function validateAttract(item: Record<string, unknown>): { attractEnabled: boolean; attractIdleSeconds: number } {
  const enabled = item.attractEnabled ?? true;
  if (typeof enabled !== 'boolean') throw new Error('Invalid attract screen setting');
  const idle = item.attractIdleSeconds ?? 60;
  if (typeof idle !== 'number' || !Number.isInteger(idle) || idle < MIN_ATTRACT_IDLE_SECONDS || idle > MAX_ATTRACT_IDLE_SECONDS) {
    throw new Error(`Attract screen wait must be ${MIN_ATTRACT_IDLE_SECONDS} to ${MAX_ATTRACT_IDLE_SECONDS} seconds`);
  }
  return { attractEnabled: enabled, attractIdleSeconds: idle };
}

/**
 * Guest looks (F20): an event either fixes one look or lets the guest pick per session. The
 * stored id must be one the renderer knows, because it is baked into every copy and print.
 */
function validatePhotoFilter(item: Record<string, unknown>): { filterId: PhotoFilterId; filterChoiceEnabled: boolean } {
  const filterId = item.filterId ?? 'none';
  if (!isPhotoFilterId(filterId)) throw new Error('Choose one of the available photo filters');
  const choice = item.filterChoiceEnabled ?? false;
  if (typeof choice !== 'boolean') throw new Error('Invalid guest filter setting');
  return { filterId, filterChoiceEnabled: choice };
}

/**
 * The animated extra (F23) is a per-event promise about what lands on the guest page, so an
 * unknown value is refused rather than quietly replaced.
 */
function validateAnimatedOutput(item: Record<string, unknown>): { animatedOutput: AnimatedOutput } {
  const animatedOutput = item.animatedOutput ?? 'gif';
  if (!isAnimatedOutput(animatedOutput)) throw new Error('Choose none, a GIF loop, a boomerang or both');
  return { animatedOutput };
}

export function validateEventSettings(value: unknown): ValidatedEventFields {
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
  return { ...validateAnimatedOutput(item), name: item.name.trim(), shots, expiryDays, eventDate: eventDate as string | null, primaryColor: item.primaryColor as string, accentColor: item.accentColor as string,
    welcomeText: (item.welcomeText as string).trim(), thankYouText: (item.thankYouText as string).trim(),
    defaultLayoutId: defaultLayoutIdForShots(shots), offeredLayoutIds: offered, consentText, contactText, ...validateWatermark(item), ...validatePrintRules(item), ...validateAttract(item), ...validatePhotoFilter(item) };
}
