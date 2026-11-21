import { describe, expect, it } from 'vitest';
import { MockCameraDevice, type CameraDevice } from './camera';

describe('MockCameraDevice', () => {
  it('satisfies the camera adapter contract without physical hardware', async () => {
    const mock: CameraDevice = new MockCameraDevice();
    const cameras = await mock.listCameras();
    expect(cameras).toEqual([{ deviceId: 'mock-camera', label: 'Mock Camera' }]);
    const stream = await mock.startPreview(cameras[0]!.deviceId, 'best');
    expect(stream.id).toContain('mock-stream');
    mock.stopPreview(stream);
    expect((mock as MockCameraDevice).stoppedStreams).toContain(stream);
  });
});
