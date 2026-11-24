import type { BoothStats, BoothTotals, EventStats } from '../../../shared/types/analytics';

/** Counts that add up, and an average that is weighted by sessions rather than averaged twice. */
export function boothTotals(rows: EventStats[]): BoothTotals {
  const sum = (pick: (row: EventStats) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  const sessionSeconds = rows.reduce((total, row) => total + (row.averageSessionSeconds ?? 0) * row.sessions, 0);
  const sessions = sum((row) => row.sessions);
  return {
    events: rows.length,
    sessions,
    photos: sum((row) => row.photos),
    retakes: sum((row) => row.retakes),
    prints: sum((row) => row.prints),
    downloads: sum((row) => row.downloads),
    // A weighted mean: one long event must not be averaged away by three short ones.
    averageSessionSeconds: sessions > 0 ? Math.round(sessionSeconds / sessions) : null,
  };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

/** RFC 4180 quoting: a cell with a comma, a quote or a newline is wrapped and its quotes doubled. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const STATS_CSV_HEADER = [
  'Event', 'Sessions', 'Photos taken', 'Retakes', 'Prints used', 'Downloads', 'Average session seconds', 'Average session',
];

/**
 * The CSV a bookkeeper or a client can open (F24). One row per event plus a totals row, and the
 * average is given both as raw seconds (for spreadsheets) and readably (for people).
 */
export function statsCsv(stats: BoothStats): string {
  const lines = [STATS_CSV_HEADER.map(csvCell).join(',')];
  for (const row of stats.events) {
    lines.push([
      csvCell(row.eventName), csvCell(row.sessions), csvCell(row.photos), csvCell(row.retakes), csvCell(row.prints),
      csvCell(row.downloads), csvCell(row.averageSessionSeconds), csvCell(formatDuration(row.averageSessionSeconds)),
    ].join(','));
  }
  const totals = stats.totals;
  lines.push([
    csvCell('All events'), csvCell(totals.sessions), csvCell(totals.photos), csvCell(totals.retakes), csvCell(totals.prints),
    csvCell(totals.downloads), csvCell(totals.averageSessionSeconds), csvCell(formatDuration(totals.averageSessionSeconds)),
  ].join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** A file name that sorts by day and survives every spreadsheet. */
export function csvFileName(now: Date): string {
  return `photobooth-numbers-${now.toISOString().slice(0, 10)}.csv`;
}
