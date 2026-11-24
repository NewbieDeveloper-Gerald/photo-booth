export {
  builtinTemplates, createTemplate, deleteTemplate, duplicateTemplate, ensureBuiltinTemplates,
  listTemplates, loadTemplate, renameTemplate, saveTemplate, type NewTemplateRequest,
} from './data/template-repository';
export { listLayoutAssets, readLayoutAsset, removeUnusedLayoutAssets, saveLayoutAsset } from './data/layout-assets';
export type { TemplateSummary } from './domain/template-document';
