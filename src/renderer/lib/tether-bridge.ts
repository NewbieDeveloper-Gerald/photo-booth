import type { TetherBridge, TetherStatus } from '../../features/capture';

/**
 * The renderer's end of the tether camera (F26). Frames arrive as IPC events and are handed on
 * as plain JPEG bytes, so the device layer never needs to know about Electron.
 */
export function createTetherBridge(bridge = window.photobooth): TetherBridge {
  let unsubscribeFrame: (() => void) | null = null;
  let unsubscribeError: (() => void) | null = null;
  let onFrameHandler: ((jpeg: Uint8Array) => void) | null = null;

  const clear = (): void => {
    unsubscribeFrame?.();
    unsubscribeError?.();
    unsubscribeFrame = null;
    unsubscribeError = null;
  };

  return {
    status: async (): Promise<TetherStatus> => {
      if (!bridge) throw new Error('The tether camera needs the desktop app.');
      return bridge.dslrStatus();
    },
    startLiveView: async (onFrame, onError) => {
      if (!bridge) throw new Error('The tether camera needs the desktop app.');
      clear();
      onFrameHandler = onFrame;
      unsubscribeFrame = bridge.onDslrFrame((jpeg) => onFrameHandler?.(new Uint8Array(jpeg)));
      // A camera that dies mid-event reports it here, so the booth can fall back to a webcam
      // instead of showing a frozen preview.
      unsubscribeError = bridge.onDslrError((message) => onError?.(message));
      try {
        await bridge.startDslrLiveView();
      } catch (error) {
        clear();
        throw error;
      }
    },
    stopLiveView: async () => {
      clear();
      onFrameHandler = null;
      await bridge?.stopDslrLiveView().catch(() => undefined);
    },
    capture: async () => {
      if (!bridge) throw new Error('The tether camera needs the desktop app.');
      return new Uint8Array(await bridge.captureDslrPhoto());
    },
  };
}
