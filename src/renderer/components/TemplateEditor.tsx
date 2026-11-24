import React, { useCallback, useEffect, useState } from 'react';
import {
  addImageElement, addLogoElement, addPhotoElement, addQrElement, addRectElement, addTextElement, getPagePreset,
  moveElementLayer, pagePresets, removeElement, removePhotoElement, renameTemplate, setBackgroundColor, updateElement,
  type PagePresetId, type TemplateDocument, type TemplateElement, type TemplateSummary,
} from '../../features/layouts';
import { toErrorMessage } from '../../shared/errors';
import { useTemplateEditor } from '../hooks/useTemplateEditor';
import { TemplateEditorCanvas } from './TemplateEditorCanvas';

export type TemplateEditorBridge = {
  listTemplates(): Promise<TemplateSummary[]>;
  getTemplate(templateId: string): Promise<TemplateDocument>;
  saveTemplate(document: TemplateDocument): Promise<TemplateSummary[]>;
  createTemplate(request: { pageId: PagePresetId; shots: number; name: string }): Promise<TemplateDocument>;
  duplicateTemplate(templateId: string): Promise<TemplateDocument>;
  deleteTemplate(templateId: string): Promise<TemplateSummary[]>;
  renameTemplate(templateId: string, name: string): Promise<TemplateSummary[]>;
  pickLayoutAsset(): Promise<{ assetName: string; bytes: number } | null>;
  readLayoutAsset(assetName: string): Promise<Uint8Array>;
};

type TemplateEditorProps = { bridge: TemplateEditorBridge; logoDataUrl: string | null; onClose: () => void; onTemplatesChanged: (templates: TemplateSummary[]) => void };

const DEFAULT_PAGE: PagePresetId = '4x6';
const DEFAULT_SHOTS = 3;

function describeState(state: string): string {
  if (state === 'dirty') return 'Unsaved changes…';
  if (state === 'saving') return 'Saving…';
  if (state === 'saved') return 'Saved';
  if (state === 'error') return 'Save failed';
  return 'No changes yet';
}

