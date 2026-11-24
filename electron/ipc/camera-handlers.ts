import { ipcMain } from 'electron';
import type { DslrService } from '../dslr-service.js';

/**
 * The tether camera's channels (F26). Live-view frames are pushed on `dslr:frame`; the renderer
 * never runs the helper itself, and can stop live view at any time.
 */
export function registerCameraHandlers(dslr: DslrService): void {
  ipcMain.handle('dslr:status', () => dslr.status());
  ipcMain.handle('dslr:start', () => dslr.start().then(() => dslr.status()));
  ipcMain.handle('dslr:stop', () => { dslr.stop(); });
  ipcMain.handle('dslr:capture', () => dslr.capture());
}
