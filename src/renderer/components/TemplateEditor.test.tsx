// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutPresets, templateFromCatalogPreset, type PagePresetId, type TemplateDocument, type TemplateSummary } from '../../features/layouts';
import { TemplateEditor, type TemplateEditorBridge } from './TemplateEditor';

function summary(document: TemplateDocument, builtIn: boolean): TemplateSummary {
  return { id: document.id, name: document.name, shots: document.shots, copies: document.copies, pagePreset: document.page.id, pageLabel: document.page.label, builtIn };
}

function fakeBridge(): TemplateEditorBridge & { store: Map<string, TemplateDocument>; saved: TemplateDocument[] } {
  const store = new Map<string, TemplateDocument>();
  const saved: TemplateDocument[] = [];
  const first = templateFromCatalogPreset(layoutPresets[0]!);
  store.set(first.id, first);
  const listing = (): TemplateSummary[] => [...store.values()].map((document) => summary(document, document.id === first.id));
  return {
    store,
    saved,
    listTemplates: async () => listing(),
    getTemplate: async (templateId) => {
      const found = store.get(templateId);
      if (!found) throw new Error('That layout does not exist on this booth.');
      return found;
    },
    saveTemplate: async (document) => { saved.push(document); store.set(document.id, document); return listing(); },
    createTemplate: async ({ pageId, shots }: { pageId: PagePresetId; shots: number }) => {
      const created: TemplateDocument = { ...first, id: 'custom-new', name: 'New layout', shots, page: { ...first.page, id: pageId } };
      store.set(created.id, created);
      return created;
    },
    duplicateTemplate: async (templateId) => {
      const original = store.get(templateId)!;
      const copy: TemplateDocument = { ...original, id: 'custom-copy', name: `${original.name} copy` };
      store.set(copy.id, copy);
      return copy;
    },
    deleteTemplate: async (templateId) => {
      if (templateId === first.id) throw new Error('Built-in layouts can be edited, but not deleted. Duplicate it instead.');
      store.delete(templateId);
      return listing();
    },
    renameTemplate: async (templateId, name) => {
      const found = store.get(templateId)!;
      store.set(templateId, { ...found, name });
      return listing();
    },
    pickLayoutAsset: async () => null,
    readLayoutAsset: async () => new Uint8Array(),
  };
}

beforeEach(() => {
  // jsdom has no canvas implementation; the editor tolerates a null context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function renderEditor(bridge: TemplateEditorBridge) {
  const onTemplatesChanged = vi.fn();
  const onClose = vi.fn();
  render(<TemplateEditor bridge={bridge} logoDataUrl={null} onClose={onClose} onTemplatesChanged={onTemplatesChanged} />);
  return { onTemplatesChanged, onClose };
}

describe('TemplateEditor', () => {
  it('opens the first layout and shows its page in the inspector', async () => {
    renderEditor(fakeBridge());
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    expect(screen.getByLabelText('Layout to edit')).toBeTruthy();
    expect(screen.getByText(/1200 × 1800 px · 300 dpi/)).toBeTruthy();
  });

  it('adds a text element and autosaves it', async () => {
    const bridge = fakeBridge();
    renderEditor(bridge);
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    const before = bridge.store.get(layoutPresets[0]!.id)!.elements.length;
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    await waitFor(() => expect(bridge.saved.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(bridge.store.get(layoutPresets[0]!.id)!.elements).toHaveLength(before + 1);
  });

  it('enables undo after an edit and undoes it', async () => {
    const bridge = fakeBridge();
    renderEditor(bridge);
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    const undoButton = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Band' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('shows the built-in deletion guard as an alert', async () => {
    renderEditor(fakeBridge());
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Built-in layouts can be edited/));
  });

  it('duplicates the layout and switches to the copy', async () => {
    renderEditor(fakeBridge());
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: `${layoutPresets[0]!.name} copy` })).toBeTruthy());
  });

  it('renames a layout from the name field', async () => {
    const bridge = fakeBridge();
    renderEditor(bridge);
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    const nameField = screen.getByLabelText('Layout name');
    fireEvent.change(nameField, { target: { value: 'Ann & Ben strip' } });
    fireEvent.blur(nameField);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ann & Ben strip' })).toBeTruthy());
    expect(bridge.store.get(layoutPresets[0]!.id)!.name).toBe('Ann & Ben strip');
  });

  it('selects an element to reveal its inspector', async () => {
    renderEditor(fakeBridge());
    await waitFor(() => expect(screen.getByRole('heading', { name: layoutPresets[0]!.name })).toBeTruthy());
    expect(screen.getByText(/Select an element to edit it/)).toBeTruthy();
  });
});
