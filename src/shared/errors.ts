/** Normalises anything thrown into a message safe to show an operator. */
export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
