export {};

import type { ActiveEvent, EventSettings } from '../shared/types/event';
import type { SessionRecord, UnfinishedSession } from '../shared/types/session';
import type { UploadQueueSummary } from '../features/sharing/upload-queue/types';
import type { DeletionResult, RetentionStatus } from '../features/retention';
import type { PagePresetId, TemplateDocument, TemplateSummary } from '../features/layouts/domain/template-document';
import type { PrintJob, PrintQueueSummary } from '../features/printing/domain/print-queue-types';

import type { BoothSettingKey } from '../shared/constants/settings-keys';

interface PhotoRecord { photoId: string; width: number; height: number }

declare global {
  interface Window {
    photobooth?: {
      getSetting(key: BoothSettingKey): Promise<string | null>;
      setSetting(key: BoothSettingKey, value: string): Promise<void>;
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
      createGalleryLink(eventId: string): Promise<{ url: string; token: string; passwordProtected: boolean }>;
      setGalleryPassword(eventId: string, password: string | null): Promise<boolean>;
      getUploadQueue(): Promise<UploadQueueSummary>;
      getRetentionStatus(): Promise<RetentionStatus>;
      deleteSession(sessionId: string): Promise<DeletionResult>;
      deleteEvent(eventId: string): Promise<DeletionResult>;
      enqueueSessionUploads(sessionId: string): Promise<number>;
      listPrinters(): Promise<Array<{ name: string; displayName: string; isDefault?: boolean; status?: number }>>;
      enqueuePrintJob(sessionId: string, printerName: string): Promise<PrintJob>;
      reprintJob(jobId: string): Promise<PrintJob>;
      listPrintJobs(eventId?: string): Promise<PrintJob[]>;
      getPrintQueueSummary(eventId?: string): Promise<PrintQueueSummary>;
      setPrintQueuePaused(paused: boolean): Promise<boolean>;
      cancelPrintJob(jobId: string): Promise<PrintJob>;
      exportEvent(eventId: string): Promise<string | null>;
      checkDiskSpace(thresholdGB: number): Promise<boolean>;
      setActiveEventRetakeLimit(limit: number): Promise<ActiveEvent>;
      createSession(layoutId: string): Promise<{ sessionId: string; event: ActiveEvent; shots: number; layoutId: string }>;
      listTemplates(): Promise<TemplateSummary[]>;
      getTemplate(templateId: string): Promise<TemplateDocument>;
      saveTemplate(document: TemplateDocument): Promise<TemplateSummary[]>;
      createTemplate(request: { pageId: PagePresetId; shots: number; name: string }): Promise<TemplateDocument>;
      duplicateTemplate(templateId: string): Promise<TemplateDocument>;
      deleteTemplate(templateId: string): Promise<TemplateSummary[]>;
      renameTemplate(templateId: string, name: string): Promise<TemplateSummary[]>;
      pickLayoutAsset(): Promise<{ assetName: string; bytes: number } | null>;
      readLayoutAsset(assetName: string): Promise<Uint8Array>;
      listUnfinishedSessions(): Promise<UnfinishedSession[]>;
      loadSession(sessionId: string): Promise<SessionRecord>;
      saveOriginalPhoto(sessionId: string, slotNumber: number, bytes: Uint8Array, width: number, height: number): Promise<PhotoRecord>;
      saveRetakeOriginalPhoto(sessionId: string, slotNumber: number, bytes: Uint8Array, width: number, height: number): Promise<PhotoRecord>;
      saveDownloadCopy(photoId: string, bytes: Uint8Array): Promise<void>;
      commitRetake(sessionId: string, slotNumber: number, photoId: string): Promise<void>;
      revertRetake(sessionId: string, slotNumber: number): Promise<void>;
      readOriginalPhoto(photoId: string): Promise<Uint8Array>;
      savePrintSheet(sessionId: string, bytes: Uint8Array, width: number, height: number): Promise<string>;
      saveSessionOutput(sessionId: string, bytes: Uint8Array, width: number, height: number): Promise<string>;
      abandonSession(sessionId: string): Promise<void>;
      discardSession(sessionId: string): Promise<void>;
    };
  }
}
