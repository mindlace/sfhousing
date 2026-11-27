// Assembling the SimInput from the decoded scenario files (spec §4.2 steps 5-6) and the
// per-input precompute (step 7): per cost step, each lot's choice expectations and initiation
// logit, then hazards and log(1 − h). Worker-safe and pure apart from the identity-keyed memos.
import { optionTableProblem, type OptionTable } from '$lib/data/option-table';
import type { ParcelId } from '$lib/data/parcel';
import { featureValue, type ScenarioParcels } from '$lib/data/scenario-codec';
import {
  allowedCount,
  capFrom,
  choiceCtxOf,
  choiceStepAt,
  expectations,
  featuresOf,
  type ChoiceCtx
} from '$lib/sim/choice/choose';
import { exp, log as ln } from '$lib/timelapse/math';
import { initiationLogit } from '$lib/timelapse/model';
import type { ProjectsFile } from '$lib/timelapse/projects';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { Calibration, FeatureId } from '$lib/timelapse/types';
import { isoOf } from '../dates';
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
import {
  FUNDING_WITHOUT_MARKET_WARNING,
  marketLevel,
  marketSteps,
  NO_MARKET_WARNING
} from './market';
import { simEntity } from '../rules/rng';
import type { SimInput } from './types';

type ScenarioFile = 'parcels.bin' | 'projects.json' | 'calibration.json' | 'options.bin';

/** A decoded file that cannot run: the host maps it to `scenario-invalid`. */
export class SimInputError extends Error {
  name = 'SimInputError';
  constructor(
    readonly file: ScenarioFile,
    message: string // the first problem
  ) {
    super(message);
  }
}

/**
 * The FZP SimInput (spec §4.2 step 6). Throws `SimInputError` when the calibration has no
 * choice model or height-time model, or the option table is not parcels.bin's. The run's `asOf`
 * is `projects.asOf`; a different `calibration.asOf` is logged once.
 */
export function buildSimInput(
  files: {
    parcels: ScenarioParcels;
    projects: ProjectsFile;
    calibration: Calibration;
    options: OptionTable;
  },
  warn?: (msg: string) => void
): SimInput {
  const { parcels, projects, calibration, options } = files;
  if (!calibration.choice) throw new SimInputError('calibration.json', 'no choice model (choice)');
  if (!calibration.heightTime) {
    throw new SimInputError('calibration.json', 'no height-time model (heightTime)');
  }
  const problem = optionTableProblem(options, parcels);
  if (problem !== null) throw new SimInputError('options.bin', problem);
  if (calibration.asOf !== projects.asOf) {
    warn?.(
      `calibration.json: asOf ${isoOf(calibration.asOf)} differs from projects.json asOf ` +
        `${isoOf(projects.asOf)}; the run uses ${isoOf(projects.asOf)}`
    );
  }
  if (!calibration.market) {
    warn?.(NO_MARKET_WARNING);
    if (calibration.baselineFunding) warn?.(FUNDING_WITHOUT_MARKET_WARNING);
  }
  const market = marketSteps(calibration.market, projects.asOf, marketLevel(calibration));
  const bf = calibration.baselineFunding;
  const m = calibration.market;
  return {
    parcels,
    options,
    projects: projects.projects,
    calibration,
    asOf: projects.asOf,
    districtMaxStories: projects.districtMaxStories?.stories ?? null,
    ...(market.length > 0 ? { market } : {}),
    ...(m && bf
      ? {
          finance: {
            pools: structuredClone(bf.pools),
            programmes: structuredClone(bf.programmes),
            off: [],
            slope: m.slope.perCostShare,
            terms: resolveTerms(MARKET_TERMS)
          }
        }
      : {})
  };
}

/** One cost step's choice columns (`Precompute.byStep`), per lot row of the input's parcels. */
export interface ChoiceStepColumns {
  /** The step's first day (`ChoiceCtx.from`). */
  from: Day;
  /** `expectations` at the envelope and cap against the existing homes; 0 where none gains. */
  expHomes: Float32Array;
  expStories: Float32Array;
  margin: Float32Array;
  /** 1 where the lot is hostable and some allowed option gains a home. */
  gains: Uint8Array;
  /** The best option's index in the lot's row (`expectations().best`), -1 where none gains. */
  best: Int32Array;
  /**
   * The unshifted initiation linear predictor on this step's choice features, -Infinity where the
   * row gets no hazard (not hostable, no gaining option, or a non-finite feature).
   */
  logit: Float64Array;
}

