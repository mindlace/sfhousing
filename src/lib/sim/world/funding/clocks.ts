// The market and affordable funded clocks of a free lot (spec rules 2, 3, 4, 5, 7): evaluated over
// policy frames instead of finance segment days; level 1 and coverage above 1 differ (see the
// award-rule spec). Nothing is stored: a clock is recomputed from the spell.
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import {
  allowedCount,
  capFrom,
  choiceRow,
  optionHomes,
  pickOption,
  type ChoiceRule
} from '$lib/sim/choice/choose';
import { costPerHome, uncoveredPerHome } from '$lib/sim/finance';
import { NEVER_KEY_DAY, cappedShift, coverageLevel } from '$lib/sim/world/rules/funding';
import { lastInitiationMonth, piecewiseMonth } from '$lib/sim/world/input/build';
import { P, drawOn } from '$lib/sim/world/rules/rng';
import { exp, log } from '$lib/timelapse/math';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { ProjectKind } from '$lib/timelapse/types';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline, ZoningView } from '../policy/frame';
import { logitsAt, rateOf } from '../rates';
import type { Statics } from '../statics';
import { NO_BTYPE } from '../types';
import { frameMoney } from './frame-money';
import { priceTag, sizedPrototype, type PricedPrototype } from './line-price';

const EMPTY: number[] = [];
const logistic = (x: number) => 1 / (1 + exp(-x));
/** Above this log-odds `logSurvival` switches to the stable form (the boundary of the stable form). */
export const STABLE_FROM = 15;
/**
 * `log(1 - logistic(x))`, the log-survival rate at log-odds `x`, finite for every finite `x`.
 * Up to `STABLE_FROM` it is the form `rates.ts` uses for the ordinary rate, bit for bit, so the
 * min-rate rule and the segment merge compare like with like; above it, where `1 - logistic(x)`
 * loses its digits (and is 0 past about 37), it is `-softplus(x)` = `-(x + log(1 + exp(-x)))`.
 * The two agree to about 1e-9 at the boundary.
 */
export function logSurvival(x: number): number {
  return x <= STABLE_FROM ? log(1 - logistic(x)) : -(x + log(1 + exp(-x)));
}
/** The first day of lot-month T of a spell free since r. */
const startOf = (r: Day, T: number): Day => r + 1 + Math.floor((T - 1) * MONTH_DAYS);

/** One kind's funded clock for a spell, evaluated through a model month. */
export interface KindClock {
  kind: ProjectKind;
  /** Lot-month of the spell in which the total passes; 0 = never so far. */
  T: number;
  /** Application day; null when T = 0 or the bundle of lot-month T is empty (the spell is spent, rule 5). */
  day: Day | null;
  /** Model month holding `day` (0 when null). */
  month: number;
  /** The line key's day (rule 7): the ordinary pass (market) or the unshifted affordable pass. */
  keyDay: Day;
  /** Model month of the frame in force at lot-month T's first day (its view gave the size); 0 when T = 0. */
  viewMonth: number;
  /**
   * Size of lot-month T: `f` the option's index in the lot's row, its type code, the cost step it
   * was drawn at, its prototype and the line's price tag (f = -1, units 0, stories 0, btype
   * `NO_BTYPE`, cstep 0, proto null and price '' when T = 0 or there is none).
   */
  f: number;
  units: number;
  stories: number;
  btype: number;
  cstep: number;
  proto: PricedPrototype | null;
  price: string;
  /** Lot-month T's bundle: ascending programme indices of that frame, a shared array (never mutate); [] when T = 0. */
  bundle: number[];
  /** Coverage level of `bundle` (0 when empty). */
  level: number;
}

/** The attempt a free lot is on: its stream, the spell start of each kind, its existing homes. */
export interface Spell {
  lot: number;
  k: number;
  /** `streamOf(sh, lotEntity(statics, lot), k)`. */
  stream: number;
  /** The last day before the spell: lot-month 1 starts on `r + 1`. */
  r: Day;
  /** The lot's existing homes the size is drawn against (0 once demolished). */
  existing: number;
}

/** A lot's size as one of its options, priced at the cost step it was drawn at. */
interface Size {
  f: number;
  units: number;
  stories: number;
  btype: number;
  cstep: number;
  proto: PricedPrototype;
  /** The line's price tag (`priceTag`). */
  price: string;
}

/**
 * Sizes per (parcels view, cost step, global option) against the view's own existing homes,
 * shared.
 */
const sizeMemo = new WeakMap<ScenarioParcels, Map<number, Size>>();

/** The choice row of one size draw (one at a time). */
let cum = new Float32Array(64);

/**
 * The size the attempt's SIZE draw gives in `view` against `existing` at cost step `step` (the
 * frame's `choiceStep`; absent, the step in force at the dataset date), as `startRow` draws it:
 * the option the choice row of `rule` picks among those the view's envelope and cap allow
 * ('market' the draw, 'most-homes' the first option with the most homes, `uS` unread). Null when
 * no option gains a home. Priced by its option's type, stories and homes on that cost step's price
 * step (`optionPrototype`).
 */
