// The size limits live in $lib/sim-stream/limits (the browser imports them too); the rate bucket
// and the index constants are the server's own.
export {
  LIMITS,
  STAMP_MAX,
  fitsCommit,
  overFrameLimit,
  utf8Bytes,
  type Limits
} from '$lib/sim-stream/limits';

export const INDEX_BATCH = 50;
export const INDEX_RETRY_MS = 30_000;

export class RateBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
    now: number
  ) {
    this.tokens = burst;
    this.last = now;
  }

  /** Takes one token; false when none is left. A clock that goes back adds nothing. */
  take(now: number): boolean {
    this.tokens = Math.min(
      this.burst,
      this.tokens + (Math.max(0, now - this.last) / 1000) * this.perSecond
    );
    this.last = Math.max(this.last, now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
