// Paired-draw fix, acceptance 3: a timing-only lever never loses a completed home. For every
// (pathway, timed stage) with a mini transition, a timer that speeds the stage up (s = 12/23 or
// 0.5, reach 'new' or 'all') is run against the 'fzp' twin on the mini city with today's market
// steps on, seeds 1-40, every month to the horizon. Ported from the market-baseline R1 pairing
// harness (there, on the rescaled-calibration engine, plan − twin reached −1,033 homes).
//
// What is asserted, per (cell, scale, reach), for every row, pipeline and simulated alike (keyed
// by project id; a simulated id is `sim:<parcel>:<k>`, engine.ts:982):
// - Every row is in both runs (a timing-only lever leaves the initiation draws alone; see the
//   second exception below), ends the same way in both (complete, exit and its stage and reason,
//   or open at the horizon only where the twin is also unfinished there), has the same existing
//   homes, and enters every stage no later than in the twin. So no kind ever flips.
// - Completions (`addNet` with the demolitions left out): plan − twin >= 0 in every month of every
//   seed. No exception.
// - `completedNet`: plan − twin >= 0 in every month, with one exception, by mechanism rather than
//   by (cell, scale, reach, seed) because it shows on most seeds of most cells (up to 979 of the
//   11,640 seed-months of a case; measured worst −8 homes on the mini city):
//
//   EXCEPTION (demolition brought forward). `addNet` (src/lib/sim/scenario/score.ts:134)
//   subtracts a project's existing homes in the month it enters construction and adds its
//   homes in the month it completes. A faster stage brings both forward, so between the plan's
//   construction entry and the twin's, the plan has demolished and not yet rebuilt: plan − twin
//   = −existingUnits there. It is the scoring of demolitions, outside stage sampling, and never a
//   kind flip. The test bounds it by exactly that mechanism: in month m, the plan's extra
//   demolitions (plan − twin of completions minus `completedNet`) are at most the existing homes
//   of the rows that entered construction (after asOf) by month m in the plan and not yet in the
//   twin. With completions not behind, that gives completedNet plan − twin >= −that bound.
//
// - One more exception, on rows: a simulated project in the plan only, on a lot the plan freed
//   earlier (see `freedEarlier`).
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

type Run = { net: Int32Array; gross: Int32Array; rows: Map<string, Schedule>; dupes: string[] };

function runOf(input: SimInput, seed: number): Run {
  const n = months.length;
  const acc: NetAcc = {
    idx: monthIndexer(months, H),
    pipeline: new Int32Array(n),
    fresh: new Int32Array(n),
    entitled: new Int32Array(n)
  };
  const rows = new Map<string, Schedule>();
  const dupes: string[] = [];
  for (const sc of simulateDetailed(input, seed, H).schedules) {
    // completions only: `addNet` with no existing homes to demolish
    addNet(acc, { ...sc, existingUnits: 0 }, input.asOf);
    if (rows.has(sc.projectId)) dupes.push(sc.projectId);
    rows.set(sc.projectId, sc);
  }
  const gross = new Int32Array(n);
  let c = 0;
  for (let i = 0; i < n; i++) gross[i] = c += acc.pipeline[i] + acc.fresh[i];
  return { net: simulateNet(input, seed, H, months).completedNet, gross, rows, dupes };
}

/** The twin's runs per seed, computed once for the file (every case shares the 'fzp' twin). */
let twinRuns: Run[] | undefined;

/** Why row `a` (plan) is not `b` (twin) moved earlier with the same outcome, or null. */
function rowFault(a: Schedule | undefined, b: Schedule | undefined): string | null {
  if (a === undefined || b === undefined) return `in the ${a ? 'plan' : 'twin'} only`;
  if (a.existingUnits !== b.existingUnits) return 'different existing homes';
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

/**
 * The day `run` frees `parcel` for its simulated project k: the end of `sim:<parcel>:<k − 1>`, or
 * for k = 0 the last exit of the in-flight rows on it (engine.ts:1047, `r = max(asOf, lastExit)`).
 * Null when nothing held it (free at asOf) or a holder did not exit.
 */
function freedOn(run: Run, parcel: string, k: number): number | null {
  if (k > 0) {
    const prev = run.rows.get(`sim:${parcel}:${k - 1}`);
    return prev?.end.kind === 'exit' ? prev.end.day : null;
  }
  let last: number | null = null;
  for (const sc of run.rows.values()) {
    if (sc.origin !== 'pipeline' || !sc.parcelIds.includes(parcel)) continue;
    if (sc.end.kind !== 'exit') return null;
    last = Math.max(last ?? sc.end.day, sc.end.day);
  }
  return last;
}

/**
 * EXCEPTION 2 (a freed lot re-initiating earlier). A simulated project in the plan only is allowed
 * when the plan freed its lot earlier than the twin did: the same initiation draw then lands an
 * earlier day (the risk starts at the release, engine.ts:1047), before the horizon in the plan
 * and after it in the twin. Measured on the mini city: one id, `sim:0026T003:0` on seed 28, in
 * the two discretionary.filed 'all' cases (PRJ:2025-000102PRJ withdraws from `filed` on day 21083
 * at ×0.5 and 21097 at ×12/23, against 21423 in the twin; the plan's project starts on day 29340,
 * horizon 29584, and withdraws). It is checked like any plan row for completions and
 * demolitions; a simulated id in the twin only is never allowed.
 */
function freedEarlier(id: string, plan: Run, twin: Run): boolean {
  const m = /^sim:(.+):(\d+)$/.exec(id);
  if (m === null) return false;
  const k = Number(m[2]);
  const p = freedOn(plan, m[1], k);
  const t = freedOn(twin, m[1], k);
  return p !== null && t !== null && p < t;
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
          const idx = monthIndexer(months, H);
          for (let i = 0; i < SEEDS.length; i++) {
            const seed = SEEDS[i];
            const a = runOf(plan, seed);
            const b = twinRuns[i];
            for (const id of [...a.dupes, ...b.dupes]) misses.push({ seed, what: `${id}: twice` });
            // B[m]: existing homes of the rows the plan demolishes by month m and the twin not yet
            const early = new Int32Array(months.length + 1);
            for (const id of new Set([...a.rows.keys(), ...b.rows.keys()])) {
              const x = a.rows.get(id);
              const y = b.rows.get(id);
              const fault = y === undefined && freedEarlier(id, a, b) ? null : rowFault(x, y);
              if (fault !== null) misses.push({ seed, what: `${id}: ${fault}` });
              const c = x?.entered.construction;
              if (x === undefined || c === undefined || c <= base.asOf) continue;
              const from = idx(c);
              const cy = y?.entered.construction;
              const to = cy === undefined ? months.length : idx(cy);
              if (from < to) {
                early[from] += x.existingUnits;
                early[to] -= x.existingUnits;
              }
            }
            let bound = 0;
            for (let m = 0; m < months.length; m++) {
              bound += early[m];
              const gross = a.gross[m] - b.gross[m];
              if (gross < 0) misses.push({ seed, month: m, what: `completions ${gross}` });
              const net = a.net[m] - b.net[m];
              const extra = gross - net; // the plan's extra demolitions by month m
              if (extra > bound) {
                misses.push({
                  seed,
                  month: m,
                  what: `demolitions +${extra} > brought forward ${bound}`
                });
              }
            }
          }
          expect(misses.slice(0, 10)).toEqual([]);
        });
      }
    }
  }
});
