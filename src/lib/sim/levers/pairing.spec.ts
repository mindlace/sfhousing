// Paired-draw fix, acceptance 3: a timing-only lever never loses a completed home. For every
// (pathway, timed stage) with a mini transition, a timer that speeds the stage up (s = 12/23 or
// 0.5, reach 'new' or 'all') is run against the 'fzp' twin on the mini city with today's market
// steps on, seeds 1-40, every month to the horizon. Ported from the market-baseline R1 pairing
// harness (there, on the rescaled-calibration engine, plan − twin reached −1,033 homes).
//
// What is asserted, per (cell, scale, reach):
// - Completions (`addNet` with the demolitions left out): plan − twin >= 0 in every month of every
//   seed. No exception.
// - Every pipeline row (keyed by project id) ends the same way in both arms (complete, exit and
//   its stage and reason, or open at the horizon only where the twin is also unfinished there),
//   and enters every stage no later than in the twin. So no kind ever flips.
// - `completedNet`: plan − twin >= 0 in every month, with one exception, by mechanism rather than
//   by (cell, scale, reach, seed) because it shows on most seeds of most cells (up to 979 of the
//   11,640 seed-months of a case, never below −8 homes):
//
//   EXCEPTION (demolition brought forward). `addNet` (src/lib/sim/scenario/score.ts:134)
//   subtracts a project's existing homes in the month it enters construction and adds its
//   homes in the month it completes. A faster stage brings both forward, so between the plan's
//   construction entry and the twin's, the plan has demolished and not yet rebuilt: plan − twin
//   = −existingUnits there. It is the scoring of demolitions, outside stage sampling, and never a
//   kind flip. A negative `completedNet` month is allowed only where the completions are not
//   behind (so the shortfall is wholly demolitions that came earlier), which the test asserts.
import { describe, expect, it } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import { STAGE_ORDER, type Calibration, type Transition } from '$lib/timelapse/types';
import miniCalibrationJson from '../scenario/fixtures/mini-calibration.json';
import { miniMarket } from '../scenario/fixtures/mini-market';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { miniPolicy } from '../scenario/fixtures/mini-policy';
import { MINI_HORIZON, miniProjectsJson } from '../scenario/fixtures/mini-projects';
import { buildSimInput } from '../scenario/input';
import { addNet, monthIndexer, monthsOf, type NetAcc } from '../scenario/score';
import { simulateDetailed, simulateNet } from '../scenario/simulate';
import type { Schedule, SimInput } from '../scenario/types';
import { applyLevers } from './apply';
import type { LayerCtx } from './layers';
import { fillNeeds, resolveEnvelopes } from './resolve';
import { DEFAULT_LEVERS, type SimLevers, type TimedStage, type TimerEdit } from './types';

const H = MINI_HORIZON;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const TIMED: readonly TimedStage[] = [
  'preApplication',
  'filed',
  'entitled',
  'permitFiled',
  'permitIssued'
];

const city = miniCity();
const calibration: Calibration = {
  ...parseCalibration(structuredClone(miniCalibrationJson) as unknown),
  market: miniMarket()
};
const base = buildSimInput({
  parcels: city.parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration
});
const ctx: LayerCtx = { parcels: city.parcels, policy: miniPolicy(city) };
const months = monthsOf(base.asOf, H);

const cells: [TimerEdit['pathway'], TimedStage][] = [];
for (const [p, stages] of Object.entries(base.calibration.transitions)) {
  for (const s of TIMED) {
    if ((stages as Record<string, Transition | undefined>)[s]) {
      cells.push([p as TimerEdit['pathway'], s]);
    }
  }
}

function compile(timer: TimerEdit) {
  const levers: SimLevers = {
    ...structuredClone(DEFAULT_LEVERS),
    compare: 'fzp',
    timers: [timer]
  };
  const filled = fillNeeds(resolveEnvelopes(ctx, levers, base.asOf), new Map());
  return applyLevers(base, ctx, levers, filled);
}

type Run = { net: Int32Array; gross: Int32Array; rows: Map<string, Schedule> };

function runOf(input: SimInput, seed: number): Run {
  const n = months.length;
  const acc: NetAcc = {
    idx: monthIndexer(months, H),
    pipeline: new Int32Array(n),
    fresh: new Int32Array(n),
    entitled: new Int32Array(n)
  };
  const rows = new Map<string, Schedule>();
  for (const sc of simulateDetailed(input, seed, H).schedules) {
    // completions only: `addNet` with no existing homes to demolish
    addNet(acc, { ...sc, existingUnits: 0 }, input.asOf);
    if (sc.origin === 'pipeline') rows.set(sc.projectId, sc);
  }
  const gross = new Int32Array(n);
  let c = 0;
  for (let i = 0; i < n; i++) gross[i] = c += acc.pipeline[i] + acc.fresh[i];
  return { net: simulateNet(input, seed, H, months).completedNet, gross, rows };
}

/** The twin's runs per seed, computed once for the file (every case shares the 'fzp' twin). */
let twinRuns: Run[] | undefined;

/** Why pipeline row `a` (plan) is not `b` (twin) moved earlier with the same outcome, or null. */
function rowFault(a: Schedule | undefined, b: Schedule | undefined): string | null {
  if (a === undefined || b === undefined) return 'present in one arm only';
  for (const st of STAGE_ORDER) {
    const x = a.entered[st];
    const y = b.entered[st];
    if (y !== undefined && (x === undefined || x > y)) return `enters ${st} later or not at all`;
  }
  if (a.end.kind === 'open') return b.end.kind === 'open' ? null : `open, twin ${b.end.kind}`;
  if (b.end.kind === 'open') return null; // finished before the horizon, the twin after it
  if (a.end.kind !== b.end.kind) return `${a.end.kind}, twin ${b.end.kind}`;
  if (a.end.kind === 'exit' && b.end.kind === 'exit') {
    if (a.end.stage !== b.end.stage || a.end.reason !== b.end.reason) return 'exits differently';
  }
  return a.end.day > b.end.day ? 'ends later' : null;
}

type Miss = { seed: number; month?: number; what: string };

describe('pairing under a timing-only lever (acceptance 3)', () => {
  it('has the 13 mini cells and today’s market', () => {
    expect(cells).toHaveLength(13);
    expect(base.market).toBeDefined();
  });

  for (const [pathway, stage] of cells) {
    for (const scale of [12 / 23, 0.5]) {
      for (const reach of ['new', 'all'] as const) {
        it(`${pathway}.${stage} ×${scale.toFixed(3)} reach ${reach}`, () => {
          const { plan, twin } = compile({ pathway, stage, scale, reach });
          twinRuns ??= SEEDS.map((seed) => runOf(twin, seed));
          const misses: Miss[] = [];
          for (let i = 0; i < SEEDS.length; i++) {
            const seed = SEEDS[i];
            const a = runOf(plan, seed);
            const b = twinRuns[i];
            for (let m = 0; m < months.length; m++) {
              const gross = a.gross[m] - b.gross[m];
              if (gross < 0) misses.push({ seed, month: m, what: `completions ${gross}` });
              // the demolition-brought-forward exception: allowed only with completions not behind
              const net = a.net[m] - b.net[m];
              if (net < 0 && gross < 0)
                misses.push({ seed, month: m, what: `completedNet ${net}` });
            }
            for (const id of new Set([...a.rows.keys(), ...b.rows.keys()])) {
              const fault = rowFault(a.rows.get(id), b.rows.get(id));
              if (fault !== null) misses.push({ seed, what: `${id}: ${fault}` });
            }
          }
          expect(misses.slice(0, 10)).toEqual([]);
        });
      }
    }
  }
});
