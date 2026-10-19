// `simulate(input, seed, horizon)` (T5), its detailed form and the band-run fast path
// `simulateNet` (spec §2 "Internal types", §4.4.7), all over one `runEngine`. Pure and
// deterministic: the same input, seed and horizon give the same output.
import type { Day } from '$lib/timelapse/time';
import type { ExitReason, Pathway, Stage } from '$lib/timelapse/types';
import { runEngine } from './engine';
import { addNet, monthIndexer, type NetAcc, type NetSeries } from './score';
import type { Schedule, SimInput, Simulate } from './types';

// prettier-ignore
export interface Master { // a multi-phase row with `phases`; never drawn, never a Schedule
  masterId: string; pathway: Pathway; entered: Partial<Record<Stage, Day>> /* Planning-side only */;
  end: { kind: 'entitled'; day: Day } | { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } | { kind: 'open' };
  phaseUnits: number[]; phaseFiled: (Day | null)[] /* permitFiled day of each phase, null = not by horizon */;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every Schedule (pipeline first, phases included, then simulated; each sorted by `projectId`)
 * and every Master (sorted by `masterId`) of one run.
 */
export function simulateDetailed(
  input: SimInput,
  seed: number,
  horizon: Day
): { schedules: Schedule[]; masters: Master[] } {
  const pipeline: Schedule[] = [];
  const simulated: Schedule[] = [];
  const masters: Master[] = [];
  runEngine(input, seed, horizon, {
    schedule(s) {
      (s.origin === 'pipeline' ? pipeline : simulated).push(s);
    },
    master(m) {
      masters.push(m);
    }
  });
  pipeline.sort((a, b) => cmp(a.projectId, b.projectId));
  simulated.sort((a, b) => cmp(a.projectId, b.projectId));
  masters.sort((a, b) => cmp(a.masterId, b.masterId));
  return { schedules: [...pipeline, ...simulated], masters };
}

/** T5: `simulateDetailed(input, seed, horizon).schedules`. */
export const simulate: Simulate = (input, seed, horizon) =>
  simulateDetailed(input, seed, horizon).schedules;

/** The day → month table per `months` array (band runs share one), checked against `horizon`. */
const indexers = new WeakMap<Day[], { horizon: Day; idx: (d: Day) => number }>();

function indexerOf(months: Day[], horizon: Day): (d: Day) => number {
  const hit = indexers.get(months);
  if (hit && hit.horizon === horizon) return hit.idx;
  const idx = monthIndexer(months, horizon);
  indexers.set(months, { horizon, idx });
  return idx;
}

/**
 * The band-run fast path (§4.4.7): `completedNet`, `completedNetNew` and `entitledNew` per month,
 * equal to `netOf(shownSeries(simulateDetailed(input, seed, horizon), asOf, horizon, months))`.
 * The same engine runs (same merge, holds and demolished-once rule), but each Schedule is folded
 * into the per-month deltas by the score's own `addNet` as it is made and then dropped: nothing
 * is collected or sorted, and Masters are ignored (they add nothing to these series). The month
 * table is cached per `months` array, which callers must not mutate. The three returned arrays
 * are the run's own.
 */
export function simulateNet(input: SimInput, seed: number, horizon: Day, months: Day[]): NetSeries {
  const n = months.length;
  // the deltas accumulate in the output arrays (pipeline completions in completedNet), and a
  // prefix sum then turns them into the cumulative series in place
  const completedNet = new Int32Array(n);
  const completedNetNew = new Int32Array(n);
  const entitledNew = new Int32Array(n);
  const acc: NetAcc = {
    idx: indexerOf(months, horizon),
    pipeline: completedNet,
    fresh: completedNetNew,
    entitled: entitledNew
  };
  const asOf = input.asOf;
  runEngine(input, seed, horizon, {
    ids: false, // addNet reads neither projectId nor parcelIds
    schedule(s) {
      addNet(acc, s, asOf);
    },
    master() {}
  });
  let pipeline = 0;
  let fresh = 0;
  let entitled = 0;
  for (let i = 0; i < n; i++) {
    pipeline += completedNet[i];
    fresh += completedNetNew[i];
    entitled += entitledNew[i];
    completedNet[i] = pipeline + fresh;
    completedNetNew[i] = fresh;
    entitledNew[i] = entitled;
  }
  return { completedNet, completedNetNew, entitledNew };
}
