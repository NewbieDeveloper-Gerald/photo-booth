/** Shared vocabulary for deletion and retention; safe to import from the renderer. */
export type DeletionResult = { deletedSessions: number; deletedFiles: number };
export type PurgeResult = DeletionResult & { skippedSessions: number; lastSweepAt: string; errors: string[] };
export type RetentionStatus = { lastSweepAt: string | null; expiredSessions: number };
