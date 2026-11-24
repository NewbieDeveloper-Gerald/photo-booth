import { BrowserWindow, app } from 'electron';
import path from 'node:path';

const WINDOW_BOUNDS = { width: 1280, height: 800, minWidth: 900, minHeight: 600 };
const BACKGROUND_COLOR = '#111827';

export type BoothWindowController = {
  create: () => BrowserWindow;
  /** Lets the next close request through — used only after a correct admin PIN. */
  permitClose: () => void;
};

/** The kiosk window: full screen, and closing it is only possible through the exit prompt. */
export function createBoothWindowController(): BoothWindowController {
  let permitClose = false;
  const create = (): BrowserWindow => {
    const window = new BrowserWindow({
      ...WINDOW_BOUNDS,
      backgroundColor: BACKGROUND_COLOR,
      kiosk: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, '..', 'preload.js'),
      },
    });
    window.on('close', (event) => {
      if (permitClose) return;
      event.preventDefault();
      window.webContents.send('kiosk:exitRequested');
    });
    if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
    else void window.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
    return window;
  };
  return { create, permitClose: () => { permitClose = true; } };
}
