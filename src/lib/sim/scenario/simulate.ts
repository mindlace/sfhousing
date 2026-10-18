// `simulate(input, seed, horizon)` (T5) and its detailed form (spec §2 "Internal types",
// §4.4.7). Pure and deterministic: the same input, seed and horizon give the same output.
import type { Day } from '$lib/timelapse/time';
import type { ExitReason, Pathway, Stage } from '$lib/timelapse/types';
import { runEngine } from './engine';
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
