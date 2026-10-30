/**
 * Budgeted background recompute of yields for lots the user layer touches (plan 2, Task 11).
 * Each `Need` is computed from the lot's chunk record with `envelopeRow`, the computation
 * `parcels.bin` and `policy.bin` use. Records arrive as chunks load, so `step` computes only the
 * needs whose record is available. Worker-safe.
 */
import { envelopeRow, type EnvelopeRow } from '$lib/data/envelope-row';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { scenarioRecordOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import { scenarioYield } from '$lib/data/scenario-yield';
import { needKey, type Need } from './resolve';

/** `${row}:${stories}` → uncapped gross; one per session (dataset-scoped). The cap never enters it. */
export type GrossCache = Map<string, number>;

export interface YieldRecompute {
  readonly total: number;
  readonly done: number;
  /** Cell ids of needs whose record is not yet available. */
  cellsNeeded(): string[];
  /** Computes ready needs in need order until the budget is spent; true when done === total. */
  step(budgetMs: number): boolean;
  /** Keyed by `needKey`; complete only after `step` returned true. */
  result(): ReadonlyMap<string, EnvelopeRow>;
}

export function createYieldRecompute(
  parcels: ScenarioParcels,
  needs: readonly Need[],
  deps: { record(id: ParcelId): ParcelRecord | undefined; now(): number },
  gross: GrossCache
): YieldRecompute {
  const unique = new Map<string, Need>();
  for (const n of needs) unique.set(needKey(n), n);
  const pending = [...unique.entries()];
  const out = new Map<string, EnvelopeRow>();
  const total = pending.length;
  const idOf = (row: number) => parcels.id[row] as ParcelId;

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
    cellsNeeded() {
      const cells = new Set<string>();
      for (const [key, n] of pending)
        if (!out.has(key) && !deps.record(idOf(n.row)))
          cells.add(parcels.cells[parcels.cell[n.row]].cellId);
      return [...cells];
    },
    step(budgetMs) {
      const start = deps.now();
      let computed = 0;
      for (const [key, n] of pending) {
        if (out.has(key)) continue;
        if (computed > 0 && deps.now() - start >= budgetMs) break;
        const rec = deps.record(idOf(n.row));
        if (!rec) continue;
        out.set(key, compute(n, rec));
        computed++;
      }
      return out.size === total;
    },
    result: () => out
  };
}
