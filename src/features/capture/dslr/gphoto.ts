import { TETHER_MODEL } from './dslr-types';

/**
 * The helper is `gphoto2`, the open-source tethering program used behind the `CameraDevice`
 * interface (F26). The booth never speaks the camera's USB protocol itself: it builds short
 * command lines, checks the exit code and pulls the JPEG out of stdout.
 */
export const GPHOTO_HELPER = 'gphoto2';
export const LIST_TIMEOUT_MS = 8_000;
export const PREVIEW_TIMEOUT_MS = 6_000;
export const CAPTURE_TIMEOUT_MS = 25_000;

export function autoDetectArgs(): string[] {
  return ['--auto-detect'];
}

export function capturePreviewArgs(): string[] {
  return ['--capture-preview', '--stdout'];
}

/** The still is asked for on stdout as well, so there is no temporary file to tidy up. */
export function captureStillArgs(): string[] {
  return ['--capture-image-and-download', '--stdout'];
}

/**
 * "gphoto2 --auto-detect" prints a header, a rule, then one line per camera:
 *
 *     Model                          Port
 *     ----------------------------------------------------------
 *     Canon EOS 250D                 usb:001,004
 */
export function parseDetectedCameras(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('-') && !/^Model\b/i.test(line))
    .map((line) => line.replace(/\s{2,}.*$/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * gphoto2 can print logs around the picture, so the JPEG is cut out by its own markers rather
 * than trusting stdout to be a bare image.
 */
export function extractJpeg(bytes: Uint8Array): Uint8Array {
  const start = findMarker(bytes, [0xff, 0xd8], 0);
  const end = start === -1 ? -1 : findMarker(bytes, [0xff, 0xd9], start + 2);
  if (start === -1 || end === -1) throw new Error('The camera did not return a photo.');
  return bytes.subarray(start, end + 2);
}

function findMarker(bytes: Uint8Array, marker: number[], from: number): number {
  outer: for (let index = from; index <= bytes.length - marker.length; index += 1) {
    for (let offset = 0; offset < marker.length; offset += 1) {
      if (bytes[index + offset] !== marker[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

/** A missing binary is the most common failure, and the one worth its own sentence. */
export function describeHelperFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'ENOENT') {
    return `The tether helper (${GPHOTO_HELPER}) is not installed, so the ${TETHER_MODEL.label} cannot be used. Install it, or keep using a webcam.`;
  }
  if (code === 'ETIMEDOUT') return `The tether helper (${GPHOTO_HELPER}) stopped answering. Reconnect the camera and try again.`;
  return `The tether helper (${GPHOTO_HELPER}) failed. Reconnect the camera and try again.`;
}

/** gphoto2 explains itself on stderr; the operator gets the important part, in plain words. */
export function describeGphotoFailure(stderr: string, code: number): string {
  const text = stderr.trim();
  if (/could not find any camera|no camera/i.test(text)) return 'No tether camera was found on the USB port. Check the cable and the camera’s PC mode.';
  if (/could not claim|busy|another/i.test(text)) return 'The camera is busy — another program is probably using it. Close that program and try again.';
  if (/permission|access is denied/i.test(text)) return 'Windows refused access to the camera. Close other camera apps (including Windows Camera) and try again.';
  if (/battery|low power/i.test(text)) return 'The camera reports low power. Use a powered USB port or charge the camera.';
  return text ? `The camera reported: ${text.split(/\r?\n/)[0]!.slice(0, 180)}` : `The camera command failed (exit code ${code}).`;
}

export function isPromisedModel(cameras: string[]): boolean {
  return cameras.some((camera) => camera.toLowerCase().includes(TETHER_MODEL.label.toLowerCase()));
}
