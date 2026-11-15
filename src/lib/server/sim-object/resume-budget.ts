// The two byte budgets an object's resume answers are paid from. A socket that may write pays from
// the writers' budget, every other socket from the readers', so anyone holding a sim's link cannot
// spend what its writers need to catch up (as a reader cannot spend the append bucket). The sizes
// live with the other limits.
import {
  LIMITS,
  READER_RESUME_BUDGET,
  RateBucket,
  WRITER_RESUME_BUDGET,
  type BudgetSize
} from './limits';
import type { ResumeBounds } from './log-host';

export { READER_RESUME_BUDGET, WRITER_RESUME_BUDGET, type BudgetSize };

/** One object's two resume budgets, in memory (full again after a wake). */
export class ResumeBudgets {
  readonly #writers: RateBucket;
  readonly #readers: RateBucket;
  readonly #maxBytes: number;

  constructor(
    now: number,
    sizes: { writers: BudgetSize; readers: BudgetSize } = {
      writers: WRITER_RESUME_BUDGET,
      readers: READER_RESUME_BUDGET
    },
    maxBytes: number = LIMITS.resumeBytes
  ) {
    this.#writers = new RateBucket(sizes.writers.burst, sizes.writers.perSecond, now);
    this.#readers = new RateBucket(sizes.readers.burst, sizes.readers.perSecond, now);
    this.#maxBytes = maxBytes;
  }

  /** The bounds of one resume: a socket that may write pays from the writers' budget, any other
   *  from the readers' (anything but `true` is a reader: fail closed). */
  bounds(write: boolean, now: () => number): ResumeBounds {
    const bucket = write === true ? this.#writers : this.#readers;
    return { maxBytes: this.#maxBytes, take: (n) => bucket.take(now(), n) };
  }
}
