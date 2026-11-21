import { contextBridge, ipcRenderer } from 'electron';

type SettingKey = 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution';
type PhotoBytes = Uint8Array;

contextBridge.exposeInMainWorld('photobooth', {
  getSetting: (key: SettingKey): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: SettingKey, value: string): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
  getActiveEvent: () => ipcRenderer.invoke('session:getActiveEvent'),
  createSession: () => ipcRenderer.invoke('session:create'),
  listUnfinishedSessions: () => ipcRenderer.invoke('session:listUnfinished'),
  loadSession: (sessionId: string) => ipcRenderer.invoke('session:load', sessionId),
  saveOriginalPhoto: (sessionId: string, slotNumber: number, bytes: PhotoBytes, width: number, height: number) =>
    ipcRenderer.invoke('session:saveOriginal', sessionId, slotNumber, bytes, width, height),
  saveDownloadCopy: (photoId: string, bytes: PhotoBytes) => ipcRenderer.invoke('session:saveDownload', photoId, bytes),
  readOriginalPhoto: (photoId: string): Promise<PhotoBytes> => ipcRenderer.invoke('session:readOriginal', photoId),
  abandonSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:abandon', sessionId),
  discardSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:discard', sessionId),
});
