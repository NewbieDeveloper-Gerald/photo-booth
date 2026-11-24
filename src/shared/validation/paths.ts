/**
 * Path checks on already-resolved absolute paths. The separator is a parameter so this module
 * stays free of `node:path` and can be imported by either process.
 */
export function isInsidePath(parentPath: string, childPath: string, separator = '/'): boolean {
  return childPath.startsWith(`${parentPath}${separator}`);
}

export function isOverlappingPath(firstPath: string, secondPath: string, separator = '/'): boolean {
  return firstPath === secondPath ||
    isInsidePath(firstPath, secondPath, separator) ||
    isInsidePath(secondPath, firstPath, separator);
}
