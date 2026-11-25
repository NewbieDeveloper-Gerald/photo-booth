import { contextBridge, ipcRenderer } from 'electron';
import type { AdminPinAttempt, AdminPinLockout } from '../src/shared/types/admin-pin';
import type { RemoteCommand, RemoteServerInfo, RemoteView } from '../src/shared/types/remote-guest';
import type { TetherStatus } from '../src/features/capture/dslr/dslr-types';
import type { CameraCapabilities, CameraSettingRole, CameraSettings, CameraSettingsPair } from '../src/features/capture/camera/camera-settings';
import type { CameraHostStatus } from '../src/features/capture/camera/host-protocol';
import type { CameraInfo } from '../src/features/capture/devices/camera';
import type { LinkChannel, SendLinkOutcome } from '../src/features/sharing/link-delivery/types';
import type { UsbLinkStatus } from '../src/features/remote-guest/usb-link/link-service';

import type { BoothSettingKey } from '../src/shared/constants/settings-keys.js';

type SettingKey = BoothSettingKey;
type PhotoBytes = Uint8Array;

contextBridge.exposeInMainWorld('photobooth', {
  getSetting: (key: SettingKey): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: SettingKey, value: string): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
  hasAdminPin: (): Promise<boolean> => ipcRenderer.invoke('admin:hasPin'),
  verifyAdminPin: (pin: string): Promise<AdminPinAttempt> => ipcRenderer.invoke('admin:verifyPin', pin),
  getAdminPinLockout: (): Promise<AdminPinLockout> => ipcRenderer.invoke('admin:lockout'),
  setAdminPin: (pin: string, currentPin: string): Promise<AdminPinLockout> => ipcRenderer.invoke('admin:setPin', pin, currentPin),
  exitKioskWithPin: (pin: string): Promise<AdminPinAttempt> => ipcRenderer.invoke('kiosk:exitWithPin', pin),
  // Tablet guest screen (F22): the booth publishes its state and preview frames, the tablet's
  // commands come back as events.
  getRemoteInfo: (): Promise<RemoteServerInfo> => ipcRenderer.invoke('remote:info'),
  setRemoteEnabled: (enabled: boolean): Promise<RemoteServerInfo> => ipcRenderer.invoke('remote:setEnabled', enabled),
  rotateRemoteLink: (): Promise<RemoteServerInfo> => ipcRenderer.invoke('remote:rotateLink'),
  publishRemoteView: (view: RemoteView): Promise<void> => ipcRenderer.invoke('remote:publish', view),
  sendRemoteFrame: (jpeg: Uint8Array): Promise<void> => ipcRenderer.invoke('remote:frame', jpeg),
  // The USB cable link (F22 extension): map the port with adb, then the device opens 127.0.0.1.
  getUsbLinkStatus: (): Promise<UsbLinkStatus | null> => ipcRenderer.invoke('usbLink:status'),
  connectUsbLink: (): Promise<UsbLinkStatus | null> => ipcRenderer.invoke('usbLink:connect'),
  disconnectUsbLink: (): Promise<UsbLinkStatus | null> => ipcRenderer.invoke('usbLink:disconnect'),
  onRemoteCommand: (listener: (command: RemoteCommand) => void): (() => void) => {
    const handler = (_event: unknown, command: RemoteCommand): void => listener(command);
    ipcRenderer.on('remote:command', handler);
    return () => { ipcRenderer.removeListener('remote:command', handler); };
  },
  onRemoteStatus: (listener: (info: RemoteServerInfo) => void): (() => void) => {
    const handler = (_event: unknown, info: RemoteServerInfo): void => listener(info);
    ipcRenderer.on('remote:status', handler);
    return () => { ipcRenderer.removeListener('remote:status', handler); };
  },
  // Tether camera (F26): the helper runs in the main process; frames arrive as events.
  dslrStatus: (): Promise<TetherStatus> => ipcRenderer.invoke('dslr:status'),
  startDslrLiveView: (): Promise<TetherStatus> => ipcRenderer.invoke('dslr:start'),
  stopDslrLiveView: (): Promise<void> => ipcRenderer.invoke('dslr:stop'),
  captureDslrPhoto: (): Promise<Uint8Array> => ipcRenderer.invoke('dslr:capture'),
  onDslrFrame: (listener: (jpeg: Uint8Array) => void): (() => void) => {
    const handler = (_event: unknown, jpeg: Uint8Array): void => listener(jpeg);
    ipcRenderer.on('dslr:frame', handler);
    return () => { ipcRenderer.removeListener('dslr:frame', handler); };
  },
  // Canon EDSDK camera (Phase 1): the host process runs in the main process, and live-view frames
  // arrive as events. The renderer never spawns anything and never reads a file path.
  cameraHostStatus: (): Promise<CameraHostStatus> => ipcRenderer.invoke('camera:status'),
  cameraList: (): Promise<CameraInfo[]> => ipcRenderer.invoke('camera:list'),
  cameraCapabilities: (deviceId: string): Promise<CameraCapabilities> => ipcRenderer.invoke('camera:capabilities', deviceId),
  cameraSettings: (deviceId: string): Promise<CameraSettingsPair> => ipcRenderer.invoke('camera:settings', deviceId),
  setCameraSettings: (deviceId: string, role: CameraSettingRole, settings: CameraSettings): Promise<void> =>
    ipcRenderer.invoke('camera:setSettings', deviceId, role, settings),
  startCameraLiveView: (deviceId: string): Promise<void> => ipcRenderer.invoke('camera:liveViewStart', deviceId),
  stopCameraLiveView: (): Promise<void> => ipcRenderer.invoke('camera:liveViewStop'),
  focusCamera: (deviceId: string): Promise<void> => ipcRenderer.invoke('camera:focus', deviceId),
  cameraShutter: (deviceId: string): Promise<void> => ipcRenderer.invoke('camera:shutter', deviceId),
  downloadCameraPhoto: (deviceId: string): Promise<Uint8Array> => ipcRenderer.invoke('camera:download', deviceId),
  onCameraFrame: (listener: (jpeg: Uint8Array) => void): (() => void) => {
    const handler = (_event: unknown, jpeg: Uint8Array): void => listener(jpeg);
    ipcRenderer.on('camera:frame', handler);
    return () => { ipcRenderer.removeListener('camera:frame', handler); };
  },
  onCameraError: (listener: (message: string) => void): (() => void) => {
    const handler = (_event: unknown, message: string): void => listener(message);
    ipcRenderer.on('camera:error', handler);
    return () => { ipcRenderer.removeListener('camera:error', handler); };
  },
  onCameraHostStatus: (listener: (status: CameraHostStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: CameraHostStatus): void => listener(status);
    ipcRenderer.on('camera:status', handler);
    return () => { ipcRenderer.removeListener('camera:status', handler); };
  },
  onDslrError: (listener: (message: string) => void): (() => void) => {
    const handler = (_event: unknown, message: string): void => listener(message);
    ipcRenderer.on('dslr:error', handler);
    return () => { ipcRenderer.removeListener('dslr:error', handler); };
  },
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
  // Link delivery (F28): the address is passed through and never kept by the booth.
  sendSessionLink: (sessionId: string, channel: LinkChannel, target: string): Promise<SendLinkOutcome> =>
    ipcRenderer.invoke('share:sendLink', sessionId, channel, target),
  getUploadQueue: () => ipcRenderer.invoke('uploadQueue:list'),
  getRetentionStatus: () => ipcRenderer.invoke('retention:status'),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('retention:deleteSession', sessionId),
  deleteEvent: (eventId: string) => ipcRenderer.invoke('retention:deleteEvent', eventId),
  enqueueSessionUploads: (sessionId: string): Promise<number> => ipcRenderer.invoke('uploadQueue:enqueueSession', sessionId),
  skipPendingUploads: (sessionId?: string): Promise<number> => ipcRenderer.invoke('uploadQueue:skipPending', sessionId),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  enqueuePrintJob: (sessionId: string, printerName: string) => ipcRenderer.invoke('print:enqueue', sessionId, printerName),
  reprintJob: (jobId: string) => ipcRenderer.invoke('print:reprint', jobId),
  listPrintJobs: (eventId?: string) => ipcRenderer.invoke('print:list', eventId),
  getPrintQueueSummary: (eventId?: string) => ipcRenderer.invoke('print:summary', eventId),
  setPrintQueuePaused: (paused: boolean) => ipcRenderer.invoke('print:pause', paused),
  cancelPrintJob: (jobId: string) => ipcRenderer.invoke('print:cancel', jobId),
  listPrinterProfiles: () => ipcRenderer.invoke('print:profiles'),
  savePrinterProfile: (draft: unknown) => ipcRenderer.invoke('print:profiles:save', draft),
  deletePrinterProfile: (profileId: string) => ipcRenderer.invoke('print:profiles:delete', profileId),
  markPrinterProfileChecked: (profileId: string, checked: boolean) => ipcRenderer.invoke('print:profiles:checked', profileId, checked),
  printProfileTestSheet: (profileId: string, printerName?: string) => ipcRenderer.invoke('print:profiles:test', profileId, printerName ?? ''),
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
  saveSessionAnimation: (sessionId: string, bytes: PhotoBytes, kind: 'gif' | 'boomerang'): Promise<string> =>
    ipcRenderer.invoke('session:saveAnimation', sessionId, bytes, kind),
  saveSessionOutput: (sessionId: string, bytes: PhotoBytes, width: number, height: number): Promise<string> =>
    ipcRenderer.invoke('session:saveOutput', sessionId, bytes, width, height),
  abandonSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:abandon', sessionId),
  discardSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:discard', sessionId),
});
