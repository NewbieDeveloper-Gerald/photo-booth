export { getLayoutPreset, layoutPresets, type LayoutPlacement, type LayoutPreset } from './catalog';
export { coverCrop, isInsideCanvas, type CropRect, type Rect } from './domain/cover-crop';
export {
  getPagePreset, isValidTemplateDocument, pagePresets,
  type LogoElement, type PagePreset, type PagePresetId, type PhotoElement, type QrElement,
  type ImageElement, type RectElement, type TemplateDocument, type TemplateElement, type TemplateSummary, type TextElement,
} from './domain/template-document';
export { buildPhotoGrid, createGridTemplate, templateFromCatalogPreset, QR_AVOID_RESERVE_PX, QR_AVOID_TEXT_RESERVE_PX } from './domain/template-builder';
export { computeTextPlacement, paintOrder, resolveText } from './domain/template-paint-plan';
export {
  SNAP_GRID_PX, MIN_ELEMENT_SIZE_PX, addImageElement, addLogoElement, addPhotoElement, addQrElement, addRectElement,
  addTextElement, elementAtPoint, emptyTemplateForPage, moveElement, moveElementLayer, removeElement,
  removePhotoElement, renameTemplate, resizeElement, setBackgroundColor, snapAlongAxis, snapToGrid, updateElement,
  type ElementPatch,
} from './domain/template-editing';
export { applyEdit, canRedo, canUndo, createHistory, redo, undo, undoDepth, type TemplateHistory } from './domain/template-history';
export { renderTemplateLayout, type TemplateBranding, type TemplateBridge } from './domain/render-template-layout';
export { paintTemplatePreview } from './domain/render-template-preview';
