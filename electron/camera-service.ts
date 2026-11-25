import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { CameraInfo } from '../src/features/capture/devices/camera.js';
import type { CameraCapabilities, CameraSettingRole, CameraSettings, CameraSettingsPair } from '../src/features/capture/camera/camera-settings.js';
import type { CameraHostStatus } from '../src/features/capture/camera/host-protocol.js';
import { createCameraHostSupervisor } from '../src/features/capture/camera/host-supervisor.js';
import { resolveHostProgram } from '../src/features/capture/camera/host-program.js';
import { EDSDK_DEVICE_PREFIX } from '../src/features/capture/camera/edsdk-camera.js';
import { spawnHostTransport } from './camera-host-transport.js';

/**
 * The camera host in the main process (Phase 1). The renderer never runs a camera protocol: it
 * asks for the list, the settings and a still, and receives live-view frames as events. When the
 * host program or the EDSDK is not on this machine, every call fails with one sentence the panel
 * can show, and the booth carries on with a webcam.
 */
export type CameraService = {
  status(): CameraHostStatus;
  list(): Promise<CameraInfo[]>;
  capabilities(deviceId: string): Promise<CameraCapabilities>;
  settings(deviceId: string): Promise<CameraSettingsPair>;
  setSettings(deviceId: string, role: CameraSettingRole, settings: CameraSettings): Promise<void>;
  startLiveView(deviceId: string): Promise<void>;
  stopLiveView(): Promise<void>;
  focus(deviceId: string): Promise<void>;
  shutter(deviceId: string): Promise<void>;
  download(deviceId: string): Promise<Uint8Array>;
  dispose(): void;
};

type HostListEntry = { index: number; model: string; serial?: string | null };

const NOT_INSTALLED = 'The camera host is not installed, so the DSLR cannot be used. Reinstall Boothwright, or keep using the webcam. The Canon EDSDK files also have to be in the camera-host folder.';

export function startCameraService(getWindow: () => BrowserWindow | null): CameraService {
  const location = resolveHostProgram({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    exists: fs.existsSync,
  });

  let status: CameraHostStatus = location.exists
    ? { available: true, connected: false, restarts: 0, reason: 'Starting the camera host…' }
    : { available: false, connected: false, restarts: 0, reason: NOT_INSTALLED };

  const send = (channel: string, payload: unknown): void => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  if (!location.exists) {
    const unavailable = (): Promise<never> => Promise.reject(new Error(NOT_INSTALLED));
    return {
      status: () => status,
      list: unavailable,
      capabilities: unavailable,
      settings: unavailable,
      setSettings: unavailable,
      startLiveView: unavailable,
      stopLiveView: unavailable,
      focus: unavailable,
      shutter: unavailable,
      download: unavailable,
      dispose: () => undefined,
    };
  }

  const supervisor = createCameraHostSupervisor({
    connect: () => spawnHostTransport(location.program),
    onFrame: (jpeg) => send('camera:frame', jpeg),
    onEvent: (event) => { if (event.event === 'error' || event.event === 'disconnected') send('camera:error', event.message); },
    onStatus: (next) => { status = next; send('camera:status', next); },
  });
  status = supervisor.status();

  /** The device id the renderer uses is the host's index, so a re-plug keeps the same name. */
  const indexOf = (deviceId: string): number => {
    const index = Number.parseInt(deviceId.slice(EDSDK_DEVICE_PREFIX.length), 10);
    if (!Number.isInteger(index) || index < 0) throw new Error('That is not a camera the host knows about.');
    return index;
  };

  return {
    status: () => supervisor.status(),

    async list(): Promise<CameraInfo[]> {
      const cameras = await supervisor.call<HostListEntry[]>('list');
      return cameras.map((camera) => ({
        deviceId: `${EDSDK_DEVICE_PREFIX}${camera.index}`,
        label: camera.serial ? `${camera.model} · ${camera.serial}` : camera.model,
      }));
    },

    capabilities: (deviceId) => supervisor.call<CameraCapabilities>('capabilities', { index: indexOf(deviceId) }),

    settings: (deviceId) => supervisor.call<CameraSettingsPair>('settings', { index: indexOf(deviceId) }),

    async setSettings(deviceId, role, settings): Promise<void> {
      await supervisor.call('setSettings', { index: indexOf(deviceId), role, settings });
    },

    async startLiveView(deviceId): Promise<void> {
      await supervisor.call('liveViewStart', { index: indexOf(deviceId) });
    },

    async stopLiveView(): Promise<void> {
      await supervisor.call('liveViewStop');
    },

    async focus(deviceId): Promise<void> {
      await supervisor.call('focus', { index: indexOf(deviceId) });
    },

    async shutter(deviceId): Promise<void> {
      await supervisor.call('shutter', { index: indexOf(deviceId) });
    },

    /**
     * The still comes back as a file path rather than a base64 blob: a 6 MP JPEG doubled into text
     * is megabytes of copying for no gain. The host writes it under the temp folder, we read it,
     * and it is removed here so a long event cannot fill the disk with one-shot files.
     */
    async download(deviceId): Promise<Uint8Array> {
      const reply = await supervisor.call<{ path: string }>('download', { index: indexOf(deviceId) });
      const file = reply.path;
      // Only a path inside the temp folder is read: the host is ours, but the renderer is not.
      const tempRoot = path.resolve(os.tmpdir());
      if (path.resolve(file).startsWith(tempRoot)) {
        const bytes = new Uint8Array(await fs.promises.readFile(file));
        await fs.promises.unlink(file).catch(() => undefined);
        return bytes;
      }
      throw new Error('The camera host returned a file outside its temporary folder.');
    },

    dispose: () => supervisor.dispose(),
  };
}