export function sizeIn(
  view: ZoningView,
  step: number | undefined,
  lot: number,
  existing: number,
  uS: number,
  rule: ChoiceRule = 'market'
): Size | null {
  const parcels = view.parcels;
  const choice = view.pre.choice;
  const t = choice.t;
  const allowed = allowedCount(t, lot, parcels.envelopeStories[lot]);
  const cap = capFrom(parcels.fzpCap[lot]);
  const cstep = step ?? view.pre.choiceStep;
  if (cum.length < allowed) cum = new Float32Array(allowed);
  if (!choiceRow(choice, cstep, lot, allowed, cap, existing, rule, cum)) return null;
  const f = pickOption(cum, allowed, uS);
  if (f < 0) return null;
  const j = t.offset[lot] + f;
  const key = cstep * t.offset[t.count] + j;
  const own = existing === parcels.existingUnits[lot];
  let memo = own ? sizeMemo.get(parcels) : undefined;
  if (own && memo === undefined) sizeMemo.set(parcels, (memo = new Map()));
  let sz = memo?.get(key);
  if (sz === undefined) {
    const units = optionHomes(t, j, cap, existing);
    const stories = t.stories[j];
    const btype = t.type[j];
    const proto = sizedPrototype(choice, btype, stories, units, cstep);
    sz = { f, units, stories, btype, cstep, proto, price: priceTag(choice, proto, cstep) };
    memo?.set(key, sz);
  }
  return sz;
}

/**
 * Merges `(bounds, vals)` segments exactly as `ordinaryStart` (`rates.ts`) does before
 * `piecewiseMonth`: an empty segment's value is replaced by the next, and equal neighbouring
 * values are merged, so a change that leaves the value alone gives exactly the month it had.
 */
function merged(bounds: readonly number[], vals: readonly number[]): [number[], number[]] {
  const b: number[] = [];
  const v: number[] = [vals[0]];
  for (let j = 0; j < bounds.length; j++) {
    const rate = vals[j + 1];
    const bound = bounds[j];
    const last = v.length - 1;
    if (b.length > 0 && bound <= b[b.length - 1]) {
      v[last] = rate;
      if (v[last] === v[last - 1]) {
        b.pop();
        v.pop();
      }
      continue;
    }
    if (rate === v[last]) continue;
    b.push(bound);
    v.push(rate);
  }
  return [b, v];
}

/** One segment's values (`segValue`, on a frame). */
interface Seg {
  ord: number;
  rate: number;
  ref: number;
  bundle: number[];
  level: number;
  size: Size | null;
}

/**
 * The choice rule a kind's latent sizes by: market the developer's draw; affordable the choice
 * model's `affordableRule` (100% affordable projects maximise homes when it is 'most-homes').
 */
export function ruleOf(view: ZoningView, kind: ProjectKind): ChoiceRule {
  return kind === 'affordable' && view.pre.choice.m.affordableRule === 'most-homes'
    ? 'most-homes'
    : 'market';
}

function segOn(
  timeline: PolicyTimeline,
  g: PolicyFrame,
  statics: Statics,
  spell: Spell,
  kind: ProjectKind,
  uS: number
): Seg {
  const market = kind === 'market';
  const lot = spell.lot;
  const ord = market ? rateOf(g.view, g.market, g.parking, lot, g.choiceStep) : 0;
  const z = logitsAt(g.view, g.choiceStep)[lot];
  const size = sizeIn(g.view, g.choiceStep, lot, spell.existing, uS, ruleOf(g.view, kind));
  // A frame with no money is a frame where nothing is offered and nothing shifts.
  if (size === null || z === -Infinity || g.finance === null)
    return { ord, rate: ord, ref: ord, bundle: EMPTY, level: 0, size };
  const fm = frameMoney(timeline, g);
  const slope = g.finance.slope;
  const p = size.proto;
  // The parking shift moves market odds only (ruling R2), as in `startRates`.
  const x0 = market
    ? g.parking
      ? z + g.market + g.parking.shift(lot)
      : z + g.market
    : z +
      g.market -
      (slope * (uncoveredPerHome('affordable', p) - uncoveredPerHome('market', p))) /
        costPerHome('affordable', p);
  const ref = market ? ord : logSurvival(x0);
  const bundle = fm.bundleOf(kind, size.units);
  if (bundle.length === 0) return { ord, rate: ref, ref, bundle, level: 0, size };
  const priced = fm.index.price(kind, bundle, p);
  const level = coverageLevel(priced.coverage);
  const x = logSurvival(x0 + cappedShift(priced, kind, p, slope));
  return { ord, rate: market ? Math.min(ord, x) : x, ref, bundle, level, size };
}

