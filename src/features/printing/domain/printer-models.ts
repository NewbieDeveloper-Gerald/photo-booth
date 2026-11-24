/**
 * The printer models the booth knows about (F25). Paper sizes are real millimetres, because that
 * is what both the page box and the driver need; the booth never guesses a sheet size.
 *
 * A model entry is a *capability* list, not a promise: the operator still has to print the test
 * sheet on the actual printer once, and the profile records when that happened.
 */
export type CutMode = 'per-print' | 'per-job' | 'none';

export type PaperSize = {
  id: string;
  /** Shown in the operator panel, e.g. "4 × 6 in". */
  label: string;
  widthMm: number;
  heightMm: number;
};

export type PrinterModel = {
  id: string;
  label: string;
  maker: string;
  /** Usual first: the operator panel preselects it. */
  paperSizes: PaperSize[];
  /** Cut modes this model can do; 'none' is always allowed, so leaving the sheet whole works. */
  cutModes: CutMode[];
  /** Print head resolution, used for the test sheet's fine lines and the README table. */
  dpi: number;
  /** One line the operator sees while choosing, e.g. how the driver cuts. */
  notes: string;
};

const IN = 25.4;
const size = (id: string, label: string, widthIn: number, heightIn: number): PaperSize => ({
  id, label, widthMm: Math.round(widthIn * IN * 100) / 100, heightMm: Math.round(heightIn * IN * 100) / 100,
});

export const PAPER_SIZES = {
  strip2x6: size('2x6', '2 × 6 in strip', 2, 6),
  fourBySix: size('4x6', '4 × 6 in', 4, 6),
  fiveBySeven: size('5x7', '5 × 7 in', 5, 7),
  sixByEight: size('6x8', '6 × 8 in', 6, 8),
  card: size('card', 'Card, 54 × 86 mm', 54 / IN, 86 / IN),
} as const;

export const CUT_MODE_LABELS: Record<CutMode, string> = {
  'per-print': 'Cut after every print',
  'per-job': 'Cut once at the end of the job',
  none: 'No cut, trim by hand',
};

export const PRINTER_MODELS: PrinterModel[] = [
  {
    id: 'dnp-qw410', label: 'DNP QW410', maker: 'DNP', paperSizes: [PAPER_SIZES.fourBySix],
    cutModes: ['per-print', 'none'], dpi: 300,
    notes: 'Dye-sub, 4 × 6 only. The driver cuts after each sheet; leave the cut at "per print".',
  },
  {
    id: 'dnp-ds-rx1hs', label: 'DNP DS-RX1HS', maker: 'DNP',
    paperSizes: [PAPER_SIZES.fourBySix, PAPER_SIZES.sixByEight, PAPER_SIZES.strip2x6],
    cutModes: ['per-print', 'none'], dpi: 300,
    notes: 'Dye-sub. Set the same paper in the driver as on this profile, or the driver will refuse the job.',
  },
  {
    id: 'dnp-ds620', label: 'DNP DS620', maker: 'DNP',
    paperSizes: [PAPER_SIZES.fourBySix, PAPER_SIZES.sixByEight, PAPER_SIZES.strip2x6],
    cutModes: ['per-print', 'none'], dpi: 300,
    notes: 'Dye-sub. Frame at 4 × 6 for a full-bleed strip; 2 × 6 is for strip layouts.',
  },
  {
    id: 'mitsubishi-cp-m15e', label: 'Mitsubishi CP-M15E', maker: 'Mitsubishi',
    paperSizes: [PAPER_SIZES.fourBySix, PAPER_SIZES.sixByEight],
    cutModes: ['per-print', 'none'], dpi: 300,
    notes: 'Dye-sub. The driver performs the cut after each print.',
  },
  {
    id: 'mitsubishi-cp-d70dw', label: 'Mitsubishi CP-D70DW', maker: 'Mitsubishi',
    paperSizes: [PAPER_SIZES.fourBySix, PAPER_SIZES.sixByEight, PAPER_SIZES.strip2x6],
    cutModes: ['per-print', 'none'], dpi: 300,
    notes: 'Dye-sub, fast media. Pick the paper you loaded; the driver decides the cut.',
  },
  {
    id: 'canon-selphy-cp1500', label: 'Canon Selphy CP1500', maker: 'Canon',
    paperSizes: [PAPER_SIZES.fourBySix, PAPER_SIZES.card],
    cutModes: ['per-job', 'none'], dpi: 300,
    notes: 'Inkjet. It cuts the sheet when the job ends, so the booth sends one sheet per job.',
  },
  {
    id: 'generic-4x6', label: 'Other printer, 4 × 6', maker: 'Any',
    paperSizes: [PAPER_SIZES.fourBySix, PAPER_SIZES.sixByEight, PAPER_SIZES.fiveBySeven, PAPER_SIZES.strip2x6],
    cutModes: ['per-print', 'per-job', 'none'], dpi: 300,
    notes: 'For a printer that is not listed. Check the sheet size it produces with the test print.',
  },
];

export function findPrinterModel(modelId: unknown): PrinterModel | undefined {
  return typeof modelId === 'string' ? PRINTER_MODELS.find((model) => model.id === modelId) : undefined;
}

export function findPaperSize(model: PrinterModel, paperId: unknown): PaperSize | undefined {
  return typeof paperId === 'string' ? model.paperSizes.find((paper) => paper.id === paperId) : undefined;
}

/** Paper sizes are stored in millimetres; the page box and the driver both work in microns. */
export function paperSizeMicrons(paper: PaperSize): { widthMicrons: number; heightMicrons: number } {
  return { widthMicrons: Math.round(paper.widthMm * 1000), heightMicrons: Math.round(paper.heightMm * 1000) };
}
