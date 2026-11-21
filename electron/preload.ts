import { contextBridge, ipcRenderer } from 'electron';

type SettingKey = 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution';

contextBridge.exposeInMainWorld('photobooth', {
  getSetting: (key: SettingKey): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: SettingKey, value: string): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
});
