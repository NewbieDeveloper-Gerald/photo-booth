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
    expect(readBoothSetting(directory, 'selectedCameraId')).toBe('usb-cam-1');
    expect(readBoothSetting(directory, 'countdownSeconds')).toBe('5');
  });

  it('rejects countdown values outside 3 to 10 seconds', () => {
    const directory = createDataDirectory();
    expect(() => writeBoothSetting(directory, 'countdownSeconds', '2')).toThrow(/3 to 10/);
    expect(() => writeBoothSetting(directory, 'countdownSeconds', '11')).toThrow(/3 to 10/);
  });

  it('rejects unsupported resolution values and unknown setting keys', () => {
    const directory = createDataDirectory();
    expect(() => writeBoothSetting(directory, 'cameraResolution', '8k')).toThrow('Unsupported camera resolution');
    expect(() => readBoothSetting(directory, 'adminPin')).toThrow('Unsupported setting');
  });
});
