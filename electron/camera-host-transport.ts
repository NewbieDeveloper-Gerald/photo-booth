import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { HostTransport } from '../src/features/capture/camera/host-client.js';

/**
 * The host's stdio as a transport. The child is killed hard when the booth is done with it: a
 * camera session left open on the USB port is what makes the *next* app that touches the camera
 * fail with "device busy", which is the least useful error an operator can be given.
 */
export function spawnHostTransport(program: string, args: string[] = []): HostTransport {
  const child: ChildProcessWithoutNullStreams = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let onData: (chunk: Uint8Array) => void = () => undefined;
  let onClose: (reason: string) => void = () => undefined;
  let closed = false;

  const finish = (reason: string): void => {
    if (closed) return;
    closed = true;
    onClose(reason);
  };

  child.stdout.on('data', (chunk: Buffer) => onData(new Uint8Array(chunk)));
  // stderr is the host's own logging; it belongs in the booth's terminal, not in the frame stream.
  child.stderr.on('data', (chunk: Buffer) => console.warn(`camera host: ${chunk.toString().trim()}`));
  child.on('error', (error) => finish(error.message));
  child.on('exit', (code, signal) => finish(signal ? `The camera host was stopped (${signal}).` : `The camera host exited with code ${code}.`));

  return {
    write(bytes: Uint8Array) {
      if (closed) return;
      child.stdin.write(Buffer.from(bytes));
    },
    onData(listener) { onData = listener; },
    onClose(listener) { onClose = listener; },
    kill() {
      closed = true;
      if (!child.killed) child.kill();
    },
  };
}
