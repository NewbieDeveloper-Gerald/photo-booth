import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeStorage } from './database';
import { readBoothSetting, writeBoothSetting } from './settings';

const directories: string[] = [];
function createDataDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-settings-'));
  directories.push(directory);
  initializeStorage(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('booth settings', () => {
  it('stores and reads supported camera preferences', () => {
    const directory = createDataDirectory();
    writeBoothSetting(directory, 'selectedCameraId', 'usb-cam-1');
    writeBoothSetting(directory, 'countdownSeconds', '5');
    writeBoothSetting(directory, 'lowDiskWarningGB', '2');
    writeBoothSetting(directory, 'selectedPrinterName', 'Canon G3010 series');
    writeBoothSetting(directory, 'downloadBaseUrl', 'https://photos.example.com');
    expect(readBoothSetting(directory, 'selectedCameraId')).toBe('usb-cam-1');
    expect(readBoothSetting(directory, 'countdownSeconds')).toBe('5');
    expect(readBoothSetting(directory, 'lowDiskWarningGB')).toBe('2');
    expect(readBoothSetting(directory, 'selectedPrinterName')).toBe('Canon G3010 series');
    expect(readBoothSetting(directory, 'downloadBaseUrl')).toBe('https://photos.example.com');
  });

  it('rejects countdown values outside 3 to 10 seconds', () => {
    const directory = createDataDirectory();
    expect(() => writeBoothSetting(directory, 'countdownSeconds', '2')).toThrow(/3 to 10/);
    expect(() => writeBoothSetting(directory, 'countdownSeconds', '11')).toThrow(/3 to 10/);
  });

  it('stores editable consent wording and rejects overlong text', () => {
    const directory = createDataDirectory();
    const wording = 'Photos remain on this booth until removed by the operator; QR links expire after 30 days.';
    writeBoothSetting(directory, 'consentText', wording);
    expect(readBoothSetting(directory, 'consentText')).toBe(wording);
    expect(() => writeBoothSetting(directory, 'consentText', '   ')).toThrow(/cannot be blank/);
    expect(() => writeBoothSetting(directory, 'consentText', 'x'.repeat(1201))).toThrow(/1200 characters/);
  });

  it('rejects unsupported resolution values and unknown setting keys', () => {
    const directory = createDataDirectory();
    expect(() => writeBoothSetting(directory, 'cameraResolution', '8k')).toThrow('Unsupported camera resolution');
    expect(() => writeBoothSetting(directory, 'lowDiskWarningGB', '-1')).toThrow(/threshold/);
    expect(() => writeBoothSetting(directory, 'downloadBaseUrl', 'http://photos.example.com')).toThrow(/HTTPS/);
    expect(() => readBoothSetting(directory, 'adminPin')).toThrow('Unsupported setting');
  });
});
