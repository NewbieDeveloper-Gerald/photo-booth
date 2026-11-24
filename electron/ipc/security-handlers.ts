import { ipcMain } from 'electron';
import { hasAdminPin, setAdminPin, verifyAdminPin } from '../../src/features/security/index.js';
import type { IpcContext } from './context.js';

export function registerSecurityHandlers({ userDataPath, requestAppQuit }: IpcContext): void {
  ipcMain.handle('admin:hasPin', () => hasAdminPin(userDataPath));
  ipcMain.handle('admin:verifyPin', (_event, pin: unknown) => verifyAdminPin(userDataPath, pin));
  ipcMain.handle('admin:setPin', (_event, pin: unknown, currentPin: unknown) => {
    if (hasAdminPin(userDataPath) && !verifyAdminPin(userDataPath, currentPin)) throw new Error('Current admin PIN is incorrect');
    setAdminPin(userDataPath, pin);
  });
  ipcMain.handle('kiosk:exitWithPin', (_event, pin: unknown) => {
    if (!verifyAdminPin(userDataPath, pin)) return false;
    requestAppQuit();
    return true;
  });
}
