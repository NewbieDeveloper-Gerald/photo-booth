export {};

import type { ActiveEvent, EventSettings, SessionRecord, UnfinishedSession } from '../storage/sessions';
import type { UploadQueueSummary } from '../cloud/upload-queue';

interface PhotoRecord { photoId: string; width: number; height: number }

declare global {
  interface Window {
    photobooth?: {
      getSetting(key: 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB' | 'selectedPrinterName' | 'downloadBaseUrl' | 'consentText'): Promise<string | null>;
      setSetting(key: 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB' | 'selectedPrinterName' | 'downloadBaseUrl' | 'consentText', value: string): Promise<void>;
      hasAdminPin(): Promise<boolean>;
      verifyAdminPin(pin: string): Promise<boolean>;
      setAdminPin(pin: string, currentPin: string): Promise<void>;
      exitKioskWithPin(pin: string): Promise<boolean>;
      onExitRequested(callback: () => void): () => void;
      getActiveEvent(): Promise<ActiveEvent>;
      listEvents(): Promise<EventSettings[]>;
      saveEvent(input: unknown): Promise<EventSettings>;
      duplicateEvent(eventId: string): Promise<EventSettings>;
      selectActiveEvent(eventId: string): Promise<ActiveEvent>;
      chooseEventLogo(eventId: string): Promise<string | null>;
      getEventLogoDataUrl(eventId: string): Promise<string | null>;
      createShareLink(sessionId: string): Promise<{ url: string; expiresAt: string }>;
      getUploadQueue(): Promise<UploadQueueSummary>;
      enqueueSessionUploads(sessionId: string): Promise<number>;
      listPrinters(): Promise<Array<{ name: string; displayName: string; isDefault?: boolean; status?: number }>>;
      printSessionOutput(sessionId: string, printerName: string): Promise<{ success: boolean; error?: string }>;
      exportEvent(eventId: string): Promise<string | null>;
      checkDiskSpace(thresholdGB: number): Promise<boolean>;
      setActiveEventRetakeLimit(limit: number): Promise<ActiveEvent>;
      createSession(layoutId: string): Promise<{ sessionId: string; event: ActiveEvent; shots: number; layoutId: string }>;
      listUnfinishedSessions(): Promise<UnfinishedSession[]>;
      loadSession(sessionId: string): Promise<SessionRecord>;
      saveOriginalPhoto(sessionId: string, slotNumber: number, bytes: Uint8Array, width: number, height: number): Promise<PhotoRecord>;
      saveRetakeOriginalPhoto(sessionId: string, slotNumber: number, bytes: Uint8Array, width: number, height: number): Promise<PhotoRecord>;
      saveDownloadCopy(photoId: string, bytes: Uint8Array): Promise<void>;
      commitRetake(sessionId: string, slotNumber: number, photoId: string): Promise<void>;
      revertRetake(sessionId: string, slotNumber: number): Promise<void>;
      readOriginalPhoto(photoId: string): Promise<Uint8Array>;
      saveSessionOutput(sessionId: string, bytes: Uint8Array, width: number, height: number): Promise<string>;
      abandonSession(sessionId: string): Promise<void>;
      discardSession(sessionId: string): Promise<void>;
    };
  }
}
