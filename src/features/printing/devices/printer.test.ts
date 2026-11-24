import { describe, expect, it } from 'vitest';
import { MockPrinter, pageSizeMicrons } from './printer';

describe('printer interface', () => {
  it('records a print request with the selected printer and exact page size', async () => {
    const printer = new MockPrinter();
    const options = { printerName: 'Windows Photo Printer', widthMicrons: 101600, heightMicrons: 152400 };
    await expect(printer.printImage('/photos/session/finished.jpg', options)).resolves.toEqual({ success: true });
    expect(printer.jobs).toEqual([{ imagePath: '/photos/session/finished.jpg', options }]);
  });
  it('converts portrait and landscape 300 dpi layouts to exact 4x6-inch paper dimensions', () => {
    expect(pageSizeMicrons(1200, 1800)).toEqual({ widthMicrons: 101600, heightMicrons: 152400 });
    expect(pageSizeMicrons(1800, 1200)).toEqual({ widthMicrons: 152400, heightMicrons: 101600 });
  });
  it('returns failures without throwing away the completed print job', async () => {
    const printer = new MockPrinter({ success: false, error: 'Printer is offline' });
    await expect(printer.printImage('/photos/session/finished.jpg', { printerName: 'Offline', widthMicrons: 101600, heightMicrons: 152400 }))
      .resolves.toMatchObject({ success: false, error: 'Printer is offline' });
    expect(printer.jobs).toHaveLength(1);
  });
});

describe('page sizes for every template preset (F11)', () => {
  const inches = (microns: number): number => Math.round(microns / 25_400);
  it.each([
    ['4x6', 1200, 1800],
    ['2x6-strip', 600, 1800],
    ['5x7', 1500, 2100],
    ['square', 1800, 1800],
  ] as const)('%s prints at its own paper size', (_preset, widthPx, heightPx) => {
    const size = pageSizeMicrons(widthPx, heightPx);
    expect(size).toEqual({
      widthMicrons: Math.round(widthPx / 300 * 25_400),
      heightMicrons: Math.round(heightPx / 300 * 25_400),
    });
    expect([inches(size.widthMicrons), inches(size.heightMicrons)]).toEqual([widthPx / 300, heightPx / 300]);
  });

  it('keeps a 2x6 strip and a 5x7 page distinct from 4x6', () => {
    const fourBySix = pageSizeMicrons(1200, 1800);
    expect(pageSizeMicrons(600, 1800).widthMicrons).toBe(fourBySix.widthMicrons / 2);
    expect(pageSizeMicrons(1500, 2100).heightMicrons).toBeGreaterThan(fourBySix.heightMicrons);
  });
});
