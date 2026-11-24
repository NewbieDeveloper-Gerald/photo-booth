export { getLayoutPreset, layoutPresets, type LayoutPlacement, type LayoutPreset } from './catalog';
export { coverCrop, isInsideCanvas, type CropRect, type Rect } from './domain/cover-crop';
export {
  getPagePreset, isValidTemplateDocument, pagePresets,
  type LogoElement, type PagePreset, type PagePresetId, type PhotoElement, type QrElement,
  type RectElement, type TemplateDocument, type TemplateElement, type TextElement,
} from './domain/template-document';
export { buildPhotoGrid, createGridTemplate, templateFromCatalogPreset, QR_AVOID_RESERVE_PX, QR_AVOID_TEXT_RESERVE_PX } from './domain/template-builder';
