import { createDownloadCopy } from '../../features/capture';
import { blobToBytes } from '../../shared/dom/blob';

export type DownloadCopyBridge = { saveDownloadCopy(photoId: string, bytes: Uint8Array): Promise<void> };

/**
 * Persists the 2048px/q80 guest copy. The full-resolution original is already on disk,
 * so a failure here must never interrupt the session — the share page falls back to it.
 */
export async function saveGuestDownloadCopy(bridge: DownloadCopyBridge, photoId: string, original: Blob): Promise<boolean> {
  try {
    const copy = await createDownloadCopy(original);
    await bridge.saveDownloadCopy(photoId, await blobToBytes(copy.blob));
    return true;
  } catch {
    return false;
  }
}
