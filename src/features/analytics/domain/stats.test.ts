import { describe, expect, it } from 'vitest';
import { boothTotals, csvCell, csvFileName, formatDuration, statsCsv, STATS_CSV_HEADER } from './stats';
import type { BoothStats, EventStats } from '../../../shared/types/analytics';

const row = (overrides: Partial<EventStats> = {}): EventStats => ({
  eventId: 'event-1', eventName: 'Gala', sessions: 4, photos: 12, retakes: 2, prints: 4, downloads: 9,
  averageSessionSeconds: 90, ...overrides,
});

const stats = (events: EventStats[]): BoothStats => ({ generatedAt: '2026-11-24T10:00:00.000Z', events, totals: boothTotals(events) });

describe('booth numbers (F24)', () => {
  it('adds the counts up and weights the average by sessions', () => {
    const totals = boothTotals([
      row({ sessions: 2, photos: 6, retakes: 1, prints: 2, downloads: 3, averageSessionSeconds: 60 }),
      row({ eventId: 'event-2', eventName: 'Wedding', sessions: 8, photos: 24, retakes: 0, prints: 8, downloads: 20, averageSessionSeconds: 120 }),
    ]);
    expect(totals).toMatchObject({ events: 2, sessions: 10, photos: 30, retakes: 1, prints: 10, downloads: 23 });
    // (2 × 60 + 8 × 120) / 10 = 108, not the mean of 60 and 120.
    expect(totals.averageSessionSeconds).toBe(108);
  });

  it('says "—" when nothing has finished yet', () => {
    const totals = boothTotals([row({ sessions: 0, averageSessionSeconds: null })]);
    expect(totals.averageSessionSeconds).toBeNull();
    expect(boothTotals([])).toMatchObject({ events: 0, sessions: 0, averageSessionSeconds: null });
    expect(formatDuration(null)).toBe('—');
  });

  it('formats a session length the way an operator reads it', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(60)).toBe('1m 00s');
    expect(formatDuration(95)).toBe('1m 35s');
    expect(formatDuration(3600)).toBe('60m 00s');
  });
});

describe('the numbers CSV (F24)', () => {
  it('starts with the same columns the dashboard shows', () => {
    const csv = statsCsv(stats([row()]));
    expect(csv.split('\r\n')[0]).toBe(STATS_CSV_HEADER.join(','));
    expect(STATS_CSV_HEADER).toEqual(['Event', 'Sessions', 'Photos taken', 'Retakes', 'Prints used', 'Downloads', 'Average session seconds', 'Average session']);
  });

  it('writes one row per event plus totals, with the average in seconds and in words', () => {
    const csv = statsCsv(stats([row({ eventName: 'Gala', sessions: 4, averageSessionSeconds: 95 })]));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toBe('Gala,4,12,2,4,9,95,1m 35s');
    expect(lines[2]).toBe('All events,4,12,2,4,9,95,1m 35s');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes names that would otherwise break a spreadsheet', () => {
    expect(csvCell('Ana & Ben')).toBe('Ana & Ben');
    expect(csvCell('Gala, night one')).toBe('"Gala, night one"');
    expect(csvCell('The "big" one')).toBe('"The ""big"" one"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(statsCsv(stats([row({ eventName: 'Gala, "night" one' })]))).toContain('"Gala, ""night"" one",4');
  });

  it('names the file by day so two exports do not overwrite each other by accident', () => {
    expect(csvFileName(new Date('2026-11-24T23:30:00.000Z'))).toBe('photobooth-numbers-2026-11-24.csv');
  });
});
