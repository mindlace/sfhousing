// The worker's work budgets and the cancellation scope its sessions share. Imports nothing, so
// the page can take `PREVIEW_MAX_LOTS` without pulling worker code into its bundle.

/** Longest slice of compile or packing work (tier 4, engineering). */
export const SLICE_MS = 50;
/**
 * The length the scheduler plans a slice to: the 5 ms below `SLICE_MS` absorb a job that runs
 * over its estimate (a collection, a cold generator), so the slice still ends within `SLICE_MS`
 * (tier 4, engineering).
 */
export const SLICE_PLAN_MS = SLICE_MS - 5;
/**
 * Generator-memo cap in entries (tier 4, engineering): about 60 MB at the ≈0.8–1.0 KB per
 * entry measured in host.ts. Keys are content-based, so pipeline massings hit across seeds.
 */
export const MEMO_CAP = 60_000;
/**
 * The most lots one preview builds (tier 4, engineering): the page sends the lots in view nearest
 * first, and the worker builds at most this many of them in one synchronous handler, inside
 * `SLICE_MS`.
 */
export const PREVIEW_MAX_LOTS = 300;

/** A cancellation scope: its timers are cleared, and its callbacks dropped, once cancelled. */
export interface Token {
  readonly cancelled: boolean;
  /** `fn` after `ms`, unless the token is cancelled first. Returns the timer handle. */
  later(fn: () => void, ms: number): unknown;
  cancel(): void;
}

export function createToken(deps: {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}): Token {
  const timers = new Set<unknown>();
  let cancelled = false;
  return {
    get cancelled() {
      return cancelled;
    },
    later(fn, ms) {
      if (cancelled) return undefined;
      const h = deps.setTimeout(() => {
        timers.delete(h);
        if (!cancelled) fn();
      }, ms);
      timers.add(h);
      return h;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const h of timers) deps.clearTimeout(h);
      timers.clear();
    }
  };
}
