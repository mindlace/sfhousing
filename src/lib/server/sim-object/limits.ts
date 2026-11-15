export interface Limits {
  commitBytes: number;
  frameBytes: number;
  simCommits: number;
  simBytes: number;
  burst: number;
  perSecond: number;
  sendBytes: number;
}

export const LIMITS: Limits = {
  commitBytes: 1_048_576,
  frameBytes: 1_052_672,
  simCommits: 100_000,
  // 64 MiB: a Durable Object has 128 MB of memory, and a fold or a resume must never need more
  // than the log's size at once.
  simBytes: 67_108_864,
  burst: 120,
  perSecond: 2,
  sendBytes: 1_048_576
};

export const INDEX_BATCH = 50;
export const INDEX_RETRY_MS = 30_000;

const encoder = new TextEncoder();

export function utf8Bytes(s: string): number {
  return encoder.encode(s).length;
}

/**
 * True when a text message is longer than the incoming frame limit. A string's length never
 * exceeds its UTF-8 byte count, so this refuses only frames that are surely too large, before
 * they are parsed; the host checks the exact size (utf8Bytes) of everything else.
 */
export function overFrameLimit(text: string, limits: Limits = LIMITS): boolean {
  return text.length > limits.frameBytes;
}

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
