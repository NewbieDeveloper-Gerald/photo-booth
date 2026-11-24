import { describe, expect, it, vi } from 'vitest';
import { createUsbLinkService, type AdbRun } from './link-service';

const TOKEN = 'abcDEF1234567890_-xyZ';
const URL = `http://127.0.0.1:47626/remote/${TOKEN}/`;

type FakeOptions = {
  devices?: string;
  forwarded?: string;
  reverseCode?: number;
  launchCode?: number;
  reverseStderr?: string;
  failWith?: unknown;
};

function fakeAdb(options: FakeOptions = {}): AdbRun & { calls: string[][] } {
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (options.failWith && args[0] === 'devices') throw options.failWith;
    if (args.includes('devices')) return { stdout: options.devices ?? 'List of devices attached\nR58M12345\tdevice\n', stderr: '', code: 0 };
    if (args.includes('--list')) return { stdout: 'forwarded' in options ? options.forwarded! : '', stderr: '', code: 0 };
    if (args.includes('--remove')) return { stdout: '', stderr: '', code: 0 };
    if (args.includes('reverse') && !args.includes('--list')) return { stdout: '', stderr: options.reverseStderr ?? '', code: options.reverseCode ?? 0 };
    if (args.includes('am')) return { stdout: 'Starting: Intent', stderr: '', code: options.launchCode ?? 0 };
    return { stdout: '', stderr: '', code: 0 };
  }) as unknown as AdbRun;
  (run as unknown as { calls: string[][] }).calls = calls;
  return run as AdbRun & { calls: string[][] };
}

const mapped = 'host-31 tcp:47626 tcp:47626\n';

describe('USB screen link (F22 extension)', () => {
  it('says plainly when no phone is on the cable', async () => {
    const service = createUsbLinkService({ run: fakeAdb({ devices: 'List of devices attached\n' }), getToken: () => TOKEN });
    const status = await service.status();
    expect(status).toMatchObject({ toolsAvailable: true, device: null, portForwarded: false, url: null, port: 47626 });
    expect(status.reason).toContain('Plug the phone or tablet');
  });

  it('points at the allow prompt when the phone is not trusted', async () => {
    const service = createUsbLinkService({ run: fakeAdb({ devices: 'List of devices attached\n0123\tunauthorized\n' }), getToken: () => TOKEN });
    expect((await service.status()).reason).toContain('Allow USB debugging');
  });

  it('reports a missing adb instead of pretending the phone is at fault', async () => {
    const service = createUsbLinkService({
      run: fakeAdb({ failWith: Object.assign(new Error('spawn adb ENOENT'), { code: 'ENOENT' }) }), getToken: () => TOKEN,
    });
    const status = await service.status();
    expect(status.toolsAvailable).toBe(false);
    expect(status.reason).toContain('platform-tools');
  });

  it('maps the port, opens the screen on the device and reports the localhost URL', async () => {
    const run = fakeAdb({ forwarded: mapped });
    const service = createUsbLinkService({ run, getToken: () => TOKEN });
    const status = await service.connect();
    expect(status).toMatchObject({ device: 'R58M12345', portForwarded: true, url: URL, reason: null });
    expect(run.calls).toContainEqual(['reverse', 'tcp:47626', 'tcp:47626']);
    expect(run.calls).toContainEqual(['-s', 'R58M12345', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
      '-n', 'ph.photobooth.screen/ph.photobooth.screen.MainActivity', '-d', URL]);
  });

  it('can map without opening the screen on the device', async () => {
    const run = fakeAdb({ forwarded: mapped });
    const service = createUsbLinkService({ run, getToken: () => TOKEN });
    await service.connect({ openOnDevice: false });
    expect(run.calls.some((args) => args.includes('am'))).toBe(false);
  });

  it('will not map anything before the tablet link exists', async () => {
    const run = fakeAdb({ forwarded: mapped });
    const service = createUsbLinkService({ run, getToken: () => null });
    const status = await service.connect();
    expect(status.url).toBeNull();
    expect(status.reason).toContain('Create the tablet link first');
    expect(run.calls.some((args) => args.includes('reverse') && !args.includes('--list'))).toBe(false);
  });

  it('reports a refusal from adb and a screen that would not open', async () => {
    const refused = createUsbLinkService({ run: fakeAdb({ reverseCode: 1, reverseStderr: 'error: closed' }), getToken: () => TOKEN });
    expect((await refused.connect()).reason).toContain('error: closed');

    const noLaunch = createUsbLinkService({ run: fakeAdb({ forwarded: mapped, launchCode: 1 }), getToken: () => TOKEN });
    const status = await noLaunch.connect();
    expect(status.portForwarded).toBe(true);
    expect(status.url).toBe(URL);
    expect(status.reason).toContain('did not open');
  });

  it('removes the mapping again on request', async () => {
    const run = fakeAdb({ forwarded: mapped });
    const service = createUsbLinkService({ run, getToken: () => TOKEN });
    await service.disconnect();
    expect(run.calls).toContainEqual(['reverse', '--remove', 'tcp:47626']);
  });

  it('does nothing but report when there is no device to unmap', async () => {
    const run = fakeAdb({ devices: 'List of devices attached\n' });
    const service = createUsbLinkService({ run, getToken: () => TOKEN });
    await service.disconnect();
    expect(run.calls.some((args) => args.includes('--remove'))).toBe(false);
  });
});
