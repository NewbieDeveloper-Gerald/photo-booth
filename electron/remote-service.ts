import os from 'node:os';
import type { RemoteHub, RemoteServer } from '../src/features/remote-guest/node.js';
import {
  createRemoteServer, ensureRemoteToken, pickLanAddress, readRemoteEnabled, remoteGuestUrl, REMOTE_GUEST_PORT,
  rotateRemoteToken, setRemoteEnabled,
} from '../src/features/remote-guest/node.js';
import type { RemoteServerInfo } from '../src/shared/types/remote-guest.js';

/**
 * Keeps the tablet server's life tied to the booth app (F22). The server runs from start-up so
 * switching the screen on needs no restart; while it is off, every request is answered with a
 * 404 and the token is not even checked.
 */
export type RemoteGuestService = {
  hub: RemoteHub;
  info: () => RemoteServerInfo;
  setEnabled: (enabled: boolean) => RemoteServerInfo;
  rotateLink: () => Promise<RemoteServerInfo>;
  stop: () => Promise<void>;
};

export async function startRemoteGuestService(options: {
  userDataPath: string;
  onClientsChanged?: (clients: number) => void;
}): Promise<RemoteGuestService | null> {
  const lan = pickLanAddress(os.networkInterfaces());
  let token = ensureRemoteToken(options.userDataPath);
  let server: RemoteServer | null = null;
  let listenersBound = new Set<Parameters<RemoteHub['onCommand']>[0]>();
  const enabled = (): boolean => readRemoteEnabled(options.userDataPath);
  const info = (): RemoteServerInfo => ({
    enabled: enabled(),
    url: lan ? remoteGuestUrl(lan, REMOTE_GUEST_PORT, token) : null,
    clients: server?.clientCount() ?? 0,
  });

  const start = async (): Promise<RemoteServer | null> => {
    try {
      const created = await createRemoteServer({
        token,
        isEnabled: enabled,
        onClientsChanged: options.onClientsChanged,
      });
      for (const listener of listenersBound) created.onCommand(listener);
      return created;
    } catch (error) {
      console.warn(`The tablet guest screen could not start: ${error instanceof Error ? error.message : 'unknown error'}`);
      return null;
    }
  };

  server = await start();
  if (!server) return null;
  // Listeners registered by the IPC layer must survive a link rotation, so keep them here.
  const onCommand = (listener: Parameters<RemoteHub['onCommand']>[0]): void => {
    listenersBound = new Set([...listenersBound, listener]);
    server?.onCommand(listener);
  };
  const hub: RemoteHub = {
    publish: (view) => server?.publish(view),
    pushFrame: (jpeg) => server?.pushFrame(jpeg),
    onCommand,
    clientCount: () => server?.clientCount() ?? 0,
    close: async () => { await server?.close(); },
  };
  return {
    hub,
    info,
    setEnabled: (next) => { setRemoteEnabled(options.userDataPath, next); return info(); },
    rotateLink: async () => {
      await server?.close();
      token = rotateRemoteToken(options.userDataPath);
      server = await start();
      return info();
    },
    stop: async () => { await server?.close(); server = null; },
  };
}