export interface Precompute {
  /**
   * monthly initiation hazard per parcel under `s0`, the market step in force at `asOf` (0 without
   * a market), and the cost step in force at `asOf`; 0 = never initiates
   */
  hazard: Float64Array;
  /** log(1 − hazard[i]) from math.ts */
  log1mh: Float64Array;
  /**
   * `byStep[choiceStep].logit`: the initiation linear predictor at the cost step in force at
   * `asOf` (no market step added; finance-engine spec 4.4 adds the step itself). Per view through
   * `regimes[v − 1].logit`.
   */
  logit: Float64Array;
  /** The choice context of the input's option table and calibration (`choiceCtxOf`). */
  choice: ChoiceCtx;
  /** The cost step in force at `asOf` (`choiceStepAt`). */
  choiceStep: number;
  /**
   * Per cost step of `choice.from` (the memo keyed by (lot, step)): the lot's choice expectations
   * and its logit on them.
   */
  byStep: ChoiceStepColumns[];
  /**
   * per later market step m (`from` > `asOf`), log(1 − hazard) under that step's shift at the
   * cost step in force at `asOf`; [] when none
   */
  stepLog1mh: Float64Array[];
  /**
   * log(1 − h) per row at cost step `c` under market step `m` (0 = the step in force at `asOf`,
   * m ≥ 1 = `stepLog1mh[m − 1]`'s): `log1mh` and `stepLog1mh` themselves at `choiceStep`,
   * memoised otherwise.
   */
  stepRates(c: number, m: number): Float64Array;
  /**
   * The merged segment list: `days` = regime days ∪ later market days ∪ later cost-step days,
   * ascending, equal days merged; for segment j (0 .. days.length) its regime view (0 = this
   * input's parcels) and its log1mh array, read at the market and cost steps in force on its first
   * day. Without later steps: days = regime days, view[j] = j, log1mh[j] =
   * j === 0 ? log1mh : regimes[j − 1].log1mh.
   */
  segments: { days: Day[]; view: number[]; log1mh: Float64Array[] };
  parcelIndexOf(id: ParcelId): number; // -1 if absent
  /**
   * the rows that can initiate (hostable, a gaining option, a hazard under some market or cost
   * step), ascending; with regimes, the rows that can initiate in any view
   */
  candidates: Int32Array;
  /** `simEntity` of each candidate's parcel id, index-aligned with `candidates` */
  entity: Uint32Array;
  /**
   * Per candidate, a bound on the first initiation draw `u = draw(INIT, k = 0)` for a parcel at
   * risk from `asOf`: when u exceeds it, that initiation is certainly after `horizon`
   * (`initiationDay` would return null). Infinity where no safe bound exists. A cost shortcut
   * only: every u at or below the bound goes through the exact computation.
   */
  skipAbove(horizon: Day): Float64Array;
  /**
   * With `regimes`, each view's own precompute (`regimeInputsOf`, so its `regimes` is []),
   * memoised by input; `candidates` above are then the union, in row order, of every view's
   * candidates. [] without regimes.
   */
  regimes: Precompute[];
}

/** The choice context of `input`: its option table under its calibration's choice models. */
export function choiceCtxFor(input: SimInput): ChoiceCtx {
  const { choice, heightTime } = input.calibration;
  if (!choice || !heightTime) {
    throw new SimInputError('calibration.json', 'no choice or height-time model');
  }
  return choiceCtxOf(input.options, choice, heightTime);
}

const memo = new WeakMap<SimInput, Precompute>();
const regimeInputs = new WeakMap<SimInput, SimInput[]>();
const NO_INPUTS: SimInput[] = [];

/**
 * One input per entry of `input.regimes`, with that view as its parcels and no regimes of its
 * own, memoised by input; [] without regimes.
 */
export function regimeInputsOf(input: SimInput): SimInput[] {
  if (!input.regimes || input.regimes.length === 0) return NO_INPUTS;
  let a = regimeInputs.get(input);
  if (!a) {
    const { regimes, ...rest } = input;
    a = regimes.map((g) => ({ ...rest, parcels: g.parcels }));
    regimeInputs.set(input, a);
  }
  return a;
}

/** `simEntity` per row, shared by every input over the same id column (the twin's view too). */
const entities = new WeakMap<readonly ParcelId[], { hash: Uint32Array; done: Uint8Array }>();

function entityOf(ids: readonly ParcelId[], i: number): number {
  let e = entities.get(ids);
  if (!e) {
    e = { hash: new Uint32Array(ids.length), done: new Uint8Array(ids.length) };
    entities.set(ids, e);
  }
  if (e.done[i] === 0) {
    e.hash[i] = simEntity(ids[i]);
    e.done[i] = 1;
  }
  return e.hash[i];
}

