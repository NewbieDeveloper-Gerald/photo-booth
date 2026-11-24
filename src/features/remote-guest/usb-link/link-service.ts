import {
  ADB_LIST_TIMEOUT_MS, ADB_SETUP_TIMEOUT_MS, describeAdbFailure, describeLaunchFailure, deviceGuidance, launchArgs,
  listDevicesArgs,
  parseAdbDevices, parseReverseList, pickUsbDevice, removeReverseArgs, reverseArgs, reverseListArgs,
  usbGuestUrl, USB_SCREEN_PORT, type AdbDevice,
} from './adb';

/** Same shape as the other injected command runners: one call, stdout, stderr, exit code. */
export type AdbRun = (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string; code: number }>;

export type UsbLinkStatus = {
  /** False when adb itself is missing, which is a different problem from "no phone plugged in". */
  toolsAvailable: boolean;
  /** The cable device in use, or null. */
  device: string | null;
  /** True once the port is mapped, which is what makes the localhost URL work. */
  portForwarded: boolean;
  port: number;
  /** The URL to open on the device, or null while no token or device is available. */
  url: string | null;
  /** Operator wording: what to do next, or why the link is not ready. */
  reason: string | null;
  devices: AdbDevice[];
};

export type UsbLinkService = {
  status: () => Promise<UsbLinkStatus>;
  /** Maps the port and opens the screen on the device; returns the state afterwards. */
  connect: (options?: { openOnDevice?: boolean }) => Promise<UsbLinkStatus>;
  disconnect: () => Promise<UsbLinkStatus>;
};

export type UsbLinkOptions = {
  run: AdbRun;
  /** Read lazily so a rotated link is used without restarting anything. */
  getToken: () => string | null;
  port?: number;
};

/**
 * The booth's end of the cable (F22 extension). It answers three questions: is adb here, is a
 * phone on the cable, and is the port mapped. Mapping the port is all that makes the localhost
 * URL work — there is no network involved, so no internet and no router are needed.
 */
export function createUsbLinkService({ run, getToken, port = USB_SCREEN_PORT }: UsbLinkOptions): UsbLinkService {
  const base = (overrides: Partial<UsbLinkStatus>): UsbLinkStatus => ({
    toolsAvailable: true, device: null, portForwarded: false, port, url: null, reason: null, devices: [], ...overrides,
  });

  const readDevices = async (): Promise<{ toolsAvailable: boolean; devices: AdbDevice[]; reason: string | null }> => {
    try {
      const result = await run(listDevicesArgs(), { timeoutMs: ADB_LIST_TIMEOUT_MS });
      const devices = parseAdbDevices(result.stdout);
      if (result.code !== 0 && devices.length === 0) {
        return { toolsAvailable: true, devices, reason: result.stderr.trim() || 'Could not ask the Android tools which phones are connected.' };
      }
      return { toolsAvailable: true, devices, reason: null };
    } catch (error) {
      return { toolsAvailable: false, devices: [], reason: describeAdbFailure(error) };
    }
  };

  const readForwarded = async (): Promise<boolean> => {
    try {
      const result = await run(reverseListArgs(), { timeoutMs: ADB_LIST_TIMEOUT_MS });
      return result.code === 0 && parseReverseList(result.stdout).includes(port);
    } catch { return false; }
  };

  const status = async (): Promise<UsbLinkStatus> => {
    const token = getToken();
    const { toolsAvailable, devices, reason } = await readDevices();
    if (!toolsAvailable) return base({ toolsAvailable: false, devices, reason });
    const device = pickUsbDevice(devices);
    const forward = device ? await readForwarded() : false;
    const url = token ? usbGuestUrl(port, token) : null;
    return base({
      devices,
      device: device?.serial ?? null,
      portForwarded: forward,
      url: device && token ? url : null,
      reason: device
        ? (forward ? null : 'Press Connect to finish the cable link.')
        : deviceGuidance(devices) ?? (devices.length ? 'No cable device was found — this link only uses the USB cable.' : 'Plug the phone or tablet into this computer with a USB cable.'),
    });
  };

  const connect = async ({ openOnDevice = true } = {}): Promise<UsbLinkStatus> => {
    const token = getToken();
    const current = await status();
    if (!current.toolsAvailable) return current;
    if (!current.device) return current;
    if (!token) {
      return base({ ...current, reason: 'Create the tablet link first: the screen needs its token.' });
    }
    try {
      const mapped = await run(reverseArgs(port), { timeoutMs: ADB_SETUP_TIMEOUT_MS });
      if (mapped.code !== 0) {
        return base({ ...current, reason: mapped.stderr.trim() || 'The Android tools refused to map the port.' });
      }
      // -s pins every later command to the cable device, so two phones cannot be confused.
      if (openOnDevice) {
        const url = usbGuestUrl(port, token);
        const opened = await run(['-s', current.device, ...launchArgs(url)], { timeoutMs: ADB_SETUP_TIMEOUT_MS });
        if (opened.code !== 0) {
          const hint = describeLaunchFailure(opened.stderr);
          return base({
            ...current, portForwarded: true, url,
            reason: hint ?? `The port is mapped, but the screen did not open on the phone: ${opened.stderr.trim() || 'open the booth screen app yourself'}.`,
          });
        }
      }
      return await status();
    } catch (error) {
      return base({ ...current, reason: describeAdbFailure(error) });
    }
  };

  const disconnect = async (): Promise<UsbLinkStatus> => {
    const current = await status();
    if (current.device) {
      try { await run(removeReverseArgs(port), { timeoutMs: ADB_SETUP_TIMEOUT_MS }); } catch { /* the cable may already be gone */ }
    }
    return await status();
  };

  return { status, connect, disconnect };
}
