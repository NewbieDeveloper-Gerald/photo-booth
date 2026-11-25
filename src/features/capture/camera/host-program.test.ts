import { describe, expect, it } from 'vitest';
import { resolveHostProgram } from './host-program';

const existsOnly = (...paths: string[]) => (candidate: string) => paths.includes(candidate);

describe('finding the camera host', () => {
  it('prefers an explicit path from the environment', () => {
    const location = resolveHostProgram({
      appPath: '/app', resourcesPath: '/app/resources', platform: 'win32', env: { PHOTOBOOTH_CAMERA_HOST: 'C:/tools/host.exe' },
      exists: existsOnly('C:/tools/host.exe', '/app/resources/camera-host/Boothwright.CameraHost.exe'),
    });
    expect(location).toEqual({ program: 'C:/tools/host.exe', exists: true });
  });

  it('uses the copy that ships with the installer next', () => {
    const location = resolveHostProgram({
      appPath: '/app', resourcesPath: '/app/resources', platform: 'win32', env: {},
      exists: existsOnly('/app/resources/camera-host/Boothwright.CameraHost.exe'),
    });
    expect(location.program).toBe('/app/resources/camera-host/Boothwright.CameraHost.exe');
    expect(location.exists).toBe(true);
  });

  it('falls back to a development build under the repository', () => {
    const location = resolveHostProgram({
      appPath: '/repo', platform: 'linux', env: {},
      exists: existsOnly('/repo/native/camera-host/bin/Boothwright.CameraHost'),
    });
    expect(location).toEqual({ program: '/repo/native/camera-host/bin/Boothwright.CameraHost', exists: true });
  });

  it('reports a missing host without throwing, so the booth can fall back to a webcam', () => {
    const location = resolveHostProgram({ appPath: '/app', platform: 'win32', env: {}, exists: () => false });
    expect(location.exists).toBe(false);
    expect(location.program).toContain('Boothwright.CameraHost.exe');
  });
});
