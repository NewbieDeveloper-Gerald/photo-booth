import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { MAX_CLIENT_FRAME_BYTES, acceptKey, decodeClientFrames, encodeCloseFrame, encodePingFrame, encodePongFrame, encodeTextFrame, WebSocketProtocolError } from './websocket-frame';
import { mjpegHeaders, mjpegPart } from './mjpeg';
import { renderRemotePage, REMOTE_APP_JS } from '../remote-page-html';
import { isRemoteCommandAllowed, parseRemoteCommand } from '../domain/remote-view';
import { isRemoteToken } from './remote-settings';
import type { RemoteCommand, RemoteView } from '../../../shared/types/remote-guest';

import { REMOTE_GUEST_PORT } from '../domain/remote-port';
export { REMOTE_GUEST_PORT };
export const REMOTE_GUEST_HOST = '0.0.0.0';
/** One booth, a handful of guest screens; more than this is a misconfigured network. */
export const REMOTE_MAX_CLIENTS = 6;
const COMMAND_MIN_INTERVAL_MS = 300;
const CLIENT_IDLE_TIMEOUT_MS = 45_000;
const PING_INTERVAL_MS = 15_000;

export type RemoteServerOptions = {
  /** The secret in the URL; every route is checked against it. */
  token: string;
  /** Read on every request so the operator can switch the screen off without a restart. */
  isEnabled: () => boolean;
  port?: number;
  host?: string;
  maxClients?: number;
  /** The page title; the live view replaces it as soon as the tablet connects. */
  eventName?: string;
  /** Fired when a tablet connects or drops, so the booth can start or stop sending frames. */
  onClientsChanged?: (clients: number) => void;
};

type Client = {
  socket: Duplex;
  lastSeen: number;
  lastCommandAt: number;
};

type Stream = {
  response: ServerResponse;
  blocked: boolean;
};

export type RemoteHub = {
  publish: (view: RemoteView) => void;
  pushFrame: (jpeg: Uint8Array) => void;
  onCommand: (listener: (command: RemoteCommand) => void) => void;
  clientCount: () => number;
  close: () => Promise<void>;
};

export type RemoteServer = RemoteHub & { server: Server };

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * The tablet guest screen (F22): a small HTTP + WebSocket server on the booth's LAN. The booth
 * process stays in charge — this only carries the preview out and whitelisted commands in.
 * Nothing here touches SQLite or the camera: frames and the view arrive from the booth window.
 */