/** One numeric field of each segment, in order. */
function fieldOf(segs: readonly Seg[], key: 'ord' | 'rate' | 'ref'): number[] {
  const out: number[] = new Array(segs.length);
  for (let j = 0; j < segs.length; j++) out[j] = segs[j][key];
  return out;
}

/** The segment holding lot-month `t`: the first `j` with `bounds[j] >= t` (or the last). */
function segOf(bounds: readonly number[], t: number): number {
  let j = 0;
  while (j < bounds.length && bounds[j] < t) j++;
  return j;
}

/**
 * One kind's funded clock for `spell`, read through model month `month` (rule 4): lot-month T of
 * the spell runs on the frame of the model month holding its first day, as `ordinaryStart` lays
 * out the ordinary clock: the frame of `monthOfDay(r + 1)` (capped at `month`), then each change
 * `c` with `monthOfDay(r + 1) < c <= month` from lot-month `lastInitiationMonth(r, monthFirstDay(c)
 * - 1) + 1`, the last continuing. Each segment's rate is `segValue`'s on its frame (rule 3); the
 * totals merge segments as `ordinaryStart` does, and the segment holding T gives the bundle, size
 * and level. The market pass is never later than the ordinary one and is the ordinary one where no
 * lot-month so far had a lower rate. A pass in a lot-month with an empty bundle makes no
 * application (rule 5). Draws are those of `drawsOf` on `spell.stream` (rule 2). Never reads a
 * frame above `month`. `_sh` is the run's seed hash: the spell's stream already holds it.
 */
export function kindClock(
  statics: Statics,
  timeline: PolicyTimeline,
  month: number,
  _sh: number,
  spell: Spell,
  kind: ProjectKind
): KindClock {
  const asOf = statics.asOf;
  const { r, stream } = spell;
  const market = kind === 'market';
  const first = Math.min(monthOfDay(asOf, r + 1), month);
  const months = [first];
  const bounds: number[] = [];
  for (const c of timeline.changes()) {
    if (c <= first) continue;
    if (c > month) break;
    months.push(c);
    bounds.push(lastInitiationMonth(r, monthFirstDay(asOf, c) - 1));
  }
  const K = bounds.length;
  const uS = drawOn(stream, P.SIZE, 0);
  const segs: Seg[] = new Array(months.length);
  for (let j = 0; j < months.length; j++)
    segs[j] = segOn(timeline, timeline.frameAt(months[j]), statics, spell, kind, uS);

  const uO = drawOn(stream, P.INIT, 0);
  const LO = log(1 - uO);
  const [ob, or] = merged(bounds, fieldOf(segs, 'ord'));
  // The ordinary lot-month, as `ordinaryStart` computes it (only the market reads it).
  const TO = market ? piecewiseMonth(LO, ob, or) : 0;

  const L = market ? LO : log(1 - drawOn(stream, P.INIT_AFFORDABLE, 0));
  const v = drawOn(stream, market ? P.INIT_DAY : P.INIT_DAY_AFFORDABLE, 0);
  const [rb, rr] = merged(bounds, fieldOf(segs, 'rate'));
  let T = piecewiseMonth(L, rb, rr);
  if (market && TO !== 0) {
    if (T === 0 || T > TO) T = TO;
    else if (T < TO) {
      let shifted = false;
      for (let j = 0, a = 0, jT = segOf(bounds, T); j <= jT; j++) {
        const end = j < K ? bounds[j] : Infinity;
        if (end > a && segs[j].rate < segs[j].ord) shifted = true;
        a = Math.max(a, end);
      }
      if (!shifted) T = TO;
    }
  }

  let Tref: number;
  if (market) Tref = TO;
  else {
    const [fb, fr] = merged(bounds, fieldOf(segs, 'ref'));
    Tref = piecewiseMonth(L, fb, fr);
  }
  const keyDay = Tref === 0 ? NEVER_KEY_DAY : startOf(r, Tref);

  if (T === 0) {
    return {
      kind,
      T,
      day: null,
      month: 0,
      keyDay,
      viewMonth: 0,
      f: -1,
      units: 0,
      stories: 0,
      btype: NO_BTYPE,
      cstep: 0,
      proto: null,
      price: '',
      bundle: EMPTY,
      level: 0
    };
  }
  const j = segOf(bounds, T);
  const s = segs[j];
  const day: Day | null = s.bundle.length > 0 ? r + 1 + Math.floor((T - 1 + v) * MONTH_DAYS) : null;
  return {
    kind,
    T,
    day,
    month: day === null ? 0 : monthOfDay(asOf, day),
    keyDay,
    viewMonth: months[j],
    f: s.size ? s.size.f : -1,
    units: s.size ? s.size.units : 0,
    stories: s.size ? s.size.stories : 0,
    btype: s.size ? s.size.btype : NO_BTYPE,
    cstep: s.size ? s.size.cstep : 0,
    proto: s.size ? s.size.proto : null,
    price: s.size && market ? s.size.price : '',
    bundle: s.bundle,
    level: s.level
  };
}
