// The arrival-ordered log of the worker's `compiled`, `filled` and `refill` posts (R-1), and the
// view the page reads from it (R-2, rule 29). Browser-safe; nothing here mutates a chunk or a
// statics: entries and rows are replaced.
import type { MoneyRow, ScoreStatics, SeriesChunk, TimelineView } from '$lib/sim/world/score/types';
import { chunksBefore, viewOf } from '$lib/sim/world/score/view';

/** A chunk and the statics of the last `compiled` delivered before it (null before the first). */
export interface LogEntry {
  chunk: SeriesChunk;
  statics: ScoreStatics | null;
}

export interface ChunkLog {
  /** The last statics delivered; null before the first `compiled`. */
  readonly statics: ScoreStatics | null;
  /** Contiguous chunks from month 0, in arrival order. */
  readonly entries: readonly LogEntry[];
}

export const EMPTY_LOG: ChunkLog = { statics: null, entries: [] };

/** The months held: the `from` the next `filled` must carry. */
export function nextMonth(log: ChunkLog): number {
  const last = log.entries.at(-1);
  return last ? last.chunk.from + last.chunk.rows.length : 0;
}

/**
 * Applies a `compiled`: `statics` becomes the log's, and entries filed before the first
 * `compiled` (null statics) are joined to it (rule 29). Entries with statics keep theirs.
 */
export function logCompiled(log: ChunkLog, statics: ScoreStatics): ChunkLog {
  return {
    statics,
    entries: log.entries.map((e) => (e.statics === null ? { chunk: e.chunk, statics } : e))
  };
}

/** Applies a `filled`; a chunk that does not start at `nextMonth` is a breach, logged and dropped. */
export function logFilled(log: ChunkLog, chunk: SeriesChunk): ChunkLog {
  const next = nextMonth(log);
  if (chunk.from !== next) {
    console.error(`timeline: chunk from ${chunk.from} does not follow month ${next - 1}; dropped`);
    return log;
  }
  return { statics: log.statics, entries: [...log.entries, { chunk, statics: log.statics }] };
}

/** Applies a `refill`: keeps the months before `from` as `chunksBefore` does, with their statics. */
export function logRefill(log: ChunkLog, from: number): ChunkLog {
  const kept = chunksBefore(
    log.entries.map((e) => e.chunk),
    from
  );
  return {
    statics: log.statics,
    entries: kept.map((chunk, i) => {
      const e = log.entries[i];
      return chunk === e.chunk ? e : { chunk, statics: e.statics };
    })
  };
}

type PoolRow = MoneyRow['pools'][number];

function zeroPool(p: PoolRow): PoolRow {
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    received: 0,
    committed: 0,
    out: 0,
    spent: 0,
    repaid: 0,
    lost: 0,
    lostCredit: 0
  };
}

function zeroRow(ref: readonly PoolRow[]): MoneyRow {
  return {
    pools: ref.map(zeroPool),
    fundedHomes: 0,
    displacedHomes: 0,
    displacedHomesCompleted: 0,
    publicSpent: 0
  };
}

/** `row` with its pools in `ref`'s order: missing pools as zero rows, pools not in `ref` dropped. */
function rekey(row: MoneyRow, ref: readonly PoolRow[]): MoneyRow {
  const same = row.pools.length === ref.length && row.pools.every((p, i) => p.id === ref[i].id);
  if (same) return row;
  const byId = new Map(row.pools.map((p) => [p.id, p]));
  return { ...row, pools: ref.map((r) => byId.get(r.id) ?? zeroPool(r)) };
}

/** The pools of the newest money held, or null when no chunk has any. */
function refPools(chunks: readonly SeriesChunk[]): readonly PoolRow[] | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const m = chunks[i].money;
    if (m && m.length > 0) return m[m.length - 1].pools;
  }
  return null;
}

/** The chunks with money every chunk can be joined on under `statics`. */
function aligned(chunks: SeriesChunk[], statics: ScoreStatics): SeriesChunk[] {
  if (statics.limits === null || statics.debts === null) {
    return chunks.map((c) => (c.money === null ? c : { ...c, money: null }));
  }
  const ref = refPools(chunks);
  if (ref === null) return chunks;
  return chunks.map((c) => ({
    ...c,
    money: c.money ? c.money.map((r) => rekey(r, ref)) : c.rows.map(() => zeroRow(ref))
  }));
}

/**
 * What the page reads: null before the first `compiled`. The statics are the last entry's (else
 * the log's); money is aligned to them: stripped without finance, else every month keyed to the
 * pools of the newest money held.
 */
export function viewOfLog(log: ChunkLog): TimelineView | null {
  if (log.statics === null) return null;
  const statics = log.entries.at(-1)?.statics ?? log.statics;
  return viewOf(
    aligned(
      log.entries.map((e) => e.chunk),
      statics
    ),
    statics
  );
}
