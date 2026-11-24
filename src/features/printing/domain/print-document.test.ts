import { describe, expect, it } from 'vitest';
import { buildImagePrintDocument, buildTestPrintDocument } from './print-document';
import type { PrinterProfile } from './printer-profile';

const profile: PrinterProfile = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Front <counter> & co', modelId: 'dnp-ds-rx1hs',
  printerName: 'DNP DS-RX1HS', paperId: '6x8', cutMode: 'per-print', colorMode: 'mono',
  brightness: 10, contrast: 0, saturation: 0, isDefault: true, verifiedAt: null,
  createdAt: '2026-11-24 09:00:00', updatedAt: '2026-11-24 09:00:00',
};

describe('print document (F25)', () => {
  it('builds a sheet the exact size of the page box, in inches, with no margins', () => {
    const html = buildImagePrintDocument('data:image/jpeg;base64,AAAA', { widthMicrons: 152400, heightMicrons: 203200 });
    expect(html).toContain('@page{size:6in 8in;margin:0}');
    expect(html).toContain('width:6in;height:8in');
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html).not.toContain('filter:');
  });

  it('carries the profile colour filter and the cut mode it expects', () => {
    const html = buildImagePrintDocument('data:image/jpeg;base64,AAAA', {
      widthMicrons: 101600, heightMicrons: 152400, filter: 'grayscale(1) brightness(1.10)', cutMode: 'per-print',
    });
    expect(html).toContain('filter:grayscale(1) brightness(1.10);');
    expect(html).toContain('/* cut: per-print, Cut after every print (performed by the printer driver) */');
    expect(html).toContain('@page{size:4in 6in;margin:0}');
  });

  it('writes a test sheet with the settings, patches, grey ramp and hairlines', () => {
    const html = buildTestPrintDocument(profile);
    expect(html).toContain('@page{size:6in 8in;margin:0}');
    expect(html).toContain('Front &lt;counter&gt; &amp; co');
    expect(html).toContain('DNP DS-RX1HS');
    expect(html).toContain('6 × 8 in');
    expect(html).toContain('Cut after every print');
    expect(html).toContain('Black and white · brightness +10% · contrast 0% · saturation 0%');
    expect(html).toContain('filter:grayscale(1) brightness(1.10);');
    expect(html).toContain('Red');
    expect(html.match(/hsl\(0 0% /g)?.length).toBe(11);
    expect(html).toContain('hairline pairs must stay separate');
    expect(html).toContain('2 mm from the edge');
  });

  it('falls back to 4 × 6 when a profile names a model that no longer exists', () => {
    const html = buildTestPrintDocument({ ...profile, modelId: 'retired-model' });
    expect(html).toContain('@page{size:4in 6in;margin:0}');
    expect(html).toContain('retired-model');
  });
});
