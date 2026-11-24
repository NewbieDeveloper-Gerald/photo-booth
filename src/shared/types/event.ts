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
};
export type EventSettings = Omit<ActiveEvent, 'retakeLimit' | 'printEnabled'>;
