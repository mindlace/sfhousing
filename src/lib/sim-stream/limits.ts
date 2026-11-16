// The sim's size limits, shared by the server and the browser. No imports: any client can load
// this file. The server's rate bucket and index constants are in $lib/server/sim-object/limits.

export interface Limits {
  commitBytes: number;
  frameBytes: number;
  simCommits: number;
  simBytes: number;
  burst: number;
  perSecond: number;
  sendBytes: number;
  /** The most stored-body bytes in one resume answer (at least one commit is always sent). */
  resumeBytes: number;
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
  sendBytes: 1_048_576,
  // 8 MiB: one answer, so the object never queues a whole sim on a socket in one turn.
  resumeBytes: 8_388_608
};

/**
 * An upper bound on the bytes the server adds to a draft's JSON when it stamps it: the keys and
 * values of `seq` and `at` (16 digits each), `actor` (64 characters, each at most six bytes once
 * JSON-escaped) and `hash` (64 hex characters) come to 514; this leaves room.
 */
export const STAMP_MAX = 1024;

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

/**
 * The browser's check before it sends a commit: its JSON plus STAMP_MAX fits commitBytes. A draft
 * that passes is never refused `limit` for its size (its append frame also fits frameBytes).
 */
export function fitsCommit(draft: unknown, limits: Limits = LIMITS): boolean {
  return utf8Bytes(JSON.stringify(draft)) + STAMP_MAX <= limits.commitBytes;
}
