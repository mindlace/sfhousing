// Compile contexts and fake yields on the mini city for the policy compiler's specs. Test values,
// not data.
import type { EnvelopeRow } from '$lib/data/envelope-row';
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, type ScenarioParcels } from '$lib/data/scenario-codec';
import type { LayerCtx } from '$lib/sim/levers/layers';
import type { YieldRecompute } from '$lib/sim/levers/recompute';
import { needKey, type Need } from '$lib/sim/levers/resolve';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { miniPolicy } from '$lib/sim/scenario/fixtures/mini-policy';
import { miniProjectsJson } from '$lib/sim/scenario/fixtures/mini-projects';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { buildSimInput } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { CompileCtx } from '../compile';
import type { YieldSource } from '../zoning-view';

/** A clock the fakes advance: `now()` reads `t`. */
export interface FakeClock {
  t: number;
  now(): number;
}

export function fakeClock(): FakeClock {
  const c: FakeClock = { t: 0, now: () => c.t };
  return c;
}

/** The fake yield of one need: `(f + 1) × stories` per fill level, hostable. */
export const fakeRow = (n: Need): EnvelopeRow => ({
  stories: n.stories,
  cap: n.cap,
  yield: FILL_LEVELS.map((_, f) => (f + 1) * n.stories),
  hostable: true
});

/** The rows `fakeYields` gives, keyed by `needKey`: the reference path's `fillNeeds` input. */
export function fakeRows(needs: readonly Need[]): Map<string, EnvelopeRow> {
  return new Map(needs.map((n) => [needKey(n), fakeRow(n)]));
}

/**
 * A `YieldSource` that computes `fakeRow` one need per work unit, as `createTableRecompute`
 * steps (at least one need, then until the budget is spent). Each need advances `clock` by 1
 * (an internal clock when none is given). No cells, none failed.
 */
export function fakeYields(clock: FakeClock = fakeClock()): YieldSource {
  return {
    recompute(_parcels: ScenarioParcels, needs: readonly Need[]): YieldRecompute {
      const unique = new Map<string, Need>();
      for (const n of needs) unique.set(needKey(n), n);
      const pending = [...unique];
      const out = new Map<string, EnvelopeRow>();
      let next = 0;
      return {
        total: unique.size,
        get done() {
          return out.size;
        },
        missing: [],
        cellsNeeded: () => [],
        step(budgetMs) {
          const start = clock.now();
          let computed = 0;
          while (next < pending.length) {
            if (computed > 0 && clock.now() - start >= budgetMs) break;
            const [key, n] = pending[next++];
            out.set(key, fakeRow(n));
            clock.t += 1;
            computed++;
          }
          return out.size === unique.size;
        },
        result: () => out
      };
    },
    failedCells: () => []
  };
}

/** A `YieldSource` whose needs wait on their lot's cell, with a count of `step` calls. */
export interface CellYields extends YieldSource {
  /** Cells whose chunks have arrived; the test adds to it. */
  loaded: Set<string>;
  /** `YieldRecompute.step` calls over every recompute made. */
  steps: number;
}

/**
 * As `fakeYields`, but a need is computed only once its lot's cell is in `loaded` (as
 * `createYieldRecompute` visits only loaded cells), so with none loaded `step` makes no progress.
 * `failedCells()` reports `failed`; each finished recompute with needs reports `missing` as its
 * lots without a record.
 */
export function cellYields(
  clock: FakeClock,
  opts: { failed?: string[]; missing?: ParcelId[] } = {}
): CellYields {
  const src: CellYields = {
    loaded: new Set(),
    steps: 0,
    recompute(parcels: ScenarioParcels, needs: readonly Need[]): YieldRecompute {
      const cellOf = (n: Need) => parcels.cells[parcels.cell[n.row]].cellId;
      const unique = new Map<string, Need>();
      for (const n of needs) unique.set(needKey(n), n);
      const out = new Map<string, EnvelopeRow>();
      const pending = () => [...unique].filter(([k]) => !out.has(k));
      return {
        total: unique.size,
        get done() {
          return out.size;
        },
        get missing() {
          return unique.size > 0 && out.size === unique.size ? (opts.missing ?? []) : [];
        },
        cellsNeeded: () => [
          ...new Set(pending().flatMap(([, n]) => (src.loaded.has(cellOf(n)) ? [] : [cellOf(n)])))
        ],
        step(budgetMs) {
          src.steps++;
          const start = clock.now();
          let computed = 0;
          for (const [key, n] of pending()) {
            if (computed > 0 && clock.now() - start >= budgetMs) break;
            if (!src.loaded.has(cellOf(n))) continue;
            out.set(key, fakeRow(n));
            clock.t += 1;
            computed++;
          }
          return out.size === unique.size;
        },
        result: () => out
      };
    },
    failedCells: () => opts.failed ?? []
  };
  return src;
}

/** The mini city's input and layers (as `levers/apply.spec.ts` sets them up). */
export function miniInput(opts: { finance?: boolean; market?: boolean } = {}): {
  input: SimInput;
  layers: LayerCtx;
} {
  const city = miniCity();
  const plain = buildSimInput({
    parcels: city.parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown)
  });
  const input: SimInput = {
    ...plain,
    ...(opts.market ? { market: [{ from: plain.asOf, logOdds: miniMarket().today.all }] } : {}),
    ...(opts.finance ? { finance: miniFinance(plain.asOf) } : {})
  };
  return { input, layers: { parcels: city.parcels, policy: miniPolicy(city) } };
}

/** A compile context on the mini city with `fakeYields` on `clock` (default 24 months). */
export function miniCompileCtx(
  opts: { finance?: boolean; market?: boolean; windowMonths?: number; clock?: FakeClock } = {}
): CompileCtx {
  const { input, layers } = miniInput(opts);
  const clock = opts.clock ?? fakeClock();
  return {
    input,
    layers,
    windowMonths: opts.windowMonths ?? 24,
    yields: fakeYields(clock),
    now: clock.now
  };
}
