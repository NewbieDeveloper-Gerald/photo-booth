import { createDownloadCopy, type WatermarkSettings } from '../../features/capture';
import { blobToBytes } from '../../shared/dom/blob';

export type DownloadCopyBridge = { saveDownloadCopy(photoId: string, bytes: Uint8Array): Promise<void> };

/** The event's watermark plus the already-loaded event logo, if the operator enabled it. */
export type GuestCopyWatermark = { logo: CanvasImageSource; logoWidth: number; logoHeight: number; settings: WatermarkSettings };

/**
 * Persists the 2048px/q80 guest copy. The full-resolution original is already on disk,
 * so a failure here must never interrupt the session — the share page falls back to it.
 */
export async function saveGuestDownloadCopy(bridge: DownloadCopyBridge, photoId: string, original: Blob, watermark?: GuestCopyWatermark): Promise<boolean> {
  try {
    const copy = await createDownloadCopy(original, watermark);
    await bridge.saveDownloadCopy(photoId, await blobToBytes(copy.blob));
    return true;
  } catch {
    return false;
  }
}
