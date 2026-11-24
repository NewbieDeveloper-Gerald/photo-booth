import { execFile } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import { createTetherService, type RunCommand, type TetherService } from '../src/features/capture/node.js';
import { GPHOTO_PROGRAM } from './dslr-program.js';

/** Runs one gphoto2 command and returns its stdout bytes, stderr text and exit code. */
const run: RunCommand = (args, { timeoutMs }) => new Promise((resolve, reject) => {
  execFile(GPHOTO_PROGRAM, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error && typeof (error as { code?: unknown }).code === 'string') {
      // A missing helper or a timeout is not a camera answer — pass it on as the failure it is.
      reject(error);
      return;
    }
    resolve({
      stdout: Buffer.from(stdout as string | Buffer),
      stderr: String(stderr ?? ''),
      code: error ? Number((error as { code?: unknown }).code ?? 1) : 0,
    });
  });
});

export type DslrService = TetherService & { dispose: () => void };

/**
 * The tether camera in the main process (F26): gphoto2 is the helper, and live-view frames are
 * pushed to the booth window. Nothing here touches the camera when the operator is using a
 * webcam — the helper only runs while live view or a capture is asked for.
 */
export function startDslrService(getMainWindow: () => BrowserWindow | null): DslrService {
  let lastError: string | null = null;
  const service = createTetherService({
    run,
    onFrame: (jpeg) => {
      lastError = null;
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send('dslr:frame', jpeg);
    },
    onError: (message) => {
      lastError = message;
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send('dslr:error', message);
    },
  });
  return {
    ...service,
    status: async () => {
      const status = await service.status();
      return lastError && status.available ? { ...status, reason: lastError } : status;
    },
    dispose: () => service.stop(),
  };
}
