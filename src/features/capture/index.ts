/**
 * Renderer-safe surface of the capture feature. Main-process code (the data layer,
 * which touches node:fs) lives in ./node.ts so the browser bundle never pulls it in.
 */
export { BrowserCameraDevice, MockCameraDevice, type CameraDevice, type CameraInfo, type CameraResolution } from './devices/camera';
export { cameraErrorMessage } from './domain/camera-messages';
export { createCountdownTicks, isValidCountdown } from './domain/countdown';
export { canRetake, isValidRetakeLimit, retakesRemaining } from './domain/retake-rules';
export { captureOriginalJpeg, createDownloadCopy, fitDimensions } from './domain/photo-pipeline';
export type { SessionRecord, SessionSlot, UnfinishedSession } from '../../shared/types/session';
