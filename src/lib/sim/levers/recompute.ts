/**
 * Budgeted background recompute of yields for lots the user layer touches (plan 2, Task 11).
 * Each `Need` is computed from the lot's chunk record with `envelopeRow`, the computation
 * `parcels.bin` and `policy.bin` use. Records arrive a cell (chunk) at a time, so needs are
 * bucketed by cell and `step` visits only the buckets of loaded cells: each need's record is read
 * once, and a need whose record is absent from its loaded cell gets a zero row (`missing`).
 * Worker-safe.
 */
import { envelopeRow, type EnvelopeRow } from '$lib/data/envelope-row';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { FILL_LEVELS, scenarioRecordOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import { scenarioYield } from '$lib/data/scenario-yield';
import { needKey, type Need } from './resolve';

/** `${row}:${stories}` → uncapped gross; one per session (dataset-scoped). The cap never enters it. */
export type GrossCache = Map<string, number>;

export interface YieldRecompute {
  readonly total: number;
  readonly done: number;
  /** Needs whose cell is loaded but whose record is absent (Call 19): filled with a zero row. */
  readonly missing: readonly ParcelId[];
  /** Cell ids of pending needs whose cell is not loaded yet. */
  cellsNeeded(): string[];
  /**
   * Computes pending needs, a loaded cell's bucket at a time, until the budget is spent; true
   * when done === total. A bucket whose cell is not loaded is skipped whole.
   */
  step(budgetMs: number): boolean;
  /** Keyed by `needKey`; complete only after `step` returned true. */
  result(): ReadonlyMap<string, EnvelopeRow>;
}

/** One cell's pending needs, in need order; `next` is the first not yet computed. */
interface Bucket {
  cellId: string;
  needs: [string, Need][];
  next: number;
}

export function createYieldRecompute(
  parcels: ScenarioParcels,
  needs: readonly Need[],
  deps: {
    record(id: ParcelId): ParcelRecord | undefined;
    cellLoaded(cellId: string): boolean;
    now(): number;
  },
  gross: GrossCache
): YieldRecompute {
  const unique = new Map<string, Need>();
  for (const n of needs) unique.set(needKey(n), n);
  const byCell = new Map<number, Bucket>();
  for (const [key, n] of unique) {
    const c = parcels.cell[n.row];
    let b = byCell.get(c);
    if (!b) byCell.set(c, (b = { cellId: parcels.cells[c].cellId, needs: [], next: 0 }));
    b.needs.push([key, n]);
  }
  let open = [...byCell.values()]; // buckets with needs left, in first-need order
  const out = new Map<string, EnvelopeRow>();
  const missing: ParcelId[] = []; // once per lot, though a lot can have several needs
  const missingSet = new Set<ParcelId>();
  const total = unique.size;
  const idOf = (row: number) => parcels.id[row] as ParcelId;
  const zeros = (n: Need): EnvelopeRow => ({
    stories: n.stories,
    cap: n.cap,
    yield: FILL_LEVELS.map(() => 0),
    hostable: false
  });

  const compute = (n: Need, rec: ParcelRecord): EnvelopeRow => {
    const view = scenarioRecordOf(parcels, n.row, rec);
    return envelopeRow({
      stories: n.stories,
      cap: n.cap,
      eligible: parcels.eligible[n.row] === 1,
      existingUnits: parcels.existingUnits[n.row],
      grossAt: (s) => {
        const k = `${n.row}:${s}`;
        let g = gross.get(k);
        if (g === undefined) gross.set(k, (g = scenarioYield(view, s, null)));
        return g;
      }
    });
  };

  return {
    total,
    get done() {
      return out.size;
    },
    missing,
    cellsNeeded() {
      return open.filter((b) => !deps.cellLoaded(b.cellId)).map((b) => b.cellId);
    },
    step(budgetMs) {
      const start = deps.now();
      let computed = 0;
      let spent = false;
      for (const b of open) {
        if (!deps.cellLoaded(b.cellId)) continue;
        while (b.next < b.needs.length) {
          if (computed > 0 && deps.now() - start >= budgetMs) {
            spent = true;
            break;
          }
          const [key, n] = b.needs[b.next++];
          const id = idOf(n.row);
          const rec = deps.record(id);
          if (rec) out.set(key, compute(n, rec));
          else {
            out.set(key, zeros(n));
            if (!missingSet.has(id)) {
              missingSet.add(id);
              missing.push(id);
            }
          }
          computed++;
        }
        if (spent) break;
      }
      if (computed > 0) open = open.filter((b) => b.next < b.needs.length);
      return out.size === total;
    },
    result: () => out
  };
}
