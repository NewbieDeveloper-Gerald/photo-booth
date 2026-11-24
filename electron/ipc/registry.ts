import type { IpcContext } from './context.js';
import { registerEventHandlers } from './event-handlers.js';
import { registerLayoutHandlers } from './layout-handlers.js';
import { registerPrintingHandlers } from './printing-handlers.js';
import { registerSecurityHandlers } from './security-handlers.js';
import { registerSessionHandlers } from './session-handlers.js';
import { registerSettingsHandlers } from './settings-handlers.js';
import { registerSharingHandlers } from './sharing-handlers.js';
import { registerRetentionHandlers } from './retention-handlers.js';
import { registerStorageHandlers } from './storage-handlers.js';
import { registerRemoteHandlers } from './remote-handlers.js';
import type { RemoteGuestService } from '../remote-service.js';
import type { DslrService } from '../dslr-service.js';
import { registerCameraHandlers } from './camera-handlers.js';

/** One place to see every IPC channel the renderer may call, grouped by feature. */
export function registerIpcHandlers(context: IpcContext, remote: RemoteGuestService | null = null, dslr: DslrService | null = null): void {
  registerSettingsHandlers(context);
  registerSecurityHandlers(context);
  registerEventHandlers(context);
  registerSessionHandlers(context);
  registerLayoutHandlers(context);
  registerSharingHandlers(context);
  registerPrintingHandlers(context);
  if (dslr) registerCameraHandlers(dslr);
  registerRetentionHandlers(context);
  registerStorageHandlers(context);
  registerRemoteHandlers(context, remote);
}
