import { ipcMain } from 'electron';
import type { IpcContext } from './context.js';
import type { RemoteGuestService } from '../remote-service.js';
import type { UsbLinkService } from '../../src/features/remote-guest/node.js';
import type { RemoteView } from '../../src/shared/types/remote-guest.js';

const STAGES = ['off', 'busy', 'ready', 'consent', 'capturing', 'review', 'finished', 'paused'];
/** A view is a few hundred bytes; anything near this is a bug, not a state. */
const MAX_VIEW_BYTES = 32_768;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

function isRemoteView(value: unknown): value is RemoteView {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  return typeof view.stage === 'string' && STAGES.includes(view.stage) && Array.isArray(view.slots);
}

/**
 * The renderer owns the booth state and the camera, so it publishes the tablet view and the
 * preview frames; this module just carries them to the server and the tablet's commands back.
 */
export function registerRemoteHandlers({ getMainWindow }: IpcContext, remote: RemoteGuestService | null, usb: UsbLinkService | null = null): void {
  // The USB cable link (F22 extension): adb maps a port, the device opens 127.0.0.1 — no network.
  ipcMain.handle('usbLink:status', () => usb?.status() ?? null);
  ipcMain.handle('usbLink:connect', () => {
    if (!usb) throw new Error('The USB link needs the desktop app.');
    if (!remote?.info().enabled) throw new Error('Switch on the tablet screen first: the cable link serves that screen.');
    return usb.connect();
  });
  ipcMain.handle('usbLink:disconnect', () => usb?.disconnect() ?? null);
  ipcMain.handle('remote:info', () => remote?.info() ?? { enabled: false, url: null, clients: 0 });
  ipcMain.handle('remote:setEnabled', (_event, enabled: unknown) => {
    if (!remote) throw new Error('The tablet screen needs the desktop app');
    if (typeof enabled !== 'boolean') throw new Error('Tablet screen state must be on or off');
    return remote.setEnabled(enabled);
  });
  ipcMain.handle('remote:rotateLink', async () => {
    if (!remote) throw new Error('The tablet screen needs the desktop app');
    return remote.rotateLink();
  });
  ipcMain.handle('remote:publish', (_event, view: unknown) => {
    if (!remote || !isRemoteView(view)) return;
    if (Buffer.byteLength(JSON.stringify(view), 'utf8') > MAX_VIEW_BYTES) return;
    remote.hub.publish(view);
  });
  // Frames are JPEGs from the booth's own preview canvas; a tablet that stops watching simply
  // stops receiving them, and a failed frame never blocks the next one.
  ipcMain.handle('remote:frame', (_event, bytes: unknown) => {
    if (!remote) return;
    const frame = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
    if (!frame || frame.length === 0 || frame.length > MAX_FRAME_BYTES) return;
    remote.hub.pushFrame(frame);
  });
  remote?.hub.onCommand((command) => {
    getMainWindow()?.webContents.send('remote:command', command);
  });
}
