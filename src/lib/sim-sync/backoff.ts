export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
export const BACKOFF_JITTER = 0.2;

/**
 * min(30 s, 1 s * 2^attempt), times 1 - 0.2 + 0.4 * random(), rounded. attempt 0 is the first
 * retry; a negative, fractional or NaN attempt is clamped to a whole number of at least 0.
 */
export function backoffDelay(attempt: number, random: () => number): number {
  const n = Number.isNaN(attempt) ? 0 : Math.min(30, Math.max(0, Math.floor(attempt)));
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** n);
  return Math.round(base * (1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * random()));
}
