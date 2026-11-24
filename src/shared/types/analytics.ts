/**
 * The numbers an operator can show a client (F24). They come from the booth's own records —
 * sessions, photos, retakes, print jobs and download hits — so they work with no network at all.
 */
export type EventStats = {
  eventId: string;
  eventName: string;
  sessions: number;
  photos: number;
  retakes: number;
  /** Sheets the printer reported as done. */
  prints: number;
  /** Guest file and ZIP hits, counted per session. */
  downloads: number;
  /** Mean time from starting a session to saving its layout; null with no finished session. */
  averageSessionSeconds: number | null;
};

export type BoothTotals = {
  events: number;
  sessions: number;
  photos: number;
  retakes: number;
  prints: number;
  downloads: number;
  averageSessionSeconds: number | null;
};

export type BoothStats = {
  generatedAt: string;
  events: EventStats[];
  totals: BoothTotals;
};
