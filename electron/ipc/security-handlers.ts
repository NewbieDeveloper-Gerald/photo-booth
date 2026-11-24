import { ipcMain } from 'electron';
import { attemptAdminPin, getAdminPinLockout, hasAdminPin, setAdminPin } from '../../src/features/security/node.js';
import type { IpcContext } from './context.js';

/** Turns a refused attempt into the one sentence the prompt shows (F21). */
function describeRefusal(attempt: { reason: 'wrong-pin' | 'locked'; attemptsRemaining: number; retryInMs: number }): string {
  if (attempt.reason === 'locked') return `Too many wrong PINs. Try again in ${Math.ceil(attempt.retryInMs / 1000)} s.`;
  return attempt.attemptsRemaining === 1
    ? 'Current admin PIN is incorrect. One more wrong try locks the PIN for a minute.'
    : `Current admin PIN is incorrect. ${attempt.attemptsRemaining} tries left.`;
}

export function registerSecurityHandlers({ userDataPath, requestAppQuit }: IpcContext): void {
  ipcMain.handle('admin:hasPin', () => hasAdminPin(userDataPath));
  ipcMain.handle('admin:lockout', () => getAdminPinLockout(userDataPath));
  ipcMain.handle('admin:verifyPin', (_event, pin: unknown) => attemptAdminPin(userDataPath, pin));
  ipcMain.handle('admin:setPin', (_event, pin: unknown, currentPin: unknown) => {
    if (hasAdminPin(userDataPath)) {
      const attempt = attemptAdminPin(userDataPath, currentPin);
      if (!attempt.ok) throw new Error(describeRefusal(attempt));
    }
    setAdminPin(userDataPath, pin);
    return getAdminPinLockout(userDataPath);
  });
  ipcMain.handle('kiosk:exitWithPin', (_event, pin: unknown) => {
    const attempt = attemptAdminPin(userDataPath, pin);
    if (!attempt.ok) return attempt;
    requestAppQuit();
    return attempt;
  });
}
