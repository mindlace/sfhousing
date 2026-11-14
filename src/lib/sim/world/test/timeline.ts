import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import { MAX_SCALE, MIN_SCALE } from '$lib/sim/levers/types';
import type { StageScale } from '$lib/sim/levers/timers';
import { precomputeOf } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Calibration, type MarketStep } from '$lib/timelapse/types';
import type { FinanceFrame, PolicyFrame, PolicyTimeline, ZoningView } from '../policy/frame';

export const IDENTITY: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };

const views = new WeakMap<SimInput, ZoningView>();

/** The zoning view of an input's own lots, memoised by input. */
export function viewOf(input: SimInput): ZoningView {
  let v = views.get(input);
  if (!v) {
    v = { parcels: input.parcels, pre: precomputeOf(input) };
    views.set(input, v);
  }
  return v;
}

/** The log-odds of the last market step with `from <= day`; 0 without one. */
export function marketAt(input: SimInput, day: Day): number {
  let out = 0;
  for (const s of input.market ?? []) if (s.from <= day) out = s.logOdds;
  return out;
}

export interface FrameOpts {
  id?: number;
  view?: ZoningView;
  market?: number;
  speed?: StageScale;
  speedNew?: { from: Day; scale: StageScale }[];
  newCalibration?: Calibration;
  finance?: FinanceFrame | null;
}

export function frameOf(input: SimInput, o: FrameOpts = {}): PolicyFrame {
  return {
    id: o.id ?? 0,
    view: o.view ?? viewOf(input),
    calibration: input.calibration,
    newCalibration: o.newCalibration ?? input.calibration,
    speed: o.speed ?? IDENTITY,
    speedNew: o.speedNew ?? [],
    market: o.market ?? marketAt(input, input.asOf),
    finance: o.finance ?? null
  };
}

/** One frame for every month. */
export function oneFrame(f: PolicyFrame): PolicyTimeline {
  return {
    frameAt: () => f,
    changes: () => [],
    touched: () => new Int32Array(0),
    readyThrough: () => Number.MAX_SAFE_INTEGER
  };
}

/** `before` through month `m - 1`, `after` from month `m`. */
export function changingAt(
  m: number,
  before: PolicyFrame,
  after: PolicyFrame,
  touched: Int32Array | null
): PolicyTimeline {
  return {
    frameAt: (month) => (month >= m ? after : before),
    changes: () => (before.id !== after.id ? [m] : []),
    touched: () => touched,
    readyThrough: () => Number.MAX_SAFE_INTEGER
  };
}

/** The same frames, ready only through `through()`. */
export function limited(t: PolicyTimeline, through: () => number): PolicyTimeline {
  return {
    frameAt(month) {
      if (month > through()) throw new RangeError(`month ${month} is past ${through()}`);
      return t.frameAt(month);
    },
    changes: () => t.changes(),
    touched: (month) => t.touched(month),
    readyThrough: through
  };
}

const clamp = (x: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, x));

/** Per stage, `clamp((a ?? 1) * (b ?? 1))`, in that order. */
export function scaleProduct(a: StageScale, b: StageScale): StageScale {
  const out: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };
  for (const p of PATHWAYS) {
    const stages = new Set([...Object.keys(a[p]), ...Object.keys(b[p])]) as Set<
      keyof StageScale[typeof p]
    >;
    for (const s of stages) out[p][s] = clamp((a[p][s] ?? 1) * (b[p][s] ?? 1));
  }
  return out;
}

export interface OldOpts {
  inFlightScale?: StageScale;
  newScale?: StageScale;
  newCalibration?: Calibration;
  market?: MarketStep[];
  regimes?: { day: Day; parcels: ScenarioParcels }[];
}

/** The input today's engine runs for the same policy (Open question 4: `newProjects` always set). */
export function oldInputOf(base: SimInput, o: OldOpts = {}): SimInput {
  return {
    ...base,
    newProjects: {
      calibration: o.newCalibration ?? base.calibration,
      scale: o.newScale ?? IDENTITY
    },
    ...(o.inFlightScale ? { inFlightScale: o.inFlightScale } : {}),
    ...(o.market ? { market: o.market } : {}),
    ...(o.regimes ? { regimes: o.regimes } : {})
  };
}

/** Every timed stage of every route scaled by `v`. */
export function everyStage(v: number): StageScale {
  const out = { discretionary: {}, streamlined: {}, permitOnly: {} } as Record<
    string,
    Record<string, number>
  >;
  for (const p of PATHWAYS) for (const s of STAGE_ORDER) if (s !== 'complete') out[p][s] = v;
  return out as unknown as StageScale;
}

const F = FILL_LEVELS.length;

/** A copy of `input.parcels` upzoned on `rows`; every other column is shared. */
export function upzoned(input: SimInput, rows: Int32Array): ScenarioParcels {
  const p = input.parcels;
  const yieldCol = p.yield.slice();
  const envelopeStories = p.envelopeStories.slice();
  const fzp = p.potentialRatio.fzp.slice();
  const localProgram = p.localProgram.slice();
  for (const r of rows) {
    for (let k = 0; k < F; k++) yieldCol[r * F + k] = Math.min(65535, yieldCol[r * F + k] * 2);
    envelopeStories[r] = Math.min(255, envelopeStories[r] + 2);
    fzp[r] *= 1.5;
    localProgram[r] = localProgram[r] ? 0 : 1;
  }
  return {
    ...p,
    yield: yieldCol,
    envelopeStories,
    localProgram,
    potentialRatio: { ...p.potentialRatio, fzp }
  };
}

/** The rows where any column `upzoned` changes differs. */
export function touchedRows(a: ScenarioParcels, b: ScenarioParcels): Int32Array {
  const out: number[] = [];
  for (let r = 0; r < a.count; r++) {
    let differs =
      a.envelopeStories[r] !== b.envelopeStories[r] ||
      a.localProgram[r] !== b.localProgram[r] ||
      a.potentialRatio.fzp[r] !== b.potentialRatio.fzp[r];
    for (let k = 0; !differs && k < F; k++) differs = a.yield[r * F + k] !== b.yield[r * F + k];
    if (differs) out.push(r);
  }
  return Int32Array.from(out);
}
