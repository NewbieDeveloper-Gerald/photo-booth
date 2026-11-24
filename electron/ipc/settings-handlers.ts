import { ipcMain } from 'electron';
import { readBoothSetting, writeBoothSetting } from '../../src/features/storage/node.js';
import { isBoothSettingKey } from '../../src/shared/constants/settings-keys.js';
import type { IpcContext } from './context.js';

export function registerSettingsHandlers({ userDataPath }: IpcContext): void {
  ipcMain.handle('settings:get', (_event, key: unknown) => {
    if (!isBoothSettingKey(key)) throw new Error('Unsupported setting');
    return readBoothSetting(userDataPath, key);
  });
  ipcMain.handle('settings:set', (_event, key: unknown, value: unknown) => {
    if (!isBoothSettingKey(key)) throw new Error('Unsupported setting');
    writeBoothSetting(userDataPath, key, value);
  });
}
