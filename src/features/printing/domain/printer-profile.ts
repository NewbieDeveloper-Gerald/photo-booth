import {
  CUT_MODE_LABELS, findPaperSize, findPrinterModel, paperSizeMicrons,
  type CutMode, type PaperSize, type PrinterModel,
} from './printer-models';

/** How the profile hands colour to the sheet. "mono" is the booth converting, not the driver. */
export type ColorMode = 'color' | 'mono';

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  color: 'Colour',
  mono: 'Black and white',
};

/**
 * A saved printer profile (F25): one printer model, one paper size, one cut mode and the colour
 * settings the booth applies to the image before it goes to the driver. Profiles are saved, so a
 * booth that is set up once prints the same way the next morning.
 */
export type PrinterProfile = {
  id: string;
  /** Operator's label, e.g. "Front counter DNP". */
  name: string;
  modelId: string;
  /** The Windows print queue this profile prints to; empty means "any printer, as the default". */
  printerName: string;
  paperId: string;
  cutMode: CutMode;
  colorMode: ColorMode;
  /** Percent, -20..20. The booth turns these into a CSS filter on the printed image. */
  brightness: number;
  contrast: number;
  saturation: number;
  isDefault: boolean;
  /** Set when the operator confirmed a real test print; cleared when the settings change. */
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What the operator panel sends; the repository fills in id and timestamps. */
export type PrinterProfileDraft = Omit<PrinterProfile, 'id' | 'verifiedAt' | 'createdAt' | 'updatedAt'> & { id?: string };

export const MAX_PROFILE_NAME_LENGTH = 60;
export const MAX_PRINTER_NAME_LENGTH = 200;
export const MAX_COLOR_ADJUSTMENT_PERCENT = 20;

export type ResolvedProfile = {
  profile: PrinterProfile;
  model: PrinterModel;
  paper: PaperSize;
};

function readAdjustment(label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  const rounded = Math.round(value);
  if (rounded !== value) throw new Error(`${label} must be a whole percent`);
  if (Math.abs(rounded) > MAX_COLOR_ADJUSTMENT_PERCENT) {
    throw new Error(`${label} must be between -${MAX_COLOR_ADJUSTMENT_PERCENT}% and ${MAX_COLOR_ADJUSTMENT_PERCENT}%`);
  }
  return rounded;
}

/**
 * Validates a draft against the model it names: a profile cannot ask a Selphy to cut after every
 * print or feed a sheet size its model does not take, because that would fail at the printer with
 * a much less useful message.
 */
export function validatePrinterProfileDraft(value: unknown): PrinterProfileDraft {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid printer profile');
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new Error('Give the profile a name');
  if (name.length > MAX_PROFILE_NAME_LENGTH) throw new Error(`Profile names are limited to ${MAX_PROFILE_NAME_LENGTH} characters`);

  const model = findPrinterModel(input.modelId);
  if (!model) throw new Error('Choose the printer model this profile is for');

  const printerName = typeof input.printerName === 'string' ? input.printerName.trim() : '';
  if (printerName.length > MAX_PRINTER_NAME_LENGTH) throw new Error('That printer name is too long');

  const paper = findPaperSize(model, input.paperId);
  if (!paper) throw new Error(`${model.label} does not take that paper size`);

  const cutMode = input.cutMode;
  if (typeof cutMode !== 'string' || !(cutMode in CUT_MODE_LABELS) || !model.cutModes.includes(cutMode as CutMode)) {
    throw new Error(`${model.label} cannot cut that way — choose ${model.cutModes.map((mode) => CUT_MODE_LABELS[mode].toLowerCase()).join(' or ')}`);
  }

  const colorMode = input.colorMode;
  if (colorMode !== 'color' && colorMode !== 'mono') throw new Error('Choose colour or black and white');

  if (typeof input.isDefault !== 'boolean') throw new Error('Invalid default choice');

  return {
    ...(typeof input.id === 'string' && input.id ? { id: input.id } : {}),
    name, modelId: model.id, printerName, paperId: paper.id, cutMode: cutMode as CutMode, colorMode,
    brightness: readAdjustment('Brightness', input.brightness),
    contrast: readAdjustment('Contrast', input.contrast),
    saturation: readAdjustment('Saturation', input.saturation),
    isDefault: input.isDefault,
  };
}

/** The sheet the driver is asked for, in the units Windows wants. */
export function printSheet(resolved: ResolvedProfile): { widthMicrons: number; heightMicrons: number } {
  return paperSizeMicrons(resolved.paper);
}

/**
 * Colour settings become a filter on the printed image, so the effect is real on any driver:
 * mono prints grey, and the three adjustments shift the image before it reaches the paper.
 */
export function imageFilter(profile: Pick<PrinterProfile, 'colorMode' | 'brightness' | 'contrast' | 'saturation'>): string {
  const parts: string[] = [];
  if (profile.colorMode === 'mono') parts.push('grayscale(1)');
  if (profile.brightness !== 0) parts.push(`brightness(${(1 + profile.brightness / 100).toFixed(2)})`);
  if (profile.contrast !== 0) parts.push(`contrast(${(1 + profile.contrast / 100).toFixed(2)})`);
  if (profile.saturation !== 0 && profile.colorMode !== 'mono') parts.push(`saturate(${(1 + profile.saturation / 100).toFixed(2)})`);
  return parts.join(' ');
}

/** One line for the operator panel, the print queue and the log. */
export function describeProfile(profile: PrinterProfile): string {
  const model = findPrinterModel(profile.modelId);
  const paper = model ? findPaperSize(model, profile.paperId) : undefined;
  return [
    model?.label ?? profile.modelId,
    paper?.label ?? profile.paperId,
    CUT_MODE_LABELS[profile.cutMode],
    COLOR_MODE_LABELS[profile.colorMode],
  ].join(' · ');
}

export function resolveProfileDetails(profile: PrinterProfile): ResolvedProfile | null {
  const model = findPrinterModel(profile.modelId);
  const paper = model ? findPaperSize(model, profile.paperId) : undefined;
  return model && paper ? { profile, model, paper } : null;
}

/**
 * The profile a print should use: the one bound to that Windows queue, else the booth default,
 * else nothing — in which case the queue falls back to the size the layout was rendered at.
 */
export function resolvePrinterProfile(profiles: PrinterProfile[], printerName: string): PrinterProfile | null {
  const wanted = printerName.trim().toLowerCase();
  const bound = wanted ? profiles.find((profile) => profile.printerName.trim().toLowerCase() === wanted) : undefined;
  if (bound) return bound;
  return profiles.find((profile) => profile.isDefault) ?? null;
}

/** A profile counts as checked only while it still describes what was printed. */
export function isProfileVerified(profile: PrinterProfile): boolean {
  return profile.verifiedAt !== null;
}

export function verificationLabel(profile: PrinterProfile): string {
  return profile.verifiedAt
    ? `Test print checked on ${profile.verifiedAt.slice(0, 10)}`
    : 'Not checked on this printer yet — print the test sheet';
}
