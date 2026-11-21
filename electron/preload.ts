import { contextBridge, ipcRenderer } from 'electron';

type SettingKey = 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB' | 'selectedPrinterName' | 'downloadBaseUrl' | 'consentText';
type PhotoBytes = Uint8Array;

contextBridge.exposeInMainWorld('photobooth', {
  getSetting: (key: SettingKey): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: SettingKey, value: string): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
  hasAdminPin: (): Promise<boolean> => ipcRenderer.invoke('admin:hasPin'),
  verifyAdminPin: (pin: string): Promise<boolean> => ipcRenderer.invoke('admin:verifyPin', pin),
  setAdminPin: (pin: string, currentPin: string): Promise<void> => ipcRenderer.invoke('admin:setPin', pin, currentPin),
  exitKioskWithPin: (pin: string): Promise<boolean> => ipcRenderer.invoke('kiosk:exitWithPin', pin),
  onExitRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('kiosk:exitRequested', listener);
    return () => ipcRenderer.removeListener('kiosk:exitRequested', listener);
  },
  getActiveEvent: () => ipcRenderer.invoke('session:getActiveEvent'),
  listEvents: () => ipcRenderer.invoke('event:list'),
  saveEvent: (input: unknown) => ipcRenderer.invoke('event:save', input),
  duplicateEvent: (eventId: string) => ipcRenderer.invoke('event:duplicate', eventId),
  selectActiveEvent: (eventId: string) => ipcRenderer.invoke('event:activate', eventId),
  chooseEventLogo: (eventId: string): Promise<string | null> => ipcRenderer.invoke('event:chooseLogo', eventId),
  getEventLogoDataUrl: (eventId: string): Promise<string | null> => ipcRenderer.invoke('event:logoData', eventId),
  createShareLink: (sessionId: string): Promise<{ url: string; expiresAt: string }> => ipcRenderer.invoke('download:createShareLink', sessionId),
  getUploadQueue: () => ipcRenderer.invoke('uploadQueue:list'),
  enqueueSessionUploads: (sessionId: string): Promise<number> => ipcRenderer.invoke('uploadQueue:enqueueSession', sessionId),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  printSessionOutput: (sessionId: string, printerName: string) => ipcRenderer.invoke('printer:printOutput', sessionId, printerName),
  exportEvent: (eventId: string): Promise<string | null> => ipcRenderer.invoke('session:exportEvent', eventId),
  checkDiskSpace: (thresholdGB: number): Promise<boolean> => ipcRenderer.invoke('session:checkDiskSpace', thresholdGB),
  setActiveEventRetakeLimit: (limit: number) => ipcRenderer.invoke('session:setRetakeLimit', limit),
  createSession: (layoutId: string) => ipcRenderer.invoke('session:create', layoutId),
  listUnfinishedSessions: () => ipcRenderer.invoke('session:listUnfinished'),
  loadSession: (sessionId: string) => ipcRenderer.invoke('session:load', sessionId),
  saveOriginalPhoto: (sessionId: string, slotNumber: number, bytes: PhotoBytes, width: number, height: number) =>
    ipcRenderer.invoke('session:saveOriginal', sessionId, slotNumber, bytes, width, height),
  saveRetakeOriginalPhoto: (sessionId: string, slotNumber: number, bytes: PhotoBytes, width: number, height: number) =>
    ipcRenderer.invoke('session:saveRetakeOriginal', sessionId, slotNumber, bytes, width, height),
  saveDownloadCopy: (photoId: string, bytes: PhotoBytes) => ipcRenderer.invoke('session:saveDownload', photoId, bytes),
  commitRetake: (sessionId: string, slotNumber: number, photoId: string) => ipcRenderer.invoke('session:commitRetake', sessionId, slotNumber, photoId),
  revertRetake: (sessionId: string, slotNumber: number) => ipcRenderer.invoke('session:revertRetake', sessionId, slotNumber),

  readOriginalPhoto: (photoId: string): Promise<PhotoBytes> => ipcRenderer.invoke('session:readOriginal', photoId),
  saveSessionOutput: (sessionId: string, bytes: PhotoBytes, width: number, height: number): Promise<string> =>
    ipcRenderer.invoke('session:saveOutput', sessionId, bytes, width, height),
  abandonSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:abandon', sessionId),
  discardSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:discard', sessionId),
});
