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
import { parseAttachment } from './access';
import type { ResumeBounds } from './log-host';

export { READER_RESUME_BUDGET, WRITER_RESUME_BUDGET, type BudgetSize };

/**
 * Whether a resume page is paid from the writers' budget: only when the socket's attachment, read
 * now, is valid and says write. An attachment that cannot be read (invalid, or the read throws)
 * pays as a reader: fail closed.
 */
export function paysAsWriter(readAttachment: () => unknown): boolean {
  try {
    return parseAttachment(readAttachment())?.write === true;
  } catch {
    return false;
  }
}

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

  /**
   * The bounds of one socket's resume. Each page is paid from the budget of the socket's right to
   * write as `readAttachment` gives it when the page is paid (so a write revoked between pages
   * pays the next page as a reader): the writers' budget only when paysAsWriter, the readers'
   * otherwise, an attachment that cannot be read included.
   */
  boundsFor(readAttachment: () => unknown, now: () => number): ResumeBounds {
    return {
      maxBytes: this.#maxBytes,
      take: (n) => (paysAsWriter(readAttachment) ? this.#writers : this.#readers).take(now(), n)
    };
  }
}
