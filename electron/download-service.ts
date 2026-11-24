import type { Server } from 'node:http';
import { createDownloadServer } from '../src/features/sharing/node.js';
import { getConfiguredStoragePaths } from '../src/features/storage/node.js';

/** The share server is optional: the booth keeps working (without QR downloads) if the port is taken. */
export async function startDownloadServer(userDataPath: string): Promise<Server | null> {
  try {
    const { photosDirectory } = getConfiguredStoragePaths(userDataPath);
    return await createDownloadServer(userDataPath, photosDirectory);
  } catch {
    console.warn('Private download service could not start; QR downloads are unavailable until the app is restarted.');
    return null;
  }
}
