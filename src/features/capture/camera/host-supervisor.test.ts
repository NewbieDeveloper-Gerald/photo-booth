import { describe, expect, it, vi } from 'vitest';
import { createCameraHostSupervisor, HOST_MISSING_REASON } from './host-supervisor';
import type { HostTransport } from './host-client';
import { encodeControl } from './host-protocol';

function transport(): HostTransport & { close: (reason?: string) => void; answer: () => void; killed: boolean } {
  let closed: (reason: string) => void = () => undefined;
  let data: (chunk: Uint8Array) => void = () => undefined;
  const value = {
    killed: false,
    write() {},
    onData(listener: (chunk: Uint8Array) => void) { data = listener; },
    onClose(listener: (reason: string) => void) { closed = listener; },
    kill() { value.killed = true; },
    close(reason = 'the camera was unplugged') { closed(reason); },
    /** Answers whatever request id the booth last sent, the way a healthy host would. */
    answer() { data(encodeControl({ id: 1, ok: true, result: null })); },
  };
  return value;
}

function timers(): { run: () => void; count: () => number } {
  const queue: Array<() => void> = [];
  return { run: () => { queue.splice(0).forEach((callback) => callback()); }, count: () => queue.length };
}

describe('camera host supervisor', () => {
  it('says the host is not installed, once, when the program is missing', () => {
    const missing = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    const connect = vi.fn(() => { throw missing; });
    const supervisor = createCameraHostSupervisor({ connect, setTimer: () => 0, clearTimer: () => undefined });
    expect(supervisor.status()).toMatchObject({ available: false, connected: false, reason: HOST_MISSING_REASON });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('reconnects after the host dies and counts a restart until a call is answered', async () => {
    const fakeTimers = timers();
    let current = transport();
    const supervisor = createCameraHostSupervisor({
      connect: () => current,
      setTimer: (callback) => { const handle = fakeTimers.count(); queueMicrotask(() => undefined); pending.push(callback); return handle; },
      clearTimer: () => undefined,
    });
    const pending: Array<() => void> = [];
    expect(supervisor.status().connected).toBe(true);

    current.close('the camera was unplugged');
    expect(supervisor.status()).toMatchObject({ available: true, connected: false, restarts: 1 });
    expect(pending).toHaveLength(1);

    current = transport();
    pending.splice(0).forEach((callback) => callback());
    expect(supervisor.status()).toMatchObject({ connected: true, restarts: 1, reason: null });

    const answered = supervisor.call('list');
    current.answer();
    await answered;
    expect(supervisor.status()).toMatchObject({ connected: true, restarts: 0, reason: null });
  });

  it('gives up after the restart budget and says why', () => {
    const pending: Array<() => void> = [];
    let current = transport();
    const supervisor = createCameraHostSupervisor({
      connect: () => current,
      maxRestarts: 2,
      setTimer: (callback) => { pending.push(callback); return pending.length; },
      clearTimer: () => undefined,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      current.close('EDS SDK fault');
      current = transport();
      pending.splice(0).forEach((callback) => callback());
      if (attempt < 2) expect(supervisor.status().connected).toBe(true);
    }
    expect(supervisor.status()).toMatchObject({ available: false, connected: false });
    expect(supervisor.status().reason).toContain('EDS SDK fault');
  });

  it('refuses a call while the host is down instead of hanging', async () => {
    const supervisor = createCameraHostSupervisor({ connect: () => { throw Object.assign(new Error('boom'), { code: 'ENOENT' }); } });
    await expect(supervisor.call('list')).rejects.toMatchObject({ code: 'not-running' });
  });

  it('kills the host and stops retrying when the booth closes', () => {
    const current = transport();
    const pending: Array<() => void> = [];
    const supervisor = createCameraHostSupervisor({
      connect: () => current,
      setTimer: (callback) => { pending.push(callback); return pending.length; },
      clearTimer: () => undefined,
    });
    supervisor.dispose();
    expect(current.killed).toBe(true);
    expect(supervisor.status().reason).toContain('closed the camera host');
  });
});
