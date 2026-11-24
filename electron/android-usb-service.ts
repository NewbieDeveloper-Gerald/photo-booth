import { execFile } from 'node:child_process';
import { createUsbLinkService, type AdbRun, type UsbLinkService } from '../src/features/remote-guest/node.js';
import { ADB_PROGRAM } from '../src/features/remote-guest/usb-link/adb.js';

/** Runs one adb command. A missing binary or a timeout is passed on as a failure, not a device answer. */
const run: AdbRun = (args, { timeoutMs }) => new Promise((resolve, reject) => {
  execFile(ADB_PROGRAM, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && typeof (error as { code?: unknown }).code === 'string') { reject(error); return; }
    resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: error ? Number((error as { code?: unknown }).code ?? 1) : 0 });
  });
});

/**
 * The cable link to a phone or tablet (F22 extension). It only ever maps a port with adb, so the
 * screen works with no internet and no router — just a USB cable and USB debugging allowed once.
 */
export function startAndroidUsbService(getToken: () => string | null): UsbLinkService {
  return createUsbLinkService({ run, getToken });
}
