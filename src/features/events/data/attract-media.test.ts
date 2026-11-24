import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/data/template-repository';
import { addAttractMedia, listAttractMedia, readAttractMedia, removeAttractMedia } from './attract-media';
import { MAX_ATTRACT_MEDIA_BYTES, MAX_ATTRACT_MEDIA_FILES } from '../../../shared/constants/limits';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(200, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(200, 2)]);

function setup(): { directory: string; eventId: string; sources: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-attract-'));
  directories.push(directory);
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
  const sources = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-attract-src-'));
  directories.push(sources);
  return { directory, eventId: 'default-event', sources };
}

function writeSource(folder: string, name: string, data: Buffer): string {
  const file = path.join(folder, name);
  fs.writeFileSync(file, data);
  return file;
}

describe('attract screen media (F19)', () => {
  it('starts empty and copies a chosen photo into the event folder', () => {
    const { directory, eventId, sources } = setup();
    expect(listAttractMedia(directory, eventId)).toEqual([]);
    const media = addAttractMedia(directory, eventId, [writeSource(sources, 'Party Night.PNG', PNG)]);
    expect(media).toHaveLength(1);
    // The stored name is tidied for the file system; the list shows that tidy name.
    expect(media[0]).toMatchObject({ kind: 'image', label: 'party-night.png', bytes: PNG.length });
    expect(media[0]?.id).toMatch(/^party-night-[0-9a-f]{8}\.png$/);
    const stored = path.join(directory, 'event-assets', eventId, 'attract', media[0]!.id);
    expect(fs.readFileSync(stored).equals(PNG)).toBe(true);
    // The source can go home with the operator: the booth keeps its own copy.
    fs.rmSync(sources, { recursive: true, force: true });
    expect(listAttractMedia(directory, eventId)).toHaveLength(1);
  });

  it('takes a video clip and reads the bytes back with a playable type', () => {
    const { directory, eventId, sources } = setup();
    const [clip] = addAttractMedia(directory, eventId, [writeSource(sources, 'booth-loop.mp4', MP4)]);
    expect(clip).toMatchObject({ kind: 'video', label: 'booth-loop.mp4' });
    const read = readAttractMedia(directory, eventId, clip!.id);
    expect(read.kind).toBe('video');
    expect(read.mimeType).toBe('video/mp4');
    expect(read.bytes.equals(MP4)).toBe(true);
  });

  it('mixes photos and clips and keeps them in a stable order', () => {
    const { directory, eventId, sources } = setup();
    addAttractMedia(directory, eventId, [writeSource(sources, 'a.jpg', JPEG), writeSource(sources, 'b.png', PNG)]);
    const listed = listAttractMedia(directory, eventId);
    expect(listed.map((item) => item.kind)).toEqual(['image', 'image']);
    expect(listed.map((item) => item.label)).toEqual(['a.jpg', 'b.png']);
  });

  it('refuses files the loop cannot play, and ones that lie about their type', () => {
    const { directory, eventId, sources } = setup();
    expect(() => addAttractMedia(directory, eventId, [writeSource(sources, 'notes.txt', PNG)])).toThrow(/PNG, JPEG, WebP, MP4/);
    expect(() => addAttractMedia(directory, eventId, [writeSource(sources, 'fake.png', Buffer.alloc(200, 9))])).toThrow(/not the image or video its name claims/);
    expect(() => addAttractMedia(directory, eventId, [writeSource(sources, 'fake.mp4', PNG)])).toThrow(/not the image or video its name claims/);
    expect(() => addAttractMedia(directory, eventId, [])).toThrow(/Choose photos or videos/);
    expect(listAttractMedia(directory, eventId)).toEqual([]);
  });

  it('caps the file count and the size of a single file', () => {
    const { directory, eventId, sources } = setup();
    const files = Array.from({ length: MAX_ATTRACT_MEDIA_FILES }, (_, index) => writeSource(sources, `photo-${index}.jpg`, JPEG));
    const added = addAttractMedia(directory, eventId, files);
    expect(added).toHaveLength(MAX_ATTRACT_MEDIA_FILES);
    expect(() => addAttractMedia(directory, eventId, [writeSource(sources, 'extra.jpg', JPEG)])).toThrow(`${MAX_ATTRACT_MEDIA_FILES}`);

    const big = path.join(sources, 'huge.jpg');
    fs.writeFileSync(big, JPEG);
    fs.truncateSync(big, MAX_ATTRACT_MEDIA_BYTES + 1);
    const other = setup();
    expect(() => addAttractMedia(other.directory, other.eventId, [big])).toThrow(/25 MB or smaller/);
  });

  it('removes one file and refuses ids that point outside the event folder', () => {
    const { directory, eventId, sources } = setup();
    const [media] = addAttractMedia(directory, eventId, [writeSource(sources, 'keep.png', PNG), writeSource(sources, 'drop.png', PNG)]);
    expect(removeAttractMedia(directory, eventId, media!.id)).toHaveLength(1);
    expect(() => removeAttractMedia(directory, eventId, '../logo.png')).toThrow(/Invalid attract screen file/);
    expect(() => removeAttractMedia(directory, eventId, 'notes.txt')).toThrow(/Invalid attract screen file/);
    expect(() => readAttractMedia(directory, eventId, 'missing.png')).toThrow(/no longer on this booth/);
    // Removing a file that is already gone is not an error: the list is simply unchanged.
    expect(removeAttractMedia(directory, eventId, media!.id)).toHaveLength(1);
  });

  it('rejects an unknown or malformed event', () => {
    const { directory } = setup();
    expect(() => listAttractMedia(directory, '../event')).toThrow(/Invalid event/);
    expect(() => listAttractMedia(directory, 'not-an-event')).toThrow(/Event not found/);
    expect(() => listAttractMedia(directory, '00000000-0000-0000-0000-000000000000')).toThrow(/Event not found/);
  });
});
