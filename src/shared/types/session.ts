export type UnfinishedSession = { id: string; createdAt: string; capturedSlots: number; totalSlots: number; pendingRetakes: number };

export type SessionSlot = { slotNumber: number; status: 'empty' | 'captured'; photoId: string | null; previousPhotoId: string | null; pendingPhotoId: string | null; downloadReady: boolean; hasPrevious: boolean; pendingDownloadReady: boolean; width: number | null; height: number | null };

export type SessionRecord = { id: string; eventId: string; eventName: string; layoutId: string; status: string; retakesUsed: number; retakeLimit: number; slots: SessionSlot[] };
