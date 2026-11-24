import { describe, expect, it, vi } from 'vitest';
import { createTetherService } from './tether-service';
import type { RunCommand } from './dslr-types';

const preview = new Uint8Array([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
const still = new Uint8Array([0xff, 0xd8, 0x33, 0x44, 0x55, 0xff, 0xd9]);
const detected = 'Model Port\n-------------------\nCanon EOS 250D    usb:001,004\n';

/** A fake helper: answers auto-detect and hands back JPEGs for preview and capture. */
function fakeRun(overrides: Partial<Record<'detect' | 'preview' | 'capture', unknown>> = {}): RunCommand {
  return vi.fn(async (args: string[]) => {
    const mode = args.includes('--auto-detect') ? 'detect' : args.includes('--capture-preview') ? 'preview' : 'capture';
    const override = overrides[mode];
    if (override instanceof Error) throw override;
    if (typeof override === 'function') return (override as () => unknown)();
    if (override !== undefined) return override;
    if (mode === 'detect') return { stdout: Buffer.from(detected), stderr: '', code: 0 };
    if (mode === 'preview') return { stdout: Buffer.from(preview), stderr: '', code: 0 };
    return { stdout: Buffer.from(still), stderr: '', code: 0 };
  }) as unknown as RunCommand;
}

describe('tether helper service (F26)', () => {
  it('reports the camera it found, with the promised model in the list', async () => {
    const service = createTetherService({ run: fakeRun(), onFrame: () => undefined });
    const status = await service.status();
    expect(status).toMatchObject({ available: true, helper: 'gphoto2', model: 'Canon EOS 250D', cameras: ['Canon EOS 250D'], reason: null });
  });

  it('explains a missing camera, a failed command and a missing helper', async () => {
    const empty = createTetherService({ run: fakeRun({ detect: { stdout: Buffer.from('Model Port\n'), stderr: '', code: 0 } }), onFrame: () => undefined });
    expect(await empty.status()).toMatchObject({ available: false, cameras: [] });
    expect((await empty.status()).reason).toContain('No Canon EOS 250D was found');

    const refused = createTetherService({
      run: fakeRun({ detect: { stdout: Buffer.from(''), stderr: 'Could not claim the USB device', code: 1 } }), onFrame: () => undefined,
    });
    expect((await refused.status()).reason).toContain('is busy');

    const missing = createTetherService({
      run: fakeRun({ detect: Object.assign(new Error('spawn gphoto2 ENOENT'), { code: 'ENOENT' }) }), onFrame: () => undefined,
    });
    expect(await missing.status()).toMatchObject({ available: false, cameras: [] });
    expect((await missing.status()).reason).toContain('is not installed');
  });

  it('refuses to start live view when there is no camera', async () => {
    const service = createTetherService({ run: fakeRun({ detect: { stdout: Buffer.from(''), stderr: 'No camera', code: 1 } }), onFrame: () => undefined });
    await expect(service.start()).rejects.toThrow(/No tether camera was found/);
    expect(service.isStreaming()).toBe(false);
  });

  it('loops preview frames until it is stopped', async () => {
    const timers: Array<() => void> = [];
    const frames: number[][] = [];
    const run = fakeRun();
    const service = createTetherService({
      run, onFrame: (jpeg) => frames.push(Array.from(jpeg)),
      setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => undefined,
    });
    await service.start();
    expect(service.isStreaming()).toBe(true);
    // The first tick is scheduled, not run: one timer per frame keeps the loop honest.
    expect(timers.length).toBe(1);
    timers.shift()!();
    await vi.waitFor(() => expect(frames.length).toBe(1));
    expect(frames[0]).toEqual(Array.from(preview));
    await vi.waitFor(() => expect(timers.length).toBe(1));

    service.stop();
    expect(service.isStreaming()).toBe(false);
    // A timer that fires after the stop must not produce another frame.
    timers.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frames.length).toBe(1);
    expect(timers.length).toBe(0);
  });

  it('gives up on live view after three failed frames instead of hammering a dead port', async () => {
    const timers: Array<() => void> = [];
    const onError = vi.fn();
    let previews = 0;
    const run = fakeRun({
      preview: () => {
        previews += 1;
        return { stdout: Buffer.from(''), stderr: 'Could not claim the USB device', code: 1 };
      },
    });
    const service = createTetherService({
      run, onFrame: () => undefined, onError,
      setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => undefined,
    });
    await service.start();
    timers.shift()!();
    await vi.waitFor(() => expect(timers.length).toBe(1));
    timers.shift()!();
    await vi.waitFor(() => expect(timers.length).toBe(1));
    timers.shift()!();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toContain('Live view stopped');
    expect(previews).toBe(3);
    expect(service.isStreaming()).toBe(false);
  });

  it('survives a single dropped frame', async () => {
    const timers: Array<() => void> = [];
    const frames: number[] = [];
    let previews = 0;
    const service = createTetherService({
      run: fakeRun({
        preview: () => {
          previews += 1;
          return previews === 1
            ? { stdout: Buffer.from(''), stderr: 'timeout', code: 1 }
            : { stdout: Buffer.from(preview), stderr: '', code: 0 };
        },
      }),
      onFrame: (jpeg) => frames.push(jpeg.length),
      setTimer: (callback) => { timers.push(callback); return timers.length; }, clearTimer: () => undefined,
    });
    await service.start();
    timers.shift()!();
    await vi.waitFor(() => expect(timers.length).toBe(1));
    timers.shift()!();
    await vi.waitFor(() => expect(frames.length).toBe(1));
    expect(service.isStreaming()).toBe(true);
  });

  it('takes a full-resolution still, and reports a camera that would not give one', async () => {
    const good = createTetherService({ run: fakeRun(), onFrame: () => undefined });
    expect(Array.from(await good.capture())).toEqual(Array.from(still));

    const bad = createTetherService({
      run: fakeRun({ capture: { stdout: Buffer.from(''), stderr: 'Out of focus', code: 1 } }), onFrame: () => undefined,
    });
    await expect(bad.capture()).rejects.toThrow('The camera reported: Out of focus');
  });
});
