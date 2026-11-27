// The developer's choice: which of a lot's allowed options a start builds. Pure and worker-safe;
// the run time, the panel and the fits all read the row from here.
//
// residualLandValue(o, v) = homes × (v × valuePerHome − costPerHome − carryPerHome), with homes
// clipped by the unit cap; choiceValue = max(locationValue, breakEvenValue); the market share of
// an option is ∝ exp(residualLandValue(o, choiceValue) ÷ (choiceSpread × meanOptionHomes ×
// meanOptionCost)). breakEvenValue and the two means are the lot's at the cost step, over all
// its options whatever the cap (options.ts lotConstants), so a higher cap never changes the odds
// between options already allowed.
import type { OptionTable } from '../../data/option-table';
import { NULL_CAP } from '../../data/policy-codec';
import { capScenarioYield } from '../../data/scenario-yield';
import type { Day } from '../../timelapse/types';
import { carryPerHome, costPerHome, valuePerHome } from './pricing';
import {
  BUILDING_TYPES,
  stepAt,
  type ChoiceModel,
  type HeightTimeModel,
  type HeightTimeStep,
  type Option,
  type PriceStep
} from './types';

/** One cost step's prices per option and constants per lot. */
export interface ChoiceStep {
  /** Per global option j: costPerHome at 3j, valuePerHome at 3j + 1, carryPerHome at 3j + 2. */
  price: Float64Array;
  /** Per lot: the least (costPerHome + carryPerHome) ÷ valuePerHome over all its options. */
  breakEvenValue: Float32Array;
  /** Per lot: the mean homes of all its options. */
  meanOptionHomes: Float32Array;
  /** Per lot: the mean costPerHome (without carrying) of all its options. */
  meanOptionCost: Float32Array;
}

export interface ChoiceCtx {
  t: OptionTable;
  m: ChoiceModel;
  ht: HeightTimeModel;
  /**
   * The days each step starts: the union of the price and height-time series' `from` days.
   * Step i resolves each series at from[i] on its own.
   */
  from: readonly Day[];
  /** Step `index`, built on first use and kept. */
  step(index: number): ChoiceStep;
}

export type ChoiceRule = 'market' | 'most-homes';

type Sized = Pick<Option, 'type' | 'stories' | 'homes'>;

function buildStep(
  t: OptionTable,
  prices: PriceStep,
  time: HeightTimeStep,
  upTo: number[]
): ChoiceStep {
  const total = t.offset[t.count];
  const price = new Float64Array(3 * total);
  const o: Sized = { type: 'V', stories: 0, homes: 0 };
  for (let j = 0; j < total; j++) {
    o.type = BUILDING_TYPES[t.type[j]];
    o.stories = t.stories[j];
    o.homes = t.homes[j];
    price[3 * j] = costPerHome(o, prices);
    price[3 * j + 1] = valuePerHome(o, prices);
    price[3 * j + 2] = carryPerHome(o, prices, time, upTo);
  }
  const breakEvenValue = new Float32Array(t.count);
  const meanOptionHomes = new Float32Array(t.count);
  const meanOptionCost = new Float32Array(t.count);
  // lotConstants' formula over the priced columns (choose.spec cross-checks the two)
  for (let lot = 0; lot < t.count; lot++) {
    const from = t.offset[lot];
    const to = t.offset[lot + 1];
    let bev = Infinity;
    let homes = 0;
    let cost = 0;
    for (let j = from; j < to; j++) {
      bev = Math.min(bev, (price[3 * j] + price[3 * j + 2]) / price[3 * j + 1]);
      homes += t.homes[j];
      cost += price[3 * j];
    }
    const n = to - from;
    breakEvenValue[lot] = bev;
    meanOptionHomes[lot] = n ? homes / n : 0;
    meanOptionCost[lot] = n ? cost / n : 0;
  }
  return { price, breakEvenValue, meanOptionHomes, meanOptionCost };
}

const memo = new WeakMap<OptionTable, WeakMap<ChoiceModel, WeakMap<HeightTimeModel, ChoiceCtx>>>();

