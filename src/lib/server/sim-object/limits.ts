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

/** A byte budget: `burst` bytes at once, refilled at `perSecond` bytes a second. */
export interface BudgetSize {
  burst: number;
  perSecond: number;
}

/** Resumes of sockets that may write: 24 MiB, refilled at 4 MiB a second. */
export const WRITER_RESUME_BUDGET: BudgetSize = { burst: 25_165_824, perSecond: 4_194_304 };
/** Resumes of every other socket (readers, signed-out visitors): 12 MiB, refilled at 2 MiB a
 *  second. Separate, so a socket without write never spends what writers need. */
export const READER_RESUME_BUDGET: BudgetSize = { burst: 12_582_912, perSecond: 2_097_152 };

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

  /** Takes n tokens (default 1); false, taking none, when fewer are left. A clock that goes back
   *  adds nothing. */
  take(now: number, n = 1): boolean {
    this.tokens = Math.min(
      this.burst,
      this.tokens + (Math.max(0, now - this.last) / 1000) * this.perSecond
    );
    this.last = Math.max(this.last, now);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
