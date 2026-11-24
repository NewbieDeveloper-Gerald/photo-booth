import type { BrowserWindow } from 'electron';
import type { Server } from 'node:http';

/** Everything the IPC modules need from the app shell, so they own no global state. */
export type IpcContext = {
  userDataPath: string;
  getMainWindow: () => BrowserWindow | null;
  getDownloadServer: () => Server | null;
  requestAppQuit: () => void;
};