/** Each row's position among the rows sorted by parcel id (`<`), memoised by the id column. */
const ranks = new WeakMap<readonly ParcelId[], Uint32Array>();

/**
 * Each row's rank when the rows are sorted by parcel id with the JavaScript string order (`<`):
 * the line's third key (finance-engine spec 4.4). Memoised by the id array, so the plan, the twin
 * and every regime view share one.
 */
export function parcelRankOf(ids: readonly ParcelId[]): Uint32Array {
  let rank = ranks.get(ids);
  if (!rank) {
    const order = Array.from(ids.keys()).sort((a, b) =>
      ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : a - b
    );
    rank = new Uint32Array(ids.length);
    order.forEach((i, pos) => (rank![i] = pos));
    ranks.set(ids, rank);
  }
  return rank;
}

/**
 * The last geometric month T whose earliest initiation day from `asOf` (v → 0 in §4.4.4 step 2,
 * `asOf + 1 + floor((T − 1) × MONTH_DAYS)`, as the engine evaluates it) is on or before the
 * horizon; 0 when even T = 1 is after it.
 */
export function lastInitiationMonth(asOf: Day, horizon: Day): number {
  const earliest = (T: number) => asOf + 1 + Math.floor((T - 1) * MONTH_DAYS);
  if (earliest(1) > horizon) return 0;
  let T = Math.max(1, Math.floor((horizon - asOf - 1) / MONTH_DAYS));
  while (T > 1 && earliest(T) > horizon) T--;
  while (earliest(T + 1) <= horizon) T++;
  return T;
}

/**
 * Per regime day, the number of initiation months from `r` that start before it (plan 2 ruling
 * 1, generalised): month T starts on `r + 1 + floor((T − 1)·MONTH_DAYS)`, and
 * `T_k = lastInitiationMonth(r, days[k] − 1)`. Month T runs on view j when
 * `T_(j−1) < T ≤ T_j` (view 0 up to `T_0`, the last view after the last bound).
 */
export function regimeMonths(r: Day, days: readonly Day[]): number[] {
  return days.map((d) => lastInitiationMonth(r, d - 1));
}

/**
 * The initiation month for L = log(1 − u) under a piecewise-constant hazard (ruling 1,
 * generalised): segment j covers months (bounds[j − 1], bounds[j]] (from 0; the last is
 * unbounded) at log-survival rate `rates[j]` (length bounds.length + 1). Walking the segments with
 * `acc` = Σ months·rate so far, it returns `a + max(1, ceil((L − acc) / l))` for the first
 * segment (starting after month a, rate l < 0) where that is ≤ its end; 0 = never. An empty
 * segment adds nothing (no 0 · −Infinity). With no bounds it is exactly `max(1, ceil(L / l0))`.
 */
export function piecewiseMonth(
  L: number,
  bounds: readonly number[],
  rates: readonly number[]
): number {
  const K = bounds.length;
  let acc = 0;
  let a = 0;
  for (let j = 0; j <= K; j++) {
    const end = j < K ? bounds[j] : Infinity;
    if (!(end > a)) continue;
    const l = rates[j];
    if (l < 0) {
      const T = a + Math.max(1, Math.ceil((L - acc) / l));
      if (T <= end) return T;
    }
    acc += (end - a) * l;
    a = end;
  }
  return 0;
}

/**
 * The `skipAbove` bounds (see `Precompute`). With T = max(1, ceil(log(1 − u) / log1mh)), the
 * initiation is after the horizon exactly when T > Tmax (`lastInitiationMonth`), that is when
 * u > u* = 1 − (1 − h)^Tmax = 1 − exp(Tmax · log1mh). The bound is u* widened by a relative
 * 1e-6 plus an absolute 1e-12 (u*·(1 + 1e-6) + 1e-12), far above every rounding error of the
 * exact path's `1 − u`, `log` and division and of u* itself, for any u* above 1e-6; below
 * that no bound is used. With segments (regimes or later market steps: `bounds` =
 * `regimeMonths(asOf, segments.days)`, `views[j]` the log1mh of segment j), the piecewise hazard
 * gives u* = 1 − exp(Σ n_j·l_j), n_j the months of 1..Tmax in segment j, with the same widening.
 */
