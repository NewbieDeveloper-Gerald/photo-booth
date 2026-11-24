const PERMISSION_DENIED = 'Camera permission was denied. Allow camera access in Windows Settings, then try again.';
const NO_MATCHING_CAMERA = 'No camera matched that choice. Select another camera or resolution.';
const CAMERA_BUSY = 'The camera is disconnected or being used by another app. Close that app or reconnect the camera.';
const CAMERA_UNKNOWN = 'The camera could not start. Check its connection and try again.';

/** Maps a getUserMedia failure onto wording an operator can act on. */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  // A tether camera (F26) already explains itself in the operator's words.
  if (name === 'TetherCameraError' && error instanceof Error && error.message) return error.message;
  if (name === 'NotAllowedError' || name === 'SecurityError') return PERMISSION_DENIED;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return NO_MATCHING_CAMERA;
  if (name === 'NotReadableError' || name === 'AbortError') return CAMERA_BUSY;
  return CAMERA_UNKNOWN;
}
