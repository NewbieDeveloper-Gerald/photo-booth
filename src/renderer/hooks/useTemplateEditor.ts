import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEdit, canRedo, canUndo, createHistory, redo, undo, type TemplateHistory } from '../../features/layouts';
import type { TemplateDocument } from '../../features/layouts';
import { toErrorMessage } from '../../shared/errors';

export type TemplateSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 600;

type Options = { initialDocument: TemplateDocument; onSave: (document: TemplateDocument) => Promise<void>; autosaveDelayMs?: number };

export type TemplateEditorControls = {
  document: TemplateDocument;
  saveState: TemplateSaveState;
  saveError: string;
  selectedId: string | null;
  select: (elementId: string | null) => void;
  commit: (next: TemplateDocument) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  canUndoEdit: boolean;
  canRedoEdit: boolean;
  reset: (document: TemplateDocument) => void;
};

/**
 * Editing state for one layout: every change is a history step, and the newest step is
 * autosaved after a short pause so the operator never has to press Save.
 */
export function useTemplateEditor({ initialDocument, onSave, autosaveDelayMs = AUTOSAVE_DELAY_MS }: Options): TemplateEditorControls {
  const [history, setHistory] = useState<TemplateHistory>(() => createHistory(initialDocument));
  const [saveState, setSaveState] = useState<TemplateSaveState>('clean');
  const [saveError, setSaveError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const savedRef = useRef(initialDocument);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const reset = useCallback((document: TemplateDocument) => {
    savedRef.current = document;
    setHistory(createHistory(document));
    setSelectedId(null);
    setSaveState('clean');
    setSaveError('');
  }, []);

  const commit = useCallback((next: TemplateDocument) => {
    setHistory((current) => applyEdit(current, next));
  }, []);

  useEffect(() => {
    if (history.present === savedRef.current) return undefined;
    setSaveState('dirty');
    const timer = setTimeout(() => {
      setSaveState('saving');
      void onSaveRef.current(history.present)
        .then(() => { savedRef.current = history.present; setSaveState('saved'); setSaveError(''); })
        .catch((error: unknown) => { setSaveState('error'); setSaveError(toErrorMessage(error, 'Could not save the layout.')); });
    }, autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [history.present, autosaveDelayMs]);

  return {
    document: history.present,
    saveState,
    saveError,
    selectedId,
    select: setSelectedId,
    commit,
    undoEdit: () => setHistory((current) => undo(current)),
    redoEdit: () => setHistory((current) => redo(current)),
    canUndoEdit: canUndo(history),
    canRedoEdit: canRedo(history),
    reset,
  };
}