/** The choice context of a table under a model, memoised per table and models. */
export function choiceCtxOf(t: OptionTable, m: ChoiceModel, ht: HeightTimeModel): ChoiceCtx {
  let byModel = memo.get(t);
  if (!byModel) memo.set(t, (byModel = new WeakMap()));
  let byTime = byModel.get(m);
  if (!byTime) byModel.set(m, (byTime = new WeakMap()));
  const hit = byTime.get(ht);
  if (hit) return hit;
  const from = [...new Set([...m.prices, ...ht.steps].map((s) => s.from))].sort((a, b) => a - b);
  const steps: ChoiceStep[] = [];
  const ctx: ChoiceCtx = {
    t,
    m,
    ht,
    from,
    step(index) {
      if (!Number.isInteger(index) || index < 0 || index >= from.length) {
        throw new RangeError(`choice: no step ${index} of ${from.length}`);
      }
      return (steps[index] ??= buildStep(
        t,
        stepAt(m.prices, from[index]).value,
        stepAt(ht.steps, from[index]).value,
        ht.upTo
      ));
    }
  };
  byTime.set(ht, ctx);
  return ctx;
}

/** The step in force on `day`: the last with `from <= day`, or step 0 before the first. */
export function choiceStepAt(ctx: ChoiceCtx, day: Day): number {
  let index = 0;
  for (let i = 1; i < ctx.from.length; i++) if (ctx.from[i] <= day) index = i;
  return index;
}

/** A stored unit cap as `choiceRow` takes it: null for `NULL_CAP` (no cap). */
export const capFrom = (cap: number): number | null => (cap === NULL_CAP ? null : cap);

/** How many of the lot's options have at most `stories` stories: they are its row's prefix. */
export function allowedCount(t: OptionTable, lot: number, stories: number): number {
  const from = t.offset[lot];
  let lo = from;
  let hi = t.offset[lot + 1];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t.stories[mid] <= stories) lo = mid + 1;
    else hi = mid;
  }
  return lo - from;
}

/** Option j's homes after the unit cap, by capScenarioYield's rule (0 when cap <= existing). */
export function optionHomes(t: OptionTable, j: number, cap: number | null, existing: number) {
  return capScenarioYield(t.homes[j], cap, existing);
}

/**
 * The most homes after the cap among the lot's first n options, whether or not they gain a home
 * over `existing` (0 when n is 0): the largest building the cap allows, as the fill levels' top
 * yield was.
 */
export function topHomes(
  t: OptionTable,
  lot: number,
  n: number,
  cap: number | null,
  existing: number
): number {
  const from = t.offset[lot];
  let top = 0;
  for (let k = 0; k < n; k++) top = Math.max(top, optionHomes(t, from + k, cap, existing));
  return top;
}

/**
 * The first of the lot's first n options with the most homes after the cap among those gaining a
 * home over `existing`, as an index into the lot's row, or -1 when none gains. Capacity (rule A)
 * is max(0, homes − existing) of that option.
 */
export function mostHomes(
  t: OptionTable,
  lot: number,
  n: number,
  cap: number | null,
  existing: number
): number {
  const from = t.offset[lot];
  let best = -1;
  let most = existing;
  for (let k = 0; k < n; k++) {
    const h = optionHomes(t, from + k, cap, existing);
    if (h > most) {
      best = k;
      most = h;
    }
  }
  return best;
}

// Scratch for one row: each option's residual land value (NaN when it gains nothing) and homes.
let rlv = new Float64Array(64);
let clipped = new Float64Array(64);

/**
 * Fills `rlv` and `clipped` for the lot's first n options at choiceValue and returns the last
 * option that gains a home, or -1.
 */
function residuals(
  ctx: ChoiceCtx,
  step: number,
  lot: number,
  n: number,
  cap: number | null,
  existing: number
): number {
  if (rlv.length < n) {
    rlv = new Float64Array(n);
    clipped = new Float64Array(n);
  }
  const s = ctx.step(step);
  const value = Math.max(ctx.t.locationValue[lot], s.breakEvenValue[lot]);
  const from = ctx.t.offset[lot];
  let last = -1;
  for (let k = 0; k < n; k++) {
    const j = from + k;
    const h = optionHomes(ctx.t, j, cap, existing);
    clipped[k] = h;
    if (h <= existing) {
      rlv[k] = NaN;
      continue;
    }
    rlv[k] = h * (value * s.price[3 * j + 1] - s.price[3 * j] - s.price[3 * j + 2]);
    last = k;
  }
  return last;
}

/**
 * Turns `rlv` into unnormalised market weights in place (0 for an option gaining nothing), with
 * the row maximum subtracted before exp, and returns their sum.
 */
