/**
 * Renderer-safe surface of the capture feature. Main-process code (the data layer,
 * which touches node:fs) lives in ./node.ts so the browser bundle never pulls it in.
 */
export { BrowserCameraDevice, MockCameraDevice, type CameraDevice, type CameraInfo, type CameraResolution } from './devices/camera';
export { cameraErrorMessage } from './domain/camera-messages';
// DSLR / mirrorless tether camera (F26): the helper's commands stay in the main process; the
// renderer only sees a CameraDevice that also hands over full-resolution stills.
export { TETHER_DEVICE_PREFIX, TETHER_MODEL, type TetherBridge, type TetherStatus } from './dslr/dslr-types';
export {
  MockTetherBridge, TetherCameraDevice, TetherCameraError, canvasFrameStream, isTetherDeviceId,
  type FrameStream, type FrameStreamFactory,
} from './dslr/tether-camera';
export {
  capturePhotoFrom, createCameraSources, webcamFallback,
  type CameraSourceDevice, type CameraSources, type CaptureSource,
} from './dslr/camera-sources';
export { createCountdownTicks, isValidCountdown } from './domain/countdown';
export { canRetake, isValidRetakeLimit, retakesRemaining } from './domain/retake-rules';
export { captureOriginalJpeg, createDownloadCopy, fitDimensions, originalFromJpegBytes } from './domain/photo-pipeline';
export { drawWatermark, isWatermarkPosition, watermarkPlacement } from './domain/watermark';
export {
  PHOTO_FILTERS, cssPhotoFilter, drawFiltered, filterPasses, isPhotoFilterId, photoFilterLabel,
} from './domain/photo-filters';
export type { ClipRect, FilterPass, PhotoFilterOption } from './domain/photo-filters';
export type { PhotoFilterId } from '../../shared/types/photo-filter';
export type { WatermarkPosition, WatermarkSettings } from '../../shared/types/watermark';
export type { SessionRecord, SessionSlot, UnfinishedSession } from '../../shared/types/session';
