import type { WatermarkPosition } from './watermark';

export type ActiveEvent = {
  id: string; name: string; shots: number; retakeLimit: number; printEnabled: boolean; expiryDays: number;
  eventDate: string | null; logoPath: string | null; primaryColor: string; accentColor: string;
  welcomeText: string; thankYouText: string; defaultLayoutId: string;
  /** Layouts the guest may choose from (F13). One entry means no picker is shown. */
  offeredLayoutIds: string[];
  /** This event's consent wording (F15); blank means "use the booth-wide notice". */
  consentText: string;
  /** Shown on the expired-link page, e.g. how to reach the organiser. */
  contactText: string;
  /** Gallery link token once the operator created one (F16); never edited through the form. */
  galleryToken: string | null;
  /** True when the guest gallery asks for a password. The password itself is never returned. */
  galleryPasswordSet: boolean;
  /** F17: brand the guest download copies (never the originals or the print). */
  watermarkEnabled: boolean;
  watermarkPosition: WatermarkPosition;
  /** Logo width as a percentage of the photo width. */
  watermarkScalePercent: number;
  watermarkOpacity: number;
  /** F18: how many times one session may go to the queue, reprints included. */
  printLimitPerSession: number;
  /** F18: sheets loaded for this event; 0 means the operator did not count them. */
  paperCount: number;
  /** F19: the idle loop that invites guests in, and how long the booth waits to show it. */
  attractEnabled: boolean;
  attractIdleSeconds: number;
};
export type EventSettings = Omit<ActiveEvent, 'retakeLimit' | 'printEnabled'>;
