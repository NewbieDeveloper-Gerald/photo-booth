export type ActiveEvent = {
  id: string; name: string; shots: number; retakeLimit: number; printEnabled: boolean; expiryDays: number;
  eventDate: string | null; logoPath: string | null; primaryColor: string; accentColor: string;
  welcomeText: string; thankYouText: string; defaultLayoutId: string;
  /** Layouts the guest may choose from (F13). One entry means no picker is shown. */
  offeredLayoutIds: string[];
};
export type EventSettings = Omit<ActiveEvent, 'retakeLimit' | 'printEnabled'>;
