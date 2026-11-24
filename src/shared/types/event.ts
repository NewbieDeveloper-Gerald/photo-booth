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
};
export type EventSettings = Omit<ActiveEvent, 'retakeLimit' | 'printEnabled'>;
