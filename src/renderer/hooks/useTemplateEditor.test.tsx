// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutPresets, addTextElement, moveElement, renameTemplate, templateFromCatalogPreset, type TemplateDocument } from '../../features/layouts';
import { useTemplateEditor } from './useTemplateEditor';

const document = (): TemplateDocument => templateFromCatalogPreset(layoutPresets[0]!);
const DELAY = 600;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useTemplateEditor', () => {
  it('does not save a freshly opened layout', () => {
    const onSave = vi.fn(async () => undefined);
    renderHook(() => useTemplateEditor({ initialDocument: document(), onSave }));
    act(() => { vi.advanceTimersByTime(DELAY * 2); });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('autosaves an edit once, after the pause', async () => {
    const onSave = vi.fn(async () => undefined);
    const { result } = renderHook(() => useTemplateEditor({ initialDocument: document(), onSave }));
    const edited = addTextElement(result.current.document).template;
    act(() => { result.current.commit(edited); });
    expect(result.current.saveState).toBe('dirty');
    act(() => { vi.advanceTimersByTime(DELAY - 1); });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(edited);
    expect(result.current.saveState).toBe('saved');
  });

  it('coalesces rapid edits into one save of the latest state', async () => {
    const saved: TemplateDocument[] = [];
    const onSave = vi.fn(async (next: TemplateDocument) => { saved.push(next); });
    const { result } = renderHook(() => useTemplateEditor({ initialDocument: document(), onSave }));
    act(() => { result.current.commit(addTextElement(result.current.document).template); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { result.current.commit(renameTemplate(result.current.document, 'Renamed')); });
    await act(async () => { vi.advanceTimersByTime(DELAY); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saved[0]!.name).toBe('Renamed');
  });

  it('reports a failed save and keeps the layout dirty for the next attempt', async () => {
    const onSave = vi.fn(async () => { throw new Error('disk full'); });
    const { result } = renderHook(() => useTemplateEditor({ initialDocument: document(), onSave }));
    act(() => { result.current.commit(addTextElement(result.current.document).template); });
    await act(async () => { vi.advanceTimersByTime(DELAY); });
    expect(result.current.saveState).toBe('error');
    expect(result.current.saveError).toMatch(/disk full/);
  });

  it('undoes and redoes edits, saving the result', async () => {
    const onSave = vi.fn(async () => undefined);
    const { result } = renderHook(() => useTemplateEditor({ initialDocument: document(), onSave }));
    const edited = moveElement(addTextElement(result.current.document).template, 'photo-1', { dx: 40, dy: 40 });
    act(() => { result.current.commit(edited); });
    await act(async () => { vi.advanceTimersByTime(DELAY); });
    expect(result.current.canUndoEdit).toBe(true);

    act(() => { result.current.undoEdit(); });
    await act(async () => { vi.advanceTimersByTime(DELAY); });
    expect(result.current.document.elements).toHaveLength(document().elements.length);
    expect(result.current.canRedoEdit).toBe(true);
    expect(onSave).toHaveBeenLastCalledWith(result.current.document);

    act(() => { result.current.redoEdit(); });
    expect(result.current.document.elements).toHaveLength(edited.elements.length);
  });

  it('resets to another layout without saving the previous one', async () => {
    const onSave = vi.fn(async () => undefined);
    const { result } = renderHook(() => useTemplateEditor({ initialDocument: document(), onSave }));
    act(() => { result.current.commit(addTextElement(result.current.document).template); });
    const other = templateFromCatalogPreset(layoutPresets[1]!);
    act(() => { result.current.reset(other); });
    await act(async () => { vi.advanceTimersByTime(DELAY); });
    expect(result.current.document).toBe(other);
    expect(result.current.saveState).toBe('clean');
    expect(result.current.canUndoEdit).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('tracks the selected element', () => {
    const { result } = renderHook(() => useTemplateEditor({ initialDocument: document(), onSave: async () => undefined }));
    act(() => { result.current.select('header-text'); });
    expect(result.current.selectedId).toBe('header-text');
    act(() => { result.current.select(null); });
    expect(result.current.selectedId).toBeNull();
  });
});
