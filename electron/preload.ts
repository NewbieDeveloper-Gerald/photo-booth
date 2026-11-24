import { contextBridge, ipcRenderer } from 'electron';

import type { BoothSettingKey } from '../src/shared/constants/settings-keys.js';

type SettingKey = BoothSettingKey;
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
  listAttractMedia: (eventId: string) => ipcRenderer.invoke('attract:list', eventId),
  addAttractMedia: (eventId: string) => ipcRenderer.invoke('attract:add', eventId),
  removeAttractMedia: (eventId: string, mediaId: string) => ipcRenderer.invoke('attract:remove', eventId, mediaId),
  readAttractMedia: (eventId: string, mediaId: string): Promise<{ kind: 'image' | 'video'; mimeType: string; bytes: PhotoBytes }> => ipcRenderer.invoke('attract:read', eventId, mediaId),
  createGalleryLink: (eventId: string): Promise<{ url: string; token: string; passwordProtected: boolean }> => ipcRenderer.invoke('gallery:createLink', eventId),
  setGalleryPassword: (eventId: string, password: string | null): Promise<boolean> => ipcRenderer.invoke('gallery:setPassword', eventId, password),
  createShareLink: (sessionId: string): Promise<{ url: string; expiresAt: string }> => ipcRenderer.invoke('download:createShareLink', sessionId),
  getUploadQueue: () => ipcRenderer.invoke('uploadQueue:list'),
  getRetentionStatus: () => ipcRenderer.invoke('retention:status'),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('retention:deleteSession', sessionId),
  deleteEvent: (eventId: string) => ipcRenderer.invoke('retention:deleteEvent', eventId),
  enqueueSessionUploads: (sessionId: string): Promise<number> => ipcRenderer.invoke('uploadQueue:enqueueSession', sessionId),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  enqueuePrintJob: (sessionId: string, printerName: string) => ipcRenderer.invoke('print:enqueue', sessionId, printerName),
  reprintJob: (jobId: string) => ipcRenderer.invoke('print:reprint', jobId),
  listPrintJobs: (eventId?: string) => ipcRenderer.invoke('print:list', eventId),
  getPrintQueueSummary: (eventId?: string) => ipcRenderer.invoke('print:summary', eventId),
  setPrintQueuePaused: (paused: boolean) => ipcRenderer.invoke('print:pause', paused),
  cancelPrintJob: (jobId: string) => ipcRenderer.invoke('print:cancel', jobId),
  exportEvent: (eventId: string): Promise<string | null> => ipcRenderer.invoke('session:exportEvent', eventId),
  checkDiskSpace: (thresholdGB: number): Promise<boolean> => ipcRenderer.invoke('session:checkDiskSpace', thresholdGB),
  setActiveEventRetakeLimit: (limit: number) => ipcRenderer.invoke('session:setRetakeLimit', limit),
  createSession: (layoutId: string, filterId?: string) => ipcRenderer.invoke('session:create', layoutId, filterId),
  listTemplates: () => ipcRenderer.invoke('layouts:list'),
  getTemplate: (templateId: string) => ipcRenderer.invoke('layouts:get', templateId),
  saveTemplate: (document: unknown) => ipcRenderer.invoke('layouts:save', document),
  createTemplate: (request: { pageId: string; shots: number; name: string }) => ipcRenderer.invoke('layouts:create', request),
  duplicateTemplate: (templateId: string) => ipcRenderer.invoke('layouts:duplicate', templateId),
  deleteTemplate: (templateId: string) => ipcRenderer.invoke('layouts:delete', templateId),
  renameTemplate: (templateId: string, name: string) => ipcRenderer.invoke('layouts:rename', templateId, name),
  pickLayoutAsset: () => ipcRenderer.invoke('layouts:pickAsset'),
  readLayoutAsset: (assetName: string) => ipcRenderer.invoke('layouts:readAsset', assetName),
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
  savePrintSheet: (sessionId: string, bytes: PhotoBytes, width: number, height: number): Promise<string> =>
    ipcRenderer.invoke('session:savePrintSheet', sessionId, bytes, width, height),
  saveSessionOutput: (sessionId: string, bytes: PhotoBytes, width: number, height: number): Promise<string> =>
    ipcRenderer.invoke('session:saveOutput', sessionId, bytes, width, height),
  abandonSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:abandon', sessionId),
  discardSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:discard', sessionId),
});
