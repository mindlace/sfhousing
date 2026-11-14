// The warm-ahead queue (ensemble-runner plan D12): world 1's started and revised rows, massed one
// (row, revision) per unit before a flush, so the flush finds them on the generator memo and the
// slice estimator gates each massing. Worker-bundle module: pure TS.
import type { Schedule } from '$lib/sim/scenario/types';

export interface WarmQueue {
  /** Queues a row (a `'start'` or `'revise'` of world 1). */
  add(row: number): void;
  /** A row is queued or being warmed. */
  pending(): boolean;
  /** One unit: the next revision of the row being warmed; at most one `mass` call. */
  unit(): void;
  clear(): void;
}

/**
 * `read(row)` gives the row's schedule as world 1 stands now, or null when there is none or it
 * cannot be massed yet (a cell waiting on its chunk is massed by the flush once ready). It is read
 * again at each unit: the world may step between two units of one row.
 */
export function createWarmQueue(
  read: (row: number) => Schedule | null,
  mass: (s: Schedule, k: number) => void
): WarmQueue {
  const rows = new Set<number>();
  let cur: { row: number; k: number } | null = null;
  return {
    add: (row) => void rows.add(row),
    pending: () => rows.size > 0 || cur !== null,
    unit() {
      if (cur === null) {
        const row: number | undefined = rows.values().next().value;
        if (row === undefined) return;
        rows.delete(row);
        cur = { row, k: 0 };
      }
      const c = cur;
      const s = read(c.row);
      if (s === null || c.k >= s.revisions.length) {
        cur = null;
        return;
      }
      mass(s, c.k);
      c.k++;
      if (c.k >= s.revisions.length) cur = null;
    },
    clear() {
      rows.clear();
      cur = null;
    }
  };
}
