export type CameraInfo = { deviceId: string; label: string };
export type CameraResolution = 'best' | '1280x720' | '1920x1080' | '3840x2160';

export interface CameraDevice {
  listCameras(): Promise<CameraInfo[]>;
  startPreview(deviceId: string, resolution: CameraResolution): Promise<MediaStream>;
  stopPreview(stream: MediaStream | null): void;
}

const resolutionSizes: Record<Exclude<CameraResolution, 'best'>, { width: number; height: number }> = {
  '1280x720': { width: 1280, height: 720 },
  '1920x1080': { width: 1920, height: 1080 },
  '3840x2160': { width: 3840, height: 2160 },
};

export class BrowserCameraDevice implements CameraDevice {
  constructor(private readonly mediaDevices: MediaDevices = navigator.mediaDevices) {}

  async listCameras(): Promise<CameraInfo[]> {
    const devices = await this.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
  }

  startPreview(deviceId: string, resolution: CameraResolution): Promise<MediaStream> {
    const video: MediaTrackConstraints = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      ...(resolution === 'best'
        ? { width: { ideal: 3840 }, height: { ideal: 2160 } }
        : { width: { ideal: resolutionSizes[resolution].width }, height: { ideal: resolutionSizes[resolution].height } }),
    };
    return this.mediaDevices.getUserMedia({ audio: false, video });
  }

  stopPreview(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/** Test double for UI and session-flow tests; it does not access physical hardware. */
export class MockCameraDevice implements CameraDevice {
  private sequence = 0;
  readonly stoppedStreams: MediaStream[] = [];

  constructor(private readonly cameras: CameraInfo[] = [{ deviceId: 'mock-camera', label: 'Mock Camera' }]) {}

  async listCameras(): Promise<CameraInfo[]> {
    return this.cameras;
  }

  async startPreview(): Promise<MediaStream> {
    const id = `mock-stream-${++this.sequence}`;
    return {
      id,
      active: true,
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
      addTrack: () => undefined,
      removeTrack: () => undefined,
      clone: () => ({ id: `${id}-clone` } as MediaStream),
      getTrackById: () => null,
      onaddtrack: null,
      onremovetrack: null,
      onactive: null,
      oninactive: null,
      dispatchEvent: () => true,
    } as unknown as MediaStream;
  }

  stopPreview(stream: MediaStream | null): void {
    if (stream) this.stoppedStreams.push(stream);
  }
}