export function TemplateEditor({ bridge, logoDataUrl, onClose, onTemplatesChanged }: TemplateEditorProps): React.JSX.Element {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [document, setDocument] = useState<TemplateDocument | null>(null);
  const [images, setImages] = useState<Map<string, ImageBitmap>>(new Map());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPage, setNewPage] = useState<PagePresetId>(DEFAULT_PAGE);
  const [newShots, setNewShots] = useState(DEFAULT_SHOTS);
  const [nameDraft, setNameDraft] = useState('');

  const save = useCallback(async (next: TemplateDocument): Promise<void> => {
    const listing = await bridge.saveTemplate(next);
    setTemplates(listing);
    onTemplatesChanged(listing);
  }, [bridge, onTemplatesChanged]);

  const editor = useTemplateEditor({
    // The hook needs a document; the modal loads one before rendering the canvas.
    initialDocument: document ?? emptyFallback(),
    onSave: save,
  });

  useEffect(() => {
    if (document) editor.reset(document);
    // Reset only when a different layout is opened, not on every keystroke.
  }, [document]);

  useEffect(() => {
    void bridge.listTemplates().then((listing) => {
      setTemplates(listing);
      setActiveId((current) => current ?? listing[0]?.id ?? null);
    }).catch((thrown: unknown) => setError(toErrorMessage(thrown, 'Could not load layouts.')));
    // Load once when the editor opens.
  }, [bridge]);

  useEffect(() => {
    if (!activeId) return;
    void bridge.getTemplate(activeId)
      .then((loaded) => { setDocument(loaded); setNameDraft(loaded.name); })
      .catch((thrown: unknown) => setError(toErrorMessage(thrown, 'Could not open that layout.')));
  }, [bridge, activeId]);

  useEffect(() => {
    const assetNames = editor.document.elements.filter((element) => element.kind === 'image').map((element) => element.assetName);
    const missing = assetNames.filter((name) => !images.has(name));
    if (missing.length === 0) return;
    void Promise.all(missing.map(async (assetName) => {
      const bytes = await bridge.readLayoutAsset(assetName);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const bitmap = await createImageBitmap(new Blob([copy.buffer]));
      return [assetName, bitmap] as const;
    })).then((entries) => setImages((current) => new Map([...current, ...entries])))
      .catch((thrown: unknown) => setError(toErrorMessage(thrown, 'A layout picture could not be loaded.')));
    // Artwork is cached per editor session; only fetch what this layout needs.
  }, [bridge, editor.document, images]);

  const run = (operation: (current: TemplateDocument) => TemplateDocument): void => {
    try {
      editor.commit(operation(editor.document));
      setError('');
    } catch (thrown) {
      setError(toErrorMessage(thrown, 'That change is not possible.'));
    }
  };

  const withAdd = (operation: (current: TemplateDocument) => { template: TemplateDocument; elementId: string }): void => {
    try {
      const result = operation(editor.document);
      editor.commit(result.template);
      editor.select(result.elementId);
      setError('');
    } catch (thrown) {
      setError(toErrorMessage(thrown, 'That element could not be added.'));
    }
  };

  const handleNew = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await bridge.createTemplate({ pageId: newPage, shots: newShots, name: '' });
      const listing = await bridge.listTemplates();
      setTemplates(listing);
      onTemplatesChanged(listing);
      setActiveId(created.id);
      setDocument(created);
    } catch (thrown) { setError(toErrorMessage(thrown, 'Could not create a layout.')); }
    finally { setBusy(false); }
  };

  const handleDuplicate = async (): Promise<void> => {
    if (!activeId) return;
    setBusy(true);
    try {
      const copy = await bridge.duplicateTemplate(activeId);
      const listing = await bridge.listTemplates();
      setTemplates(listing);
      onTemplatesChanged(listing);
      setActiveId(copy.id);
      setDocument(copy);
    } catch (thrown) { setError(toErrorMessage(thrown, 'Could not duplicate that layout.')); }
    finally { setBusy(false); }
  };

  const handleDelete = async (): Promise<void> => {
    if (!activeId) return;
    setBusy(true);
    try {
      const listing = await bridge.deleteTemplate(activeId);
      setTemplates(listing);
      onTemplatesChanged(listing);
      setActiveId(listing[0]?.id ?? null);
      setDocument(null);
    } catch (thrown) { setError(toErrorMessage(thrown, 'Could not delete that layout.')); }
    finally { setBusy(false); }
  };

  const handleRename = async (): Promise<void> => {
    if (!activeId) return;
    try {
      const renamed = renameTemplate(editor.document, nameDraft);
      const listing = await bridge.renameTemplate(activeId, renamed.name);
      setTemplates(listing);
      onTemplatesChanged(listing);
      editor.reset(renamed);
      setDocument(renamed);
    } catch (thrown) { setError(toErrorMessage(thrown, 'Could not rename that layout.')); }
  };

  const handleAddPicture = async (): Promise<void> => {
    try {
      const picked = await bridge.pickLayoutAsset();
      if (!picked) return;
      withAdd((current) => addImageElement(current, picked.assetName));
    } catch (thrown) { setError(toErrorMessage(thrown, 'Could not add that picture.')); }
  };

  const selected: TemplateElement | undefined = editor.document.elements.find((element) => element.id === editor.selectedId);
  const page = getPagePreset(editor.document.page.id);

  return (
    <div className="modal-backdrop">
      <section className="template-editor" role="dialog" aria-modal="true" aria-label="Layout editor">
        <header className="template-editor-header">
          <div>
            <p className="eyebrow">LAYOUT EDITOR</p>
            <h2>{editor.document.name}</h2>
            <span className={`editor-state ${editor.saveState}`} role="status">{describeState(editor.saveState)}</span>
          </div>
          <div className="template-editor-header-actions">
            <button type="button" onClick={() => editor.undoEdit()} disabled={!editor.canUndoEdit}>Undo</button>
            <button type="button" onClick={() => editor.redoEdit()} disabled={!editor.canRedoEdit}>Redo</button>
            <button type="button" className="secondary-button" onClick={onClose}>Close</button>
          </div>
        </header>

        {error && <p className="pin-error" role="alert">{error}</p>}
        {editor.saveError && <p className="pin-error" role="alert">{editor.saveError}</p>}

        <div className="template-editor-body">
          <aside className="template-editor-list" aria-label="Layouts">
            <label>Layout
              <select aria-label="Layout to edit" value={activeId ?? ''} onChange={(event) => setActiveId(event.target.value)}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}{template.builtIn ? ' · built-in' : ''}</option>
                ))}
              </select>
            </label>
            <label>Name
              <input aria-label="Layout name" value={nameDraft} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => void handleRename()} />
            </label>
            <div className="editor-row">
              <button type="button" className="secondary-button" onClick={() => void handleDuplicate()} disabled={busy || !activeId}>Duplicate</button>
              <button type="button" className="secondary-button" onClick={() => void handleDelete()} disabled={busy || !activeId}>Delete</button>
            </div>
            <fieldset className="editor-new">
              <legend>New layout</legend>
              <label>Page
                <select aria-label="New layout page size" value={newPage} onChange={(event) => setNewPage(event.target.value as PagePresetId)}>
                  {pagePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                </select>
              </label>
              <label>Photos
                <select aria-label="New layout photo count" value={newShots} onChange={(event) => setNewShots(Number(event.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((shots) => <option key={shots} value={shots}>{shots}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void handleNew()} disabled={busy}>Create</button>
            </fieldset>
          </aside>

          <div className="template-editor-stage">
            <TemplateEditorCanvas
              document={editor.document}
              selectedId={editor.selectedId}
              onSelect={editor.select}
              onCommit={editor.commit}
              images={images}
            />
            <p className="editor-hint">Click an element to select it, drag to move, drag the blue square to resize. Snaps to a 10 px grid, the page centre and the edges.</p>
          </div>

          <aside className="template-editor-inspector" aria-label="Element inspector">
            <section>
              <p className="eyebrow">ADD</p>
              <div className="editor-row wrap">
                <button type="button" onClick={() => withAdd(addPhotoElement)} disabled={editor.document.shots >= 6}>Photo slot</button>
                <button type="button" onClick={() => withAdd((current) => addTextElement(current))}>Text</button>
                <button type="button" onClick={() => withAdd(addRectElement)}>Band</button>
                <button type="button" onClick={() => withAdd(addLogoElement)}>Logo</button>
                <button type="button" onClick={() => withAdd(addQrElement)}>QR</button>
                <button type="button" onClick={() => void handleAddPicture()}>Picture</button>
              </div>
            </section>

            {selected ? (
              <section className="editor-selected">
                <p className="eyebrow">{selected.kind.toUpperCase()} · {selected.id}</p>
                {selected.kind === 'text' && (
                  <>
                    <label>Text
                      <input aria-label="Element text" value={selected.text} maxLength={120} onChange={(event) => run((current) => updateElement(current, selected.id, { text: event.target.value }))} />
                    </label>
                    <label>Size
                      <input aria-label="Element font size" type="number" min={6} max={200} value={selected.fontSize} onChange={(event) => run((current) => updateElement(current, selected.id, { fontSize: Number(event.target.value) }))} />
                    </label>
                    <label>Colour
                      <input aria-label="Element colour" type="color" value={selected.color} onChange={(event) => run((current) => updateElement(current, selected.id, { color: event.target.value }))} />
                    </label>
                  </>
                )}
                {selected.kind === 'rect' && (
                  <label>Colour
                    <input aria-label="Band colour" type="color" value={selected.color} onChange={(event) => run((current) => updateElement(current, selected.id, { color: event.target.value }))} />
                  </label>
                )}
                <div className="editor-row wrap">
                  <button type="button" onClick={() => run((current) => moveElementLayer(current, selected.id, 'up'))}>Forward</button>
                  <button type="button" onClick={() => run((current) => moveElementLayer(current, selected.id, 'down'))}>Back</button>
                  <button type="button" onClick={() => run((current) => moveElementLayer(current, selected.id, 'front'))}>To front</button>
                  <button type="button" onClick={() => run((current) => moveElementLayer(current, selected.id, 'back'))}>To back</button>
                </div>
                <div className="editor-row">
                  {selected.kind === 'photo' && (
                    <button type="button" className="secondary-button" onClick={() => { run((current) => removePhotoElement(current, selected.slotNumber)); editor.select(null); }}>Remove photo slot</button>
                  )}
                  <button type="button" className="secondary-button" onClick={() => { run((current) => removeElement(current, selected.id)); editor.select(null); }}>Remove element</button>
                </div>
              </section>
            ) : <p className="editor-hint">Select an element to edit it.</p>}

            <section>
              <p className="eyebrow">PAGE</p>
              <span>{page.label} · {page.widthPx} × {page.heightPx} px · 300 dpi</span>
              <label>Background
                <input aria-label="Background colour" type="color" value={background(editor.document)} onChange={(event) => run((current) => setBackgroundColor(current, event.target.value))} />
              </label>
              {logoDataUrl && <p className="editor-hint">The event logo is previewed in the logo element; the printed layout uses the event&apos;s current logo.</p>}
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}

function background(document: TemplateDocument): string {
  const element = document.elements.find((item) => item.id === 'background');
  return element && element.kind === 'rect' ? element.color : '#f4f0ec';
}

/** The hook needs a document before one is loaded; this placeholder is never displayed. */
function emptyFallback(): TemplateDocument {
  return {
    id: 'placeholder', name: 'Loading…', shots: 1, copies: 1,
    page: getPagePreset(DEFAULT_PAGE), elements: [],
  };
}
