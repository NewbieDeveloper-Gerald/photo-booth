import net from 'node:net';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteServer, type RemoteServer } from './remote-server';
import { buildRemoteView } from '../domain/remote-view';
import type { RemoteCommand, RemoteView } from '../../../shared/types/remote-guest';

const TOKEN = 'abcdefghijklmnopqrstuv';
const SERVERS: RemoteServer[] = [];

const view = (overrides: Partial<Parameters<typeof buildRemoteView>[0]> = {}): RemoteView => buildRemoteView({
  boothScreen: 'ready', operatorWorking: false, consentOpen: false, paused: false,
  eventName: 'Ana & Ben', welcomeText: 'Welcome', thankYouText: 'Thanks', primaryColor: '#111111', accentColor: '#222222',
  logoUrl: '', layoutCount: 2, shotCount: 3, currentShot: 0, countdown: null,
  slots: [{ slotNumber: 1, photoId: 'p1' }, { slotNumber: 2, photoId: 'p2' }], shareUrl: '', consentText: 'Notice', now: 1,
  ...overrides,
});

async function start(options: { enabled?: boolean; maxClients?: number; commands?: RemoteCommand[]; onClientsChanged?: (count: number) => void } = {}) {
  const commands = options.commands ?? [];
  let enabled = options.enabled ?? true;
  const server = await createRemoteServer({
    token: TOKEN,
    isEnabled: () => enabled,
    port: 0,
    host: '127.0.0.1',
    maxClients: options.maxClients,
    onClientsChanged: options.onClientsChanged,
  });
  server.onCommand((command) => commands.push(command));
  SERVERS.push(server);
  const address = server.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    server, commands, port,
    disable: () => { enabled = false; },
    path: (suffix = '') => `/remote/${TOKEN}/${suffix}`,
  };
}

afterEach(async () => { while (SERVERS.length) await SERVERS.pop()!.close(); });

async function waitUntil(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function get(port: number, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    request.on('error', reject);
  });
}

/** A raw WebSocket client: the handshake, then masked text frames, so the server is tested as a browser sees it. */
type TestSocket = {
  socket: net.Socket;
  messages: string[];
  waitForMessage: (index: number) => Promise<string>;
  send: (text: string) => void;
  closed: Promise<void>;
};

function frame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) masked[index] = masked[index]! ^ mask[index % 4]!;
  return Buffer.concat([Buffer.from([0x81, 0x80 | masked.length]), mask, masked]);
}

function openSocket(port: number, path: string): Promise<TestSocket & { status: number }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '\r\n',
      ].join('\r\n'));
    });
    const messages: string[] = [];
    const waiters: Array<() => void> = [];
    let status = 0;
    let handshake = '';
    let pending = Buffer.alloc(0);
    let closedResolve: () => void = () => {};
    const closed = new Promise<void>((done) => { closedResolve = done; });
    socket.on('data', (chunk: Buffer) => {
      if (status === 0) {
        handshake += chunk.toString('latin1');
        const end = handshake.indexOf('\r\n\r\n');
        if (end === -1) return;
        status = Number(handshake.slice(9, 12));
        const rest = Buffer.from(handshake.slice(end + 4), 'latin1');
        handshake = '';
        if (status === 101) {
          resolve({
            socket, messages, status, closed,
            waitForMessage: (index) => new Promise<string>((done) => {
              const check = (): void => { if (messages[index] !== undefined) done(messages[index]!); else waiters.push(check); };
              check();
            }),
            send: (text) => socket.write(frame(text)),
          });
        } else {
          socket.destroy();
          resolve({ socket, messages, status, closed, waitForMessage: async () => '', send: () => {} });
        }
        if (rest.length) socket.emit('data', rest);
        return;
      }
      // Server frames are unmasked: opcode/length header, then the payload.
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (pending.length < 2) break;
        const opcode = pending[0]! & 0x0f;
        let length = pending[1]! & 0x7f;
        let header = 2;
        if (length === 126) {
          if (pending.length < 4) break;
          length = pending.readUInt16BE(2);
          header = 4;
        } else if (length === 127) {
          if (pending.length < 10) break;
          length = Number(pending.readBigUInt64BE(2));
          header = 10;
        }
        if (pending.length < header + length) break;
        if (opcode === 0x1) messages.push(pending.subarray(header, header + length).toString('utf8'));
        pending = pending.subarray(header + length);
      }
      while (waiters.length) waiters.pop()!();
    });
    socket.on('close', () => { closedResolve(); if (status === 0) reject(new Error('closed before handshake')); });
    socket.on('error', reject);
  });
}

