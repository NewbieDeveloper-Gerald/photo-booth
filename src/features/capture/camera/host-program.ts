/**
 * Where the camera host executable lives. The host is a .NET program that owns Canon's EDSDK; it
 * ships beside the app, and a developer can point at a build of it with `PHOTOBOOTH_CAMERA_HOST`.
 * Nothing here throws when the file is missing — a booth without a DSLR is a normal booth, and the
 * panel has to be able to say so in one sentence.
 */
export const HOST_EXE_WINDOWS = 'Boothwright.CameraHost.exe';
export const HOST_EXE_OTHER = 'Boothwright.CameraHost';

export type HostLocation = { program: string; exists: boolean };

function join(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function resolveHostProgram(options: {
  resourcesPath?: string;
  appPath: string;
  env?: Record<string, string | undefined>;
  exists: (candidate: string) => boolean;
  platform?: string;
}): HostLocation {
  const { appPath, resourcesPath, env = process.env, exists, platform = process.platform } = options;
  const exe = platform === 'win32' ? HOST_EXE_WINDOWS : HOST_EXE_OTHER;
  const override = env.PHOTOBOOTH_CAMERA_HOST?.trim();
  const candidates = [
    ...(override ? [override] : []),
    ...(resourcesPath ? [join(resourcesPath, 'camera-host', exe)] : []),
    join(appPath, 'native', 'camera-host', 'bin', exe),
  ];
  const found = candidates.find((candidate) => exists(candidate));
  return { program: found ?? candidates[candidates.length - 1]!, exists: Boolean(found) };
}
