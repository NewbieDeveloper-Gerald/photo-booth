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

/** One place to see every IPC channel the renderer may call, grouped by feature. */
export function registerIpcHandlers(context: IpcContext): void {
  registerSettingsHandlers(context);
  registerSecurityHandlers(context);
  registerEventHandlers(context);
  registerSessionHandlers(context);
  registerLayoutHandlers(context);
  registerSharingHandlers(context);
  registerPrintingHandlers(context);
  registerRetentionHandlers(context);
  registerStorageHandlers(context);
}