export function skipBounds(
  views: readonly Float64Array[],
  candidates: Int32Array,
  Tmax: number,
  bounds: readonly number[]
): Float64Array {
  const out = new Float64Array(candidates.length).fill(Infinity);
  if (Tmax < 1) return out;
  const K = bounds.length;
  const n = new Array<number>(K + 1);
  for (let j = 0; j <= K; j++) {
    const start = j === 0 ? 0 : bounds[j - 1];
    const end = j < K ? bounds[j] : Infinity;
    n[j] = Math.max(0, Math.min(Tmax, end) - start);
  }
  for (let c = 0; c < candidates.length; c++) {
    const i = candidates[c];
    // a zero month count adds nothing (and keeps 0 · −Infinity out of the sum)
    let s = n[0] > 0 ? n[0] * views[0][i] : 0;
    for (let j = 1; j <= K; j++) if (n[j] > 0) s += n[j] * views[j][i];
    const uStar = 1 - exp(s);
    if (uStar > 1e-6) out[c] = uStar * (1 + 1e-6) + 1e-12;
  }
  return out;
}

/**
 * The per-input precompute (spec §4.2 step 7, §4.4.4), memoised by `SimInput` identity. For each
 * cost step, every hostable lot's choice row at its envelope (`allowedCount`) and cap
 * (`fzpCap`) against its existing homes gives the expectations and the choice features
 * (`featuresOf`, as the panel's `choiceFeatures`); a lot with no gaining option, or a non-finite
 * term feature (reported in one warning), gets no logit. Features read the `fzp` variant: a
 * `baseZoning` view supplies its base columns there. With `regimes`, `hazard`, `log1mh` and
 * `byStep` stay `input.parcels`' and `regimes` holds each view's. `market` (spec §4.8) adds the
 * shift in force at `asOf` to every logit (`z + 0` is `z` exactly, so without a market every hazard
 * is `initiationHazard`'s), and each later step gets its own `stepLog1mh` row set; `segments`
 * merges the regime days, the later market days and the later cost-step days.
 */
