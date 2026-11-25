import { ipcMain } from 'electron';
import type { CameraService } from '../camera-service.js';

/**
 * The camera host channels (Phase 1). Live-view frames are pushed on `camera:frame`; the renderer
 * never spawns a process and never sees a path outside the booth's own temp folder.
 */
export function registerCameraHostHandlers(camera: CameraService): void {
  ipcMain.handle('camera:status', () => camera.status());
  ipcMain.handle('camera:list', () => camera.list());
  ipcMain.handle('camera:capabilities', (_event, deviceId: unknown) => camera.capabilities(String(deviceId)));
  ipcMain.handle('camera:settings', (_event, deviceId: unknown) => camera.settings(String(deviceId)));
  ipcMain.handle('camera:setSettings', (_event, deviceId: unknown, role: unknown, settings: unknown) =>
    camera.setSettings(String(deviceId), role === 'capture' ? 'capture' : 'liveView', (settings ?? {}) as Record<string, string>));
  ipcMain.handle('camera:liveViewStart', (_event, deviceId: unknown) => camera.startLiveView(String(deviceId)));
  ipcMain.handle('camera:liveViewStop', () => camera.stopLiveView());
  ipcMain.handle('camera:focus', (_event, deviceId: unknown) => camera.focus(String(deviceId)));
  ipcMain.handle('camera:shutter', (_event, deviceId: unknown) => camera.shutter(String(deviceId)));
  ipcMain.handle('camera:download', (_event, deviceId: unknown) => camera.download(String(deviceId)));
}
