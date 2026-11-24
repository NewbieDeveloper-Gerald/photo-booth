import path from 'node:path';
import { isInsidePath } from '../validation/paths';

/** Main-process only: resolves `child` and refuses anything that escapes `parent`. */
export function ensureInside(parent: string, child: string): string {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!isInsidePath(resolvedParent, resolvedChild, path.sep)) throw new Error('Invalid photo path');
  return resolvedChild;
}

/** Like `ensureInside`, but returns null instead of throwing (used by the share server). */
export function resolveInside(parent: string, child: string): string | null {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return isInsidePath(resolvedParent, resolvedChild, path.sep) ? resolvedChild : null;
}