export function createRemoteServer(options: RemoteServerOptions): Promise<RemoteServer> {
  const port = options.port ?? REMOTE_GUEST_PORT;
  const host = options.host ?? REMOTE_GUEST_HOST;
  const maxClients = options.maxClients ?? REMOTE_MAX_CLIENTS;
  const prefix = `/remote/${options.token}`;

  const clients = new Set<Client>();
  const streams = new Set<Stream>();
  const listeners: Array<(command: RemoteCommand) => void> = [];
  let view: RemoteView | null = null;
  let lastFrame: Buffer | null = null;

  const broadcastView = (payload: string): void => {
    if (clients.size === 0) return;
    const frame = encodeTextFrame(payload);
    for (const client of clients) {
      if (!client.socket.writable) continue;
      try { client.socket.write(frame); } catch { clients.delete(client); }
    }
  };

  const publish = (next: RemoteView): void => {
    view = next;
    broadcastView(JSON.stringify(next));
  };

  const pushFrame = (jpeg: Uint8Array): void => {
    if (streams.size === 0) { lastFrame = jpeg.length > 0 ? Buffer.from(jpeg) : null; return; }
    const part = mjpegPart(jpeg);
    lastFrame = Buffer.from(jpeg);
    for (const stream of streams) {
      if (stream.blocked) continue; // a slow tablet skips frames instead of queueing them
      try {
        if (!stream.response.write(part)) {
          stream.blocked = true;
          stream.response.once('drain', () => { stream.blocked = false; });
        }
      } catch { streams.delete(stream); try { stream.response.destroy(); } catch { /* already gone */ } }
    }
  };

  const sendView = (client: Client): void => {
    const payload = JSON.stringify(view ?? { stage: 'off', message: 'The booth has not reported its state yet.' });
    try { client.socket.write(encodeTextFrame(payload)); } catch { clients.delete(client); }
  };

  const handleClientFrame = (client: Client, text: string): void => {
    const now = Date.now();
    if (now - client.lastCommandAt < COMMAND_MIN_INTERVAL_MS) return;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return; }
    const command = parseRemoteCommand(parsed, view?.shotCount || 6);
    if (!command) return;
    // Defence in depth: the booth screen also checks the stage. A tablet that sends a command
    // for a stage it is not in is simply ignored here.
    if (view && !isRemoteCommandAllowed(view, command)) return;
    client.lastCommandAt = now;
    for (const listener of listeners) listener(command);
  };

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== `${prefix}/ws`) { rejectUpgrade(socket, '404 Not Found'); return; }
    if (!options.isEnabled()) { rejectUpgrade(socket, '403 Forbidden'); return; }
    if (clients.size >= maxClients) { rejectUpgrade(socket, '503 Service Unavailable'); return; }
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string' || request.headers.upgrade?.toLowerCase() !== 'websocket') { rejectUpgrade(socket, '400 Bad Request'); return; }
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '\r\n',
    ].join('\r\n'));
    const client: Client = { socket, lastSeen: Date.now(), lastCommandAt: 0 };
    clients.add(client);
    options.onClientsChanged?.(clients.size);
    if (head.length) {
      try { for (const frame of decodeClientFrames(head).frames) if (frame.type === 'text') handleClientFrame(client, frame.text); } catch { /* ignore the tail */ }
    }
    socket.on('data', (chunk: Buffer) => {
      client.lastSeen = Date.now();
      try {
        const { frames } = decodeClientFrames(chunk);
        for (const frame of frames) {
          if (frame.type === 'text') handleClientFrame(client, frame.text);
          else if (frame.type === 'ping') socket.write(encodePongFrame(frame.payload));
          else if (frame.type === 'close') { drop(); socket.end(encodeCloseFrame()); return; }
        }
      } catch (error) {
        if (error instanceof WebSocketProtocolError) { drop(); socket.end(encodeCloseFrame(1002)); }
      }
    });
    const drop = (): void => {
      if (clients.delete(client)) options.onClientsChanged?.(clients.size);
    };
    socket.on('error', drop);
    socket.on('end', drop);
    socket.on('close', drop);
    sendView(client);
  };

  const serveStream = (request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(200, mjpegHeaders());
    if (request.method === 'HEAD') { response.end(); return; }
    const stream: Stream = { response, blocked: false };
    streams.add(stream);
    if (lastFrame) response.write(mjpegPart(lastFrame));
    const cleanup = (): void => { streams.delete(stream); };
    request.on('close', cleanup);
    response.on('close', cleanup);
    response.on('error', cleanup);
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // The token is the whole access control here, so a wrong one is a plain 404.
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (!options.isEnabled()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('The tablet screen is switched off on the booth.');
      return;
    }
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === `${prefix}/stream.mjpg`) { serveStream(request, response); return; }
    if (url.pathname === `${prefix}/app.js`) {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : REMOTE_APP_JS);
      return;
    }
    if (url.pathname === prefix) {
      response.writeHead(302, { Location: `${prefix}/` }).end();
      return;
    }
    if (url.pathname === `${prefix}/`) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : renderRemotePage({ eventName: options.eventName ?? '' }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  });

  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
      if (now - client.lastSeen > CLIENT_IDLE_TIMEOUT_MS) { clients.delete(client); client.socket.destroy(); options.onClientsChanged?.(clients.size); continue; }
      try { client.socket.write(encodePingFrame()); } catch { clients.delete(client); }
    }
  }, PING_INTERVAL_MS);
  heartbeat.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve({
        server,
        publish,
        pushFrame,
        onCommand: (listener) => { listeners.push(listener); },
        clientCount: () => clients.size,
        close: () => new Promise<void>((done) => {
          clearInterval(heartbeat);
          for (const client of clients) {
            try { client.socket.end(encodeCloseFrame(1001)); } catch { /* already gone */ }
            try { client.socket.destroy(); } catch { /* already gone */ }
          }
          if (clients.size > 0) { clients.clear(); options.onClientsChanged?.(0); }
          for (const stream of streams) { try { stream.response.destroy(); } catch { /* already gone */ } }
          streams.clear();
          // Long-lived streams and tablets are the point of this server; closing must not wait
          // for them to go idle first.
          server.closeAllConnections?.();
          server.close(() => done());
          const fallback = setTimeout(done, 1_000);
          fallback.unref?.();
        }),
      });
    });
  });
}

export { MAX_CLIENT_FRAME_BYTES, isRemoteToken };