export function precomputeOf(input: SimInput, warn?: (msg: string) => void): Precompute {
  const hit = memo.get(input);
  if (hit) return hit;
  const p = input.parcels;
  const model = input.calibration.initiation;
  const n = p.count;
  const ctx = choiceCtxFor(input);
  const t = input.options;
  const c0 = choiceStepAt(ctx, input.asOf);
  const byStep: ChoiceStepColumns[] = ctx.from.map((from) => ({
    from,
    expHomes: new Float32Array(n),
    expStories: new Float32Array(n),
    margin: new Float32Array(n),
    gains: new Uint8Array(n),
    best: new Int32Array(n).fill(-1),
    logit: new Float64Array(n).fill(-Infinity)
  }));
  const hazard = new Float64Array(n);
  const log1mh = new Float64Array(n);
  const logit = byStep[c0].logit;
  // the market step in force at asOf (s0) and the later steps
  const steps = input.market ?? [];
  let s0 = 0;
  let k0 = -1;
  for (let k = 0; k < steps.length; k++) {
    if (steps[k].from <= input.asOf) {
      s0 = steps[k].logOdds;
      k0 = k;
    }
  }
  const later = steps.slice(k0 + 1);
  const M = later.length;
  const shifts = [s0, ...later.map((s) => s.logOdds)];
  const stepLog1mh = later.map(() => new Float64Array(n));
  const features = {} as Record<FeatureId, number>;
  let bad = 0;
  let firstBad = '';
  for (let i = 0; i < n; i++) {
    if (p.hostable[i] === 1) {
      const allowed = allowedCount(t, i, p.envelopeStories[i]);
      const cap = capFrom(p.fzpCap[i]);
      const existing = p.existingUnits[i];
      let counted = false;
      for (let c = 0; c < byStep.length; c++) {
        const e = expectations(ctx, c, i, allowed, cap, existing);
        // whether an option gains does not depend on the cost step
        if (!e.gains) break;
        const s = byStep[c];
        s.expHomes[i] = e.homes;
        s.expStories[i] = e.stories;
        s.margin[i] = e.margin;
        s.gains[i] = 1;
        s.best[i] = e.best;
        const choice = featuresOf(e, existing, p.existingStories[i]);
        let finite = true;
        for (const term of model.terms) {
          const v = featureValue(p, i, term.feature, 'fzp', choice);
          if (!Number.isFinite(v)) {
            // a lot counts once, at whichever step its feature is non-finite
            if (!counted) {
              if (bad === 0) firstBad = `${p.id[i]} ${term.feature}`;
              bad++;
              counted = true;
            }
            finite = false;
            break;
          }
          features[term.feature] = v;
        }
        if (finite) s.logit[i] = initiationLogit(model, features);
      }
      const z = logit[i];
      if (z !== -Infinity) {
        hazard[i] = 1 / (1 + exp(-(z + s0)));
        for (let m = 0; m < M; m++) {
          stepLog1mh[m][i] = ln(1 - 1 / (1 + exp(-(z + later[m].logOdds))));
        }
      }
    }
    log1mh[i] = ln(1 - hazard[i]);
  }
  if (bad > 0) {
    warn?.(
      `parcels.bin: hazard 0 for ${bad} parcel(s) with a non-finite feature; first: ${firstBad}`
    );
  }
  const rateMemo = new Map<string, Float64Array>();
  const stepRates = (c: number, m: number): Float64Array => {
    if (c === c0) return m === 0 ? log1mh : stepLog1mh[m - 1];
    const key = `${c}:${m}`;
    let out = rateMemo.get(key);
    if (!out) {
      const z = byStep[c].logit;
      const shift = shifts[m];
      out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        if (z[i] !== -Infinity) out[i] = ln(1 - 1 / (1 + exp(-(z[i] + shift))));
      }
      rateMemo.set(key, out);
    }
    return out;
  };
  const regimes = regimeInputsOf(input).map((r) => precomputeOf(r, warn));
  const inRegime = new Uint8Array(regimes.length > 0 ? n : 0);
  for (const g of regimes) for (const i of g.candidates) inRegime[i] = 1;
  const laterStarts = (i: number) => {
    for (let m = 0; m < M; m++) if (stepLog1mh[m][i] < 0) return true;
    for (let c = c0 + 1; c < byStep.length; c++) if (byStep[c].logit[i] !== -Infinity) return true;
    return false;
  };
  const isCandidate = (i: number) =>
    (p.hostable[i] === 1 && ((hazard[i] > 0 && log1mh[i] < 0) || laterStarts(i))) ||
    (regimes.length > 0 && inRegime[i] === 1);
  let m = 0;
  for (let i = 0; i < n; i++) if (isCandidate(i)) m++;
  const candidates = new Int32Array(m);
  const entity = new Uint32Array(m);
  for (let i = 0, c = 0; i < n; i++) {
    if (!isCandidate(i)) continue;
    candidates[c] = i;
    entity[c++] = entityOf(p.id, i);
  }
  const laterCost = ctx.from.slice(c0 + 1);
  const segments = segmentsOf(input, later, laterCost, c0, stepRates, regimes);
  const segmentBounds = regimeMonths(input.asOf, segments.days);
  const bounds = new Map<Day, Float64Array>();
  const pre: Precompute = {
    hazard,
    log1mh,
    logit,
    choice: ctx,
    choiceStep: c0,
    byStep,
    stepLog1mh,
    stepRates,
    segments,
    parcelIndexOf: (id) => p.index.get(id) ?? -1,
    candidates,
    entity,
    skipAbove(horizon) {
      let b = bounds.get(horizon);
      if (!b) {
        const Tmax = lastInitiationMonth(input.asOf, horizon);
        b = skipBounds(segments.log1mh, candidates, Tmax, segmentBounds);
        bounds.set(horizon, b);
      }
      return b;
    },
    regimes
  };
  memo.set(input, pre);
  return pre;
}

/**
 * The merged segment list (`Precompute.segments`): the regime days, the later market days and
 * the later cost-step days, ascending with equal days merged. Segment j starts on `asOf` (j = 0)
 * or `days[j − 1]` and runs on the regime in force on that day (its view's precompute, which has
 * the same market and cost steps) at the market step and the cost step in force on that day.
 */
function segmentsOf(
  input: SimInput,
  later: readonly { from: Day }[],
  laterCost: readonly Day[],
  c0: number,
  ownRates: Precompute['stepRates'],
  regimes: Precompute[]
): Precompute['segments'] {
  const rd = (input.regimes ?? []).map((g) => g.day);
  const md = later.map((s) => s.from);
  const days = [...new Set([...rd, ...md, ...laterCost])].sort((a, b) => a - b);
  const view: number[] = [];
  const rates: Float64Array[] = [];
  for (let j = 0; j <= days.length; j++) {
    const start = j === 0 ? input.asOf : days[j - 1];
    let v = 0;
    while (v < rd.length && rd[v] <= start) v++;
    let step = 0;
    while (step < md.length && md[step] <= start) step++;
    let c = c0;
    while (c - c0 < laterCost.length && laterCost[c - c0] <= start) c++;
    view.push(v);
    rates.push(v === 0 ? ownRates(c, step) : regimes[v - 1].stepRates(c, step));
  }
  return { days, view, log1mh: rates };
}
