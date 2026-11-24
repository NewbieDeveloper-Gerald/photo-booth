import type { TemplateDocument } from './template-document';

export type TemplateHistory = { past: TemplateDocument[]; present: TemplateDocument; future: TemplateDocument[] };

const MAX_UNDO_STEPS = 50;

export function createHistory(present: TemplateDocument): TemplateHistory {
  return { past: [], present, future: [] };
}

/** Records an edit. Undo history is capped so a long session cannot grow without bound. */
export function applyEdit(history: TemplateHistory, next: TemplateDocument): TemplateHistory {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-MAX_UNDO_STEPS), present: next, future: [] };
}

export function undo(history: TemplateHistory): TemplateHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: TemplateHistory): TemplateHistory {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export function canUndo(history: TemplateHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: TemplateHistory): boolean {
  return history.future.length > 0;
}

export function undoDepth(history: TemplateHistory): number {
  return history.past.length;
}