describe('the tablet server (F22)', () => {
  it('only answers under the right token', async () => {
    const { port, path } = await start();
    expect((await get(port, '/')).status).toBe(404);
    expect((await get(port, `/remote/zzzzzzzzzzzzzzzzzzzzzz/`)).status).toBe(404);
    expect((await get(port, path())).status).toBe(200);
    expect((await get(port, path('nope'))).status).toBe(404);
  });

  it('serves the page, its script and a redirect from the bare link', async () => {
    const { port, path } = await start();
    const page = await get(port, path());
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<script src="app.js"></script>');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    const script = await get(port, path('app.js'));
    expect(script.headers['content-type']).toContain('javascript');
    expect(script.body).toContain('new WebSocket');
    const bare = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: `/remote/${TOKEN}` }, (response) => { response.resume(); resolve(response.statusCode ?? 0); }).on('error', reject);
    });
    expect(bare).toBe(302);
  });

  it('refuses everything while the operator has the screen switched off', async () => {
    const { port, path, disable } = await start({ enabled: false });
    expect((await get(port, path())).status).toBe(404);
    expect((await get(port, path('app.js'))).status).toBe(404);
    disable();
    expect((await get(port, path())).status).toBe(404);
  });

  it('streams the latest preview frame to a tablet that joins late', async () => {
    const { port, path, server } = await start();
    server.pushFrame(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; first: string }>((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port, path: path('stream.mjpg') }, (incoming) => {
        let first = '';
        incoming.on('data', (chunk: Buffer) => {
          first += chunk.toString('latin1');
          if (first.includes('Content-Length: 4')) { incoming.destroy(); resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, first }); }
        });
      });
      request.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error); });
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('multipart/x-mixed-replace');
    expect(response.first).toContain('--photoboothframe');
    expect(response.first).toContain('Content-Type: image/jpeg');
  });

  it('greets a tablet with the current view and forwards its commands', async () => {
    const { port, path, server, commands } = await start();
    server.publish(view());
    const client = await openSocket(port, path('ws'));
    expect(client.status).toBe(101);
    const hello = JSON.parse(await client.waitForMessage(0)) as RemoteView;
    expect(hello).toMatchObject({ stage: 'ready', eventName: 'Ana & Ben' });
    client.send(JSON.stringify({ type: 'start' }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commands).toEqual([{ type: 'start' }]);
    client.socket.destroy();
  });


  it('pushes every published view to a connected tablet', async () => {
    const { port, path, server } = await start();
    server.publish(view());
    const client = await openSocket(port, path('ws'));
    await client.waitForMessage(0);
    server.publish(view({ boothScreen: 'capturing', currentShot: 1, countdown: 3 }));
    expect(JSON.parse(await client.waitForMessage(1))).toMatchObject({ stage: 'capturing', countdown: 3 });
    client.socket.destroy();
  });

  it('ignores commands for another stage, unknown types and a burst of them', async () => {
    const { port, path, server, commands } = await start();
    server.publish(view({ boothScreen: 'ready' }));
    const client = await openSocket(port, path('ws'));
    await client.waitForMessage(0);
    client.send(JSON.stringify({ type: 'continue' }));
    client.send(JSON.stringify({ type: 'set-admin-pin' }));
    client.send('not json');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commands).toEqual([]);
    // A second command straight after an accepted one is throttled.
    client.send(JSON.stringify({ type: 'start' }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    client.send(JSON.stringify({ type: 'start' }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commands).toEqual([{ type: 'start' }]);
    client.socket.destroy();
  });

  it('reports connected tablets so the booth knows to send frames', async () => {
    const counts: number[] = [];
    const { port, path, server } = await start({ onClientsChanged: (count) => counts.push(count) });
    server.publish(view());
    const client = await openSocket(port, path('ws'));
    await client.waitForMessage(0);
    expect(server.clientCount()).toBe(1);
    expect(counts).toEqual([1]);
    client.socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await waitUntil(() => server.clientCount() === 0);
    expect(counts).toEqual([1, 0]);
  });

  it('refuses more tablets than the booth allows, and upgrades no other path', async () => {
    const { port, path } = await start({ maxClients: 1 });
    const first = await openSocket(port, path('ws'));
    expect(first.status).toBe(101);
    const second = await openSocket(port, path('ws'));
    expect(second.status).toBe(503);
    const wrongPath = await openSocket(port, `/remote/${TOKEN}/not-a-socket`);
    expect(wrongPath.status).toBe(404);
    first.socket.destroy();
  });

  it('refuses a socket while the screen is switched off', async () => {
    const { port, path, disable } = await start();
    disable();
    const client = await openSocket(port, path('ws'));
    expect(client.status).toBe(403);
  });

  it('closes cleanly with a tablet attached', async () => {
    const { port, path, server } = await start();
    server.publish(view());
    const client = await openSocket(port, path('ws'));
    await client.waitForMessage(0);
    await server.close();
    expect(server.clientCount()).toBe(0);
  });
});
