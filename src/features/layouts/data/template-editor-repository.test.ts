import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { createSession } from '../../capture/node';
import { createTemplate, deleteTemplate, duplicateTemplate, listTemplates, loadTemplate, renameTemplate, saveTemplate } from './template-repository';
import { listLayoutAssets, readLayoutAsset, removeUnusedLayoutAssets, saveLayoutAsset } from './layout-assets';
import { addImageElement, addTextElement, moveElement } from '../domain/template-editing';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-editor-'));
  initializeStorage(directory);
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('creating and editing layouts', () => {
  it('creates a custom layout with the requested page and photo count', () => {
    const created = createTemplate(directory, { pageId: '5x7', shots: 4, name: 'Big print' });
    expect(created).toMatchObject({ name: 'Big print', shots: 4, copies: 1 });
    expect(created.page).toMatchObject({ id: '5x7', widthPx: 1500, heightPx: 2100 });
    expect(created.id.startsWith('custom-')).toBe(true);
    const listing = listTemplates(directory).find((template) => template.id === created.id)!;
    expect(listing.builtIn).toBe(false);
  });

  it('names a layout from its page when no name is given', () => {
    expect(createTemplate(directory, { pageId: '2x6-strip', shots: 2, name: '  ' }).name).toMatch(/2 × 6 in strip/);
  });

  it('saves edits and keeps a custom layout custom', () => {
    const created = createTemplate(directory, { pageId: '4x6', shots: 2, name: 'Mine' });
    const edited = moveElement(addTextElement(created, 'Hello').template, 'photo-1', { dx: 20, dy: 20 });
    saveTemplate(directory, edited);
    const reloaded = loadTemplate(directory, created.id);
    expect(reloaded.elements).toHaveLength(edited.elements.length);
    expect(listTemplates(directory).find((template) => template.id === created.id)!.builtIn).toBe(false);
  });

  it('keeps a built-in layout marked built-in after an edit', () => {
    const builtIn = loadTemplate(directory, 'double-strip-3');
    saveTemplate(directory, renameTemplate === undefined ? builtIn : { ...builtIn, name: 'Edited built-in' });
    expect(listTemplates(directory).find((template) => template.id === 'double-strip-3')!.builtIn).toBe(true);
  });

  it('renames a layout and rejects an empty name at the storage layer', () => {
    const created = createTemplate(directory, { pageId: '4x6', shots: 1, name: 'Before' });
    expect(renameTemplate(directory, created.id, '  After  ').name).toBe('After');
    expect(loadTemplate(directory, created.id).name).toBe('After');
  });

  it('duplicates a built-in layout into an editable copy', () => {
    const copy = duplicateTemplate(directory, 'double-strip-3');
    expect(copy.id).not.toBe('double-strip-3');
    expect(copy.name).toBe(`${loadTemplate(directory, 'double-strip-3').name} copy`);
    expect(listTemplates(directory).find((template) => template.id === copy.id)!.builtIn).toBe(false);
    expect(loadTemplate(directory, copy.id).elements).toEqual(loadTemplate(directory, 'double-strip-3').elements);
  });

  it('refuses to delete a built-in layout', () => {
    expect(() => deleteTemplate(directory, 'double-strip-3')).toThrow(/Built-in layouts can be edited, but not deleted/);
  });

  it('deletes a custom layout that no session used', () => {
    const created = createTemplate(directory, { pageId: '4x6', shots: 2, name: 'Temporary' });
    deleteTemplate(directory, created.id);
    expect(listTemplates(directory).some((template) => template.id === created.id)).toBe(false);
    expect(() => loadTemplate(directory, created.id)).toThrow(/does not exist/);
  });

  it('refuses to delete a layout a saved session still uses', () => {
    const created = createTemplate(directory, { pageId: '4x6', shots: 2, name: 'In use' });
    createSession(directory, created.id);
    expect(() => deleteTemplate(directory, created.id)).toThrow(/used by a saved session/);
  });

  it('reports a missing layout instead of a database error', () => {
    expect(() => deleteTemplate(directory, 'custom-missing')).toThrow(/does not exist/);
  });
});

describe('layout artwork', () => {
  it('copies a picture into the booth and reads it back', () => {
    const source = path.join(directory, 'artwork.png');
    fs.writeFileSync(source, pngBytes);
    const { assetName, bytes } = saveLayoutAsset(directory, source);
    expect(assetName).toMatch(/\.png$/);
    expect(bytes).toBe(pngBytes.length);
    expect(Buffer.from(readLayoutAsset(directory, assetName))).toEqual(pngBytes);
    expect(listLayoutAssets(directory)).toContain(assetName);
  });

  it('renames .jpeg to .jpg and accepts webp', () => {
    const jpeg = path.join(directory, 'photo.jpeg');
    fs.writeFileSync(jpeg, pngBytes);
    expect(saveLayoutAsset(directory, jpeg).assetName).toMatch(/\.jpg$/);
    const webp = path.join(directory, 'art.webp');
    fs.writeFileSync(webp, pngBytes);
    expect(saveLayoutAsset(directory, webp).assetName).toMatch(/\.webp$/);
  });

  it('rejects unsupported, oversized and missing files', () => {
    const text = path.join(directory, 'notes.txt');
    fs.writeFileSync(text, 'hello');
    expect(() => saveLayoutAsset(directory, text)).toThrow(/PNG, JPEG or WebP/);
    const huge = path.join(directory, 'huge.png');
    fs.writeFileSync(huge, Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(() => saveLayoutAsset(directory, huge)).toThrow(/larger than 8 MB/);
    expect(() => saveLayoutAsset(directory, path.join(directory, 'missing.png'))).toThrow();
  });

  it('refuses path traversal and unknown pictures when reading', () => {
    expect(() => readLayoutAsset(directory, '../secrets.png')).toThrow(/Invalid layout picture/);
    expect(() => readLayoutAsset(directory, 'nope.png')).toThrow(/missing from this booth/);
  });

  it('removes artwork no template refers to', () => {
    const source = path.join(directory, 'keep.png');
    fs.writeFileSync(source, pngBytes);
    const kept = saveLayoutAsset(directory, source);
    const dropped = saveLayoutAsset(directory, source);
    expect(removeUnusedLayoutAssets(directory, [kept.assetName])).toBe(1);
    expect(listLayoutAssets(directory)).toEqual([kept.assetName]);
    expect(listLayoutAssets(directory)).not.toContain(dropped.assetName);
  });

  it('stores an image element on a layout and round-trips its asset name', () => {
    const source = path.join(directory, 'bg.png');
    fs.writeFileSync(source, pngBytes);
    const { assetName } = saveLayoutAsset(directory, source);
    const created = createTemplate(directory, { pageId: '4x6', shots: 2, name: 'With art' });
    saveTemplate(directory, addImageElement(created, assetName).template);
    const image = loadTemplate(directory, created.id).elements.find((element) => element.kind === 'image');
    expect(image).toMatchObject({ kind: 'image', assetName, width: 1200, height: 1800 });
  });
});
