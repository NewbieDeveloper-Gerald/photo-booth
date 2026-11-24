import { REMOTE_GUEST_PORT } from '../domain/remote-port';

/**
 * The USB-only path to a phone or tablet (F22 extension): `adb reverse` maps a port on the device
 * back to the booth, so the screen loads from 127.0.0.1 and never touches the network. The device
 * needs USB debugging allowed once; the booth then does everything else.
 */
export const ADB_PROGRAM = 'adb';
export const USB_SCREEN_PORT = REMOTE_GUEST_PORT;
export const ADB_LIST_TIMEOUT_MS = 8_000;
export const ADB_SETUP_TIMEOUT_MS = 15_000;

export type AdbDeviceState = 'device' | 'unauthorized' | 'offline' | 'no permissions' | 'unknown';

export type AdbDevice = {
  /** The serial adb prints, e.g. R58M12345 or 192.168.1.9:5555 for a wireless device. */
  serial: string;
  state: AdbDeviceState;
  /** True for a device connected by cable, which is the only kind this feature uses. */
  usb: boolean;
};

export function listDevicesArgs(): string[] {
  return ['devices'];
}

/**
 * "adb devices" prints a header then one line per device: serial, a tab, the state. Anything else
 * (the daemon's own notices) is ignored rather than mistaken for a device.
 */
export function parseAdbDevices(stdout: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^List of devices/i.test(line) || line.startsWith('*') || line.startsWith('adb ') || !line.includes('\t')) continue;
    const [serial = '', state = ''] = line.split('\t').map((part) => part.trim());
    if (!serial) continue;
    devices.push({ serial, state: normaliseState(state), usb: !serial.includes(':') });
  }
  return devices;
}

function normaliseState(state: string): AdbDeviceState {
  if (state === 'device') return 'device';
  if (state === 'unauthorized') return 'unauthorized';
  if (state === 'offline') return 'offline';
  if (state.includes('no permissions')) return 'no permissions';
  return 'unknown';
}

/** Maps the device's own port back to the booth's tablet server. */
export function reverseArgs(port: number = USB_SCREEN_PORT): string[] {
  return ['reverse', `tcp:${port}`, `tcp:${port}`];
}

export function removeReverseArgs(port: number = USB_SCREEN_PORT): string[] {
  return ['reverse', '--remove', `tcp:${port}`];
}

export function reverseListArgs(): string[] {
  return ['reverse', '--list'];
}

/** "host-31 tcp:47626 tcp:47626" — only the device-side port matters here. */
export function parseReverseList(stdout: string): number[] {
  const ports: number[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /tcp:(\d{2,5})/.exec(line.trim());
    if (match?.[1]) ports.push(Number(match[1]));
  }
  return ports;
}

/** Opens the booth screen on the device itself, so nobody types a URL on a phone. */
export function launchArgs(url: string): string[] {
  return ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url];
}

/** Over USB the device reaches the booth at its own loopback, not at a LAN address. */
export function usbGuestUrl(port: number = USB_SCREEN_PORT, token: string): string {
  return `http://127.0.0.1:${port}/remote/${token}/`;
}

/** The cable device to use; a wireless device is never picked by this feature. */
export function pickUsbDevice(devices: AdbDevice[]): AdbDevice | null {
  return devices.find((device) => device.usb && device.state === 'device') ?? null;
}

/** What the operator must do when adb sees a device but cannot open it. */
export function deviceGuidance(devices: AdbDevice[]): string | null {
  if (devices.some((device) => device.state === 'unauthorized')) {
    return 'The phone is connected but not trusted yet: unlock it and tap "Allow" on the "Allow USB debugging?" prompt, then press Connect again.';
  }
  if (devices.some((device) => device.state === 'offline')) {
    return 'The phone shows as offline. Unplug and replug the cable, or run "adb kill-server" and press Connect again.';
  }
  if (devices.some((device) => device.state === 'no permissions')) {
    return 'Windows refused access to the phone. Install the phone maker\'s USB driver, then replug the cable.';
  }
  return null;
}

export function describeAdbFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'ENOENT') {
    return `The Android USB tools (${ADB_PROGRAM}) are not installed on this computer. Install Android platform-tools, or connect the tablet over the network instead.`;
  }
  if (code === 'ETIMEDOUT') return 'The Android USB tools stopped answering. Unplug the cable and plug it back in.';
  return 'The Android USB tools failed. Check that the cable is a data cable, not a charge-only one.';
}
