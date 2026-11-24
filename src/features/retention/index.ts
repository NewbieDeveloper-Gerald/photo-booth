/** Renderer-safe surface: retention rules and status only; deletion lives in ./node.ts. */
export { isShareLinkExpired, shouldPurgeSession } from './domain/expiry';
export type { DeletionResult, PurgeResult, RetentionStatus } from './domain/retention-types';