function marketWeights(ctx: ChoiceCtx, step: number, lot: number, n: number): number {
  const s = ctx.step(step);
  const scale = ctx.m.choiceSpread * s.meanOptionHomes[lot] * s.meanOptionCost[lot];
  let top = -Infinity;
  for (let k = 0; k < n; k++) if (rlv[k] > top) top = rlv[k];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    rlv[k] = Number.isNaN(rlv[k]) ? 0 : Math.exp((rlv[k] - top) / scale);
    sum += rlv[k];
  }
  return sum;
}

/**
 * Fills out[0..n) with the cumulative probabilities of the lot's first n options at cost step
 * `step`. An option gaining no home over `existing` after the cap has probability 0; the last
 * gaining one and every option after it are exactly 1. Returns false, with the row 0, when none
 * gains. 'market' is the softmax of residual land values at choiceValue; 'most-homes' puts 1 on
 * the first gaining option with the most homes after the cap.
 */
export function choiceRow(
  ctx: ChoiceCtx,
  step: number,
  lot: number,
  n: number,
  cap: number | null,
  existing: number,
  rule: ChoiceRule,
  out: Float32Array
): boolean {
  if (rule === 'most-homes') {
    const best = mostHomes(ctx.t, lot, n, cap, existing);
    for (let k = 0; k < n; k++) out[k] = best >= 0 && k >= best ? 1 : 0;
    return best >= 0;
  }
  const last = residuals(ctx, step, lot, n, cap, existing);
  if (last < 0) {
    out.fill(0, 0, n);
    return false;
  }
  const sum = marketWeights(ctx, step, lot, n);
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += rlv[k];
    out[k] = k >= last ? 1 : acc / sum;
  }
  return true;
}

/** The first k with u < cum[k], or -1. */
export function pickOption(cum: Float32Array, n: number, u: number): number {
  for (let k = 0; k < n; k++) if (u < cum[k]) return k;
  return -1;
}

/**
 * Under the market row: the expected homes after the cap and the expected stories, and the margin,
 * the best residual land value at choiceValue among gaining options ÷ (meanOptionHomes ×
 * meanOptionCost), with `best` that option's index in the lot's row (the first on a tie). All 0,
 * and `best` -1, when no option gains.
 */
export function expectations(
  ctx: ChoiceCtx,
  step: number,
  lot: number,
  n: number,
  cap: number | null,
  existing: number
): { homes: number; stories: number; margin: number; best: number; gains: boolean } {
  const last = residuals(ctx, step, lot, n, cap, existing);
  if (last < 0) return { homes: 0, stories: 0, margin: 0, best: -1, gains: false };
  const s = ctx.step(step);
  let top = -Infinity;
  let best = -1;
  for (let k = 0; k < n; k++) {
    if (rlv[k] > top) {
      top = rlv[k];
      best = k;
    }
  }
  const margin = top / (s.meanOptionHomes[lot] * s.meanOptionCost[lot]);
  const sum = marketWeights(ctx, step, lot, n);
  const from = ctx.t.offset[lot];
  let homes = 0;
  let stories = 0;
  for (let k = 0; k < n; k++) {
    const p = rlv[k] / sum;
    homes += p * clipped[k];
    stories += p * ctx.t.stories[from + k];
  }
  return { homes, stories, margin, best, gains: true };
}

/**
 * The start-odds features a lot takes from its choice at a cap (spec, "Start odds refit"): the
 * expected homes ÷ max(existing, 1), the expected stories − the existing stories, and the margin.
 * One function for the panel, the fits and the run time. With no gaining option all three are
 * what `expectations` gives: homes and stories 0, so the gap is −existingStories, margin 0.
 */
export function choiceFeatures(
  ctx: ChoiceCtx,
  step: number,
  lot: number,
  n: number,
  cap: number | null,
  existing: number,
  existingStories: number
): { potentialRatio: number; storiesGap: number; choiceMargin: number } {
  return featuresOf(expectations(ctx, step, lot, n, cap, existing), existing, existingStories);
}

/** `choiceFeatures` from expectations already computed (the run time keeps them per step). */
export function featuresOf(
  e: { homes: number; stories: number; margin: number },
  existing: number,
  existingStories: number
): { potentialRatio: number; storiesGap: number; choiceMargin: number } {
  return {
    potentialRatio: e.homes / Math.max(existing, 1),
    storiesGap: e.stories - existingStories,
    choiceMargin: e.margin
  };
}
