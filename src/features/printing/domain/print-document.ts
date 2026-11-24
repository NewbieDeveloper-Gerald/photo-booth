import { MICRONS_PER_INCH } from '../../../shared/constants/limits';
import { escapeHtml } from '../../../shared/validation/html';
import { CUT_MODE_LABELS, findPaperSize, findPrinterModel, type CutMode } from './printer-models';
import { COLOR_MODE_LABELS, imageFilter, type PrinterProfile } from './printer-profile';

export type PrintDocumentOptions = {
  widthMicrons: number;
  heightMicrons: number;
  /** From the profile; a plain print with no profile has none. */
  filter?: string;
  cutMode?: CutMode;
};

const inches = (microns: number): number => Math.round((microns / MICRONS_PER_INCH) * 1000) / 1000;

/**
 * The sheet sent to the driver: one image, the exact page box, no margins and no browser scaling.
 * `object-fit: contain` keeps a 4 × 6 layout undistorted on a 6 × 8 sheet instead of stretching it.
 * The cut is the driver's job; the profile's mode travels with the job so the operator can see
 * afterwards what the sheet was set up as.
 */
export function buildImagePrintDocument(dataUrl: string, options: PrintDocumentOptions): string {
  const width = inches(options.widthMicrons);
  const height = inches(options.heightMicrons);
  const filter = options.filter ? `filter:${options.filter};` : '';
  const cut = options.cutMode ? `\n      /* cut: ${options.cutMode}, ${CUT_MODE_LABELS[options.cutMode]} (performed by the printer driver) */` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${cut}
      @page{size:${width}in ${height}in;margin:0}
      *{box-sizing:border-box}html,body{width:${width}in;height:${height}in;margin:0;padding:0;overflow:hidden}
      img{display:block;width:100%;height:100%;object-fit:contain;${filter}}
      </style></head><body><img src="${escapeHtml(dataUrl)}" alt="Photobooth print"></body></html>`;
}

const SWATCHES: Array<{ name: string; css: string }> = [
  { name: 'Red', css: '#c1272d' }, { name: 'Green', css: '#1f7a3d' }, { name: 'Blue', css: '#1d3fbf' },
  { name: 'Cyan', css: '#00a4d6' }, { name: 'Magenta', css: '#c1147f' }, { name: 'Yellow', css: '#f2c200' },
];

/**
 * The test sheet (F25): what the operator prints on real hardware before trusting a model. It
 * carries the settings being tested, colour patches and a grey ramp (to see the profile's colour
 * behaviour), a 2 mm frame (to see the printer's own margins) and hairline pairs (to see if the
 * driver is scaling the sheet).
 */
export function buildTestPrintDocument(profile: PrinterProfile): string {
  const model = findPrinterModel(profile.modelId);
  const paper = model ? findPaperSize(model, profile.paperId) : undefined;
  const widthIn = paper ? inches(Math.round(paper.widthMm * 1000)) : 4;
  const heightIn = paper ? inches(Math.round(paper.heightMm * 1000)) : 6;
  const filter = imageFilter(profile);
  const adjustments = [profile.brightness, profile.contrast, profile.saturation]
    .map((value, index) => `${['brightness', 'contrast', 'saturation'][index]} ${value > 0 ? '+' : ''}${value}%`)
    .join(' · ');
  const greyRamp = Array.from({ length: 11 }, (_, step) => `<span style="background:hsl(0 0% ${step * 10}%)"></span>`).join('');
  const swatches = SWATCHES.map((swatch) => `<span style="background:${swatch.css}">${escapeHtml(swatch.name)}</span>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:${widthIn}in ${heightIn}in;margin:0}
      *{box-sizing:border-box}html,body{width:${widthIn}in;height:${heightIn}in;margin:0;padding:0;overflow:hidden}
      body{font-family:"Segoe UI",Arial,sans-serif;color:#111;background:#fff;padding:.16in}
      .frame{position:absolute;inset:.08in;border:.01in solid #111}
      h1{font-size:13pt;margin:0 0 .04in}
      p{font-size:8pt;margin:0 0 .03in;line-height:1.25}
      .scene{${filter ? `filter:${filter};` : ''}}
      .swatches{display:flex;gap:.02in;margin:.06in 0}
      .swatches span{flex:1;height:.35in;color:#fff;font-size:6pt;text-align:center;line-height:.35in}
      .ramp{display:flex;height:.3in;margin:.05in 0}
      .ramp span{flex:1}
      .lines{margin:.06in 0}
      .lines div{height:.01in;background:#111;margin-bottom:.01in}
      .lines div.thin{height:1px}
      </style></head><body>
      <div class="frame"></div>
      <div class="scene">
        <h1>${escapeHtml(profile.name)}</h1>
        <p><strong>${escapeHtml(model?.label ?? profile.modelId)}</strong> · ${escapeHtml(paper?.label ?? profile.paperId)} · ${escapeHtml(CUT_MODE_LABELS[profile.cutMode])}</p>
        <p>${escapeHtml(COLOR_MODE_LABELS[profile.colorMode])} · ${escapeHtml(adjustments)}</p>
        <div class="swatches">${swatches}</div>
        <div class="ramp">${greyRamp}</div>
        <div class="lines"><div></div><div class="thin"></div><div></div><div class="thin"></div></div>
        <p>The frame sits 2 mm from the edge: if it is missing a side, the driver is adding a margin.</p>
        <p>The hairline pairs must stay separate. If they merge, the driver is scaling the sheet.</p>
        <p>Print this sheet after every paper, cut or colour change, then tick it as checked.</p>
      </div>
      </body></html>`;
}
