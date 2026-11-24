import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { createSession } from '../../capture/node';
import { ensureBuiltinTemplates } from '../../layouts/data/template-repository';
import {
  deletePrinterProfile, getPrinterProfile, listPrinterProfiles, markPrinterProfileChecked, resolvePrintProfile, savePrinterProfile,
} from './printer-profile-repository';
import { enqueuePrintJob, processNextPrintJob } from './print-queue-repository';
import { MockPrinter } from '../devices/printer';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function setup(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-profiles-'));
  directories.push(directory);
  initializeStorage(directory);
  return directory;
}

const qw410 = {
  name: 'Front counter', modelId: 'dnp-qw410', printerName: 'DNP QW410', paperId: '4x6',
  cutMode: 'per-print', colorMode: 'color', brightness: 0, contrast: 0, saturation: 0, isDefault: true,
} as const;

describe('printer profile repository (F25)', () => {
  it('saves a profile and reads it back unchanged', () => {
    const directory = setup();
    const saved = savePrinterProfile(directory, { ...qw410, colorMode: 'mono', contrast: 5 });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved).toMatchObject({ name: 'Front counter', modelId: 'dnp-qw410', paperId: '4x6', colorMode: 'mono', contrast: 5, isDefault: true, verifiedAt: null });
    expect(listPrinterProfiles(directory)).toEqual([saved]);
    expect(getPrinterProfile(directory, saved.id)).toEqual(saved);
    expect(getPrinterProfile(directory, 'not-an-id')).toBeNull();
  });

  it('keeps one profile per printer and one booth default', () => {
    const directory = setup();
    const first = savePrinterProfile(directory, qw410);
    const second = savePrinterProfile(directory, { ...qw410, name: 'Night shift', printerName: 'DNP DS620', modelId: 'dnp-ds620' });
    // Saving another default takes the flag away from the first, so the booth always has one answer.
    expect(listPrinterProfiles(directory).filter((profile) => profile.isDefault).map((profile) => profile.id)).toEqual([second.id]);
    expect(() => savePrinterProfile(directory, { ...qw410, name: 'Clash', isDefault: false })).toThrow('already has a profile');
    expect(getPrinterProfile(directory, first.id)?.isDefault).toBe(false);
  });

  it('forgets the test-print tick when the settings change, and keeps it when only the name does', () => {
    const directory = setup();
    const saved = savePrinterProfile(directory, qw410);
    const checked = markPrinterProfileChecked(directory, saved.id, true);
    expect(checked.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const renamed = savePrinterProfile(directory, { ...checked, name: 'Front counter 2' });
    expect(renamed.verifiedAt).toBe(checked.verifiedAt);

    const widened = savePrinterProfile(directory, { ...renamed, modelId: 'dnp-ds-rx1hs', paperId: '6x8' });
    expect(widened.verifiedAt).toBeNull();
    expect(widened.paperId).toBe('6x8');

    expect(markPrinterProfileChecked(directory, saved.id, false).verifiedAt).toBeNull();
  });

  it('refuses invalid input and unknown profiles', () => {
    const directory = setup();
    expect(() => savePrinterProfile(directory, { ...qw410, paperId: '6x8' })).toThrow('does not take that paper size');
    expect(() => savePrinterProfile(directory, { ...qw410, id: '22222222-2222-4222-8222-222222222222' })).toThrow('Printer profile not found');
    expect(() => deletePrinterProfile(directory, '22222222-2222-4222-8222-222222222222')).toThrow('Printer profile not found');
    expect(() => markPrinterProfileChecked(directory, 'nope', true)).toThrow('Invalid printer profile');

    const saved = savePrinterProfile(directory, qw410);
    expect(deletePrinterProfile(directory, saved.id)).toBe(true);
    expect(listPrinterProfiles(directory)).toEqual([]);
  });

  it('resolves the profile a printer should print with', () => {
    const directory = setup();
    const generic = savePrinterProfile(directory, { ...qw410, name: 'Booth default', printerName: '' });
    const selphy = savePrinterProfile(directory, {
      ...qw410, name: 'Selphy', modelId: 'canon-selphy-cp1500', printerName: 'SELPHY CP1500', cutMode: 'per-job', isDefault: false,
    });
    expect(resolvePrintProfile(directory, 'selphy cp1500')?.id).toBe(selphy.id);
    expect(resolvePrintProfile(directory, 'Unknown printer')?.id).toBe(generic.id);
  });

  it('sets up the sheet from the profile and copies the profile onto the queued job', async () => {
    const directory = setup();
    ensureBuiltinTemplates(directory);
    const profile = savePrinterProfile(directory, { ...qw410, name: 'Six by eight', modelId: 'dnp-ds-rx1hs', paperId: '6x8', colorMode: 'mono', printerName: 'DNP DS-RX1HS' });
    const { sessionId } = createSession(directory, 'double-strip-3');
    const paths = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    const eventId = (db.prepare('SELECT event_id AS eventId FROM sessions WHERE id = ?').get(sessionId) as { eventId: string }).eventId;
    const folder = path.join(paths.photosDirectory, eventId, sessionId);
    fs.mkdirSync(folder, { recursive: true });
    const outputPath = path.join(folder, 'finished.jpg');
    fs.writeFileSync(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    db.prepare("INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES ('out-1', ?, ?, 'finished-double-strip-3', 1200, 1800)").run(sessionId, outputPath);
    db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
    db.close();

    const job = enqueuePrintJob(directory, sessionId, 'DNP DS-RX1HS');
    expect(job.profileId).toBe(profile.id);
    expect(job.profileLabel).toBe('DNP DS-RX1HS · 6 × 8 in · Cut after every print · Black and white');

    const printer = new MockPrinter();
    const printed = await processNextPrintJob(directory, printer)!;
    expect(printed?.status).toBe('done');
    expect(printer.jobs[0]?.options).toEqual({
      printerName: 'DNP DS-RX1HS', widthMicrons: 152400, heightMicrons: 203200, filter: 'grayscale(1)', cutMode: 'per-print',
    });
  });

  it('prints a layout-size sheet when the booth has no profile at all', async () => {
    const directory = setup();
    ensureBuiltinTemplates(directory);
    const { sessionId } = createSession(directory, 'double-strip-3');
    const paths = JSON.parse(fs.readFileSync(path.join(directory, 'photobooth-paths.json'), 'utf8')) as { photosDirectory: string };
    const db = new Database(path.join(directory, 'photobooth.sqlite'));
    const eventId = (db.prepare('SELECT event_id AS eventId FROM sessions WHERE id = ?').get(sessionId) as { eventId: string }).eventId;
    const folder = path.join(paths.photosDirectory, eventId, sessionId);
    fs.mkdirSync(folder, { recursive: true });
    const outputPath = path.join(folder, 'finished.jpg');
    fs.writeFileSync(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    db.prepare("INSERT INTO outputs (id, session_id, output_path, kind, width, height) VALUES ('out-1', ?, ?, 'finished-double-strip-3', 1200, 1800)").run(sessionId, outputPath);
    db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(sessionId);
    db.close();

    const job = enqueuePrintJob(directory, sessionId, 'Any printer');
    expect(job.profileId).toBeNull();
    const printer = new MockPrinter();
    await processNextPrintJob(directory, printer);
    expect(printer.jobs[0]?.options).toEqual({ printerName: 'Any printer', widthMicrons: 101600, heightMicrons: 152400 });
  });
});
