import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { isBlockedKioskShortcut } from '../../src/features/security/domain/kiosk-keys.js';

const WINDOW_BOUNDS = { width: 1280, height: 800, minWidth: 900, minHeight: 600 };
const BACKGROUND_COLOR = '#111827';

export type BoothWindowController = {
  create: () => BrowserWindow;
  /** Lets the next close request through — used only after a correct admin PIN. */
  permitClose: () => void;
};

/**
 * The kiosk window: full screen, and leaving it is only possible through the exit prompt.
 * Hardening (F21): DevTools, reload and in-app navigation are closed off once the app is
 * packaged, so a guest with a keyboard or a touch screen cannot reach a browser window. The
 * packaged app keeps DevTools off entirely; `npm run dev` still allows them for development.
 */
export function createBoothWindowController(): BoothWindowController {
  let permitClose = false;
  const isPackaged = app.isPackaged;
  const create = (): BrowserWindow => {
    const window = new BrowserWindow({
      ...WINDOW_BOUNDS,
      backgroundColor: BACKGROUND_COLOR,
      kiosk: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !isPackaged,
        spellcheck: false,
        preload: path.join(__dirname, '..', 'preload.js'),
      },
    });
    window.on('close', (event) => {
      if (permitClose) return;
      event.preventDefault();
      window.webContents.send('kiosk:exitRequested');
    });
    // No new windows, no navigating away from the booth, no webviews: the booth is the app.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => { if (isPackaged) event.preventDefault(); });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    // Swallow the browser shortcuts a guest could press, while leaving the operator hotkeys
    // (which all need Shift) alone.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (!isBlockedKioskShortcut({ key: input.key, control: input.control, shift: input.shift, alt: input.alt, meta: input.meta })) return;
      if (isPackaged) event.preventDefault();
    });
    // A right-click inspect menu is another way out of a kiosk.
    window.webContents.on('context-menu', (event) => { if (isPackaged) event.preventDefault(); });
    if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
    else void window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
    return window;
  };
  return { create, permitClose: () => { permitClose = true; } };
}
