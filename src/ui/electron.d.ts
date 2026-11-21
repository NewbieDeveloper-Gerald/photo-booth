export {};

import type { ActiveEvent, SessionRecord, UnfinishedSession } from '../storage/sessions';

interface PhotoRecord { photoId: string; width: number; height: number }

declare global {
  interface Window {
    photobooth?: {
      getSetting(key: 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB'): Promise<string | null>;
      setSetting(key: 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB', value: string): Promise<void>;
      getActiveEvent(): Promise<ActiveEvent>;
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
