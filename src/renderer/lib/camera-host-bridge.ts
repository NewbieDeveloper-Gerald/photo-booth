import type { CameraHostBridge } from '../../features/capture/camera/edsdk-camera';
import type { CameraHostStatus } from '../../features/capture/camera/host-protocol';
import type { CameraSettingRole, CameraSettings } from '../../features/capture/camera/camera-settings';
import type { CameraInfo } from '../../features/capture/devices/camera';

const NEEDS_DESKTOP = 'The DSLR camera needs the desktop app.';

/**
 * The renderer's end of the EDSDK camera (Phase 1). Same shape as the tether bridge it replaces:
 * frames arrive as IPC events and are handed on as plain JPEG bytes, so the device layer never
 * has to know about Electron.
 */
export function createCameraHostBridge(bridge = window.photobooth): CameraHostBridge {
  let unsubscribeFrame: (() => void) | null = null;
  let unsubscribeError: (() => void) | null = null;

  const clear = (): void => {
    unsubscribeFrame?.();
    unsubscribeError?.();
    unsubscribeFrame = null;
    unsubscribeError = null;
  };

  const requireBridge = (): NonNullable<typeof bridge> => {
    if (!bridge) throw new Error(NEEDS_DESKTOP);
    return bridge;
  };

  return {
    status: async (): Promise<CameraHostStatus> => {
      if (!bridge) return { available: false, connected: false, restarts: 0, reason: NEEDS_DESKTOP };
      return bridge.cameraHostStatus();
    },
    list: async (): Promise<CameraInfo[]> => (bridge ? bridge.cameraList() : []),
    capabilities: async (deviceId: string) => requireBridge().cameraCapabilities(deviceId),
    settings: async (deviceId: string) => requireBridge().cameraSettings(deviceId),
    setSettings: async (deviceId: string, role: CameraSettingRole, settings: CameraSettings) =>
      requireBridge().setCameraSettings(deviceId, role, settings),
    startLiveView: async (deviceId, onFrame, onError) => {
      const desktop = requireBridge();
      clear();
      unsubscribeFrame = desktop.onCameraFrame((jpeg) => onFrame(new Uint8Array(jpeg)));
      unsubscribeError = desktop.onCameraError((message) => onError(message));
      try {
        await desktop.startCameraLiveView(deviceId);
      } catch (error) {
        clear();
        throw error;
      }
    },
    stopLiveView: async () => {
      clear();
      await bridge?.stopCameraLiveView().catch(() => undefined);
    },
    focus: async (deviceId: string) => requireBridge().focusCamera(deviceId),
    shutter: async (deviceId: string) => requireBridge().cameraShutter(deviceId),
    download: async (deviceId: string) => new Uint8Array(await requireBridge().downloadCameraPhoto(deviceId)),
  };
}
