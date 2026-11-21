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
