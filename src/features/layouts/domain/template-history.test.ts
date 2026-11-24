import { describe, expect, it } from 'vitest';
import { layoutPresets } from '../catalog';
import { templateFromCatalogPreset } from './template-builder';
import { addTextElement, renameTemplate } from './template-editing';
import { applyEdit, canRedo, canUndo, createHistory, redo, undo, undoDepth } from './template-history';

const document = (): ReturnType<typeof templateFromCatalogPreset> => templateFromCatalogPreset(layoutPresets[0]!);

describe('template history', () => {
  it('starts empty and records edits', () => {
    const history = createHistory(document());
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    const edited = applyEdit(history, addTextElement(history.present).template);
    expect(canUndo(edited)).toBe(true);
    expect(undoDepth(edited)).toBe(1);
  });

  it('undoes and redoes in order', () => {
    let history = createHistory(document());
    const first = addTextElement(history.present).template;
    history = applyEdit(history, first);
    const second = renameTemplate(first, 'Renamed');
    history = applyEdit(history, second);
    expect(history.present.name).toBe('Renamed');

    history = undo(history);
    expect(history.present.name).toBe(document().name);
    expect(history.present.elements.some((element) => element.id === 'text-1')).toBe(true);

    history = undo(history);
    expect(history.present.elements.some((element) => element.id === 'text-1')).toBe(false);
    expect(undo(history)).toBe(history);

    history = redo(history);
    history = redo(history);
    expect(history.present.name).toBe('Renamed');
    expect(redo(history)).toBe(history);
  });

  it('drops the redo stack when a new edit follows an undo', () => {
    let history = createHistory(document());
    history = applyEdit(history, addTextElement(history.present).template);
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = applyEdit(history, renameTemplate(history.present, 'Fresh'));
    expect(canRedo(history)).toBe(false);
  });

  it('ignores edits that change nothing', () => {
    const history = createHistory(document());
    expect(applyEdit(history, history.present)).toBe(history);
  });

  it('caps the undo history', () => {
    let history = createHistory(document());
    for (let step = 0; step < 60; step += 1) history = applyEdit(history, renameTemplate(history.present, `v${step}`));
    expect(undoDepth(history)).toBe(50);
  });
});
