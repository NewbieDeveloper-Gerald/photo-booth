export { abandonSession, createSession, discardSession, listUnfinishedSessions, loadSession } from './data/session-repository';
export { readOriginalPhoto, saveDownloadCopy, saveOriginalPhoto, saveRetakeOriginalPhoto } from './data/photo-repository';
export { commitRetake, revertRetake } from './data/retake-service';
export { savePrintSheet, saveSessionAnimation, saveSessionOutput } from './data/output-repository';
export type { SessionRecord, SessionSlot, UnfinishedSession } from '../../shared/types/session';
// The tether helper (F26) drives gphoto2 through commands injected by the Electron layer.
export { createTetherService, DEFAULT_FRAME_INTERVAL_MS, type TetherService, type TetherServiceOptions } from './dslr/tether-service';
export {
  GPHOTO_HELPER, autoDetectArgs, capturePreviewArgs, captureStillArgs, describeGphotoFailure, describeHelperFailure,
  extractJpeg, isPromisedModel, parseDetectedCameras,
} from './dslr/gphoto';
export type { RunCommand, TetherStatus } from './dslr/dslr-types';
