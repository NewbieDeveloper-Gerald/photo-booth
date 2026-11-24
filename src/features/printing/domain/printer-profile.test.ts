import { describe, expect, it } from 'vitest';
import {
  describeProfile, imageFilter, printSheet, resolvePrinterProfile, resolveProfileDetails, validatePrinterProfileDraft,
  verificationLabel, type PrinterProfile,
} from './printer-profile';
import { PRINTER_MODELS, findPrinterModel } from './printer-models';

const base = {
  name: 'Front counter', modelId: 'dnp-qw410', printerName: 'DNP QW410', paperId: '4x6',
  cutMode: 'per-print', colorMode: 'color', brightness: 0, contrast: 0, saturation: 0, isDefault: true,
} as const;

const profile = (overrides: Partial<PrinterProfile> = {}): PrinterProfile => ({
  id: '11111111-1111-4111-8111-111111111111', ...base,
  verifiedAt: null, createdAt: '2026-11-24 09:00:00', updatedAt: '2026-11-24 09:00:00', ...overrides,
});

describe('printer profile draft (F25)', () => {
  it('normalises a profile for a listed model', () => {
    const draft = validatePrinterProfileDraft({ ...base, name: '  Front counter  ', printerName: ' DNP QW410 ' });
    expect(draft).toMatchObject({ name: 'Front counter', printerName: 'DNP QW410', paperId: '4x6', cutMode: 'per-print' });
    expect(draft.id).toBeUndefined();
    expect(PRINTER_MODELS.length).toBeGreaterThan(3);
  });

  it('refuses a paper size the model does not take', () => {
    expect(() => validatePrinterProfileDraft({ ...base, paperId: '6x8' })).toThrow('DNP QW410 does not take that paper size');
  });

  it('refuses a cut mode the model cannot do', () => {
    expect(() => validatePrinterProfileDraft({ ...base, modelId: 'canon-selphy-cp1500', paperId: '4x6', cutMode: 'per-print' }))
      .toThrow(/cannot cut that way/);
  });

  it('keeps colour adjustments inside twenty percent, in whole numbers', () => {
    expect(validatePrinterProfileDraft({ ...base, brightness: -20, contrast: 20 }).contrast).toBe(20);
    expect(() => validatePrinterProfileDraft({ ...base, brightness: 21 })).toThrow('between -20% and 20%');
    expect(() => validatePrinterProfileDraft({ ...base, contrast: 1.5 })).toThrow('whole percent');
    expect(() => validatePrinterProfileDraft({ ...base, saturation: Number.NaN })).toThrow('must be a number');
  });

  it('needs a name, a known model and a colour choice', () => {
    expect(() => validatePrinterProfileDraft({ ...base, name: '   ' })).toThrow('Give the profile a name');
    expect(() => validatePrinterProfileDraft({ ...base, modelId: 'epson-unknown' })).toThrow('Choose the printer model');
    expect(() => validatePrinterProfileDraft({ ...base, colorMode: 'sepia' })).toThrow('Choose colour or black and white');
    expect(() => validatePrinterProfileDraft({ ...base, name: 'x'.repeat(61) })).toThrow('limited to 60 characters');
    expect(() => validatePrinterProfileDraft(null)).toThrow('Invalid printer profile');
  });
});

describe('printer profile output (F25)', () => {
  it('asks the driver for the paper the profile names', () => {
    const details = resolveProfileDetails(profile({ modelId: 'dnp-ds-rx1hs', paperId: '6x8' }))!;
    expect(printSheet(details)).toEqual({ widthMicrons: 152400, heightMicrons: 203200 });
  });

  it('turns the colour settings into a filter, and mono into grey', () => {
    expect(imageFilter(profile())).toBe('');
    expect(imageFilter(profile({ colorMode: 'mono' }))).toBe('grayscale(1)');
    expect(imageFilter(profile({ brightness: 10, contrast: -5, saturation: 20 })))
      .toBe('brightness(1.10) contrast(0.95) saturate(1.20)');
    // Grey already has no saturation to shift, so mono drops that term instead of padding the string.
    expect(imageFilter(profile({ colorMode: 'mono', saturation: 20 }))).toBe('grayscale(1)');
  });

  it('describes a profile in one line for the queue and the log', () => {
    expect(describeProfile(profile())).toBe('DNP QW410 · 4 × 6 in · Cut after every print · Colour');
    expect(describeProfile(profile({ colorMode: 'mono' }))).toContain('Black and white');
    expect(describeProfile(profile({ modelId: 'gone', paperId: 'gone' }))).toBe('gone · gone · Cut after every print · Colour');
  });

  it('picks the profile bound to the printer, then the booth default, then nothing', () => {
    const bound = profile({ id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Selphy', modelId: 'canon-selphy-cp1500', printerName: 'SELPHY CP1500', paperId: '4x6', cutMode: 'per-job', isDefault: false });
    const fallback = profile();
    expect(resolvePrinterProfile([bound, fallback], 'selphy cp1500')?.name).toBe('Selphy');
    expect(resolvePrinterProfile([bound, fallback], 'Other printer')?.name).toBe('Front counter');
    expect(resolvePrinterProfile([bound], 'Other printer')).toBeNull();
    expect(resolvePrinterProfile([], 'DNP QW410')).toBeNull();
  });

  it('says whether the sheet was ever checked on the real printer', () => {
    expect(verificationLabel(profile())).toContain('Not checked on this printer yet');
    expect(verificationLabel(profile({ verifiedAt: '2026-11-24 10:20:00' }))).toBe('Test print checked on 2026-11-24');
  });

  it('offers a cut mode list that matches the model', () => {
    expect(findPrinterModel('canon-selphy-cp1500')?.cutModes).toEqual(['per-job', 'none']);
    expect(findPrinterModel('dnp-qw410')?.paperSizes.map((paper) => paper.id)).toEqual(['4x6']);
    expect(findPrinterModel('nope')).toBeUndefined();
  });
});
