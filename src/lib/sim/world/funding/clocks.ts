// The market and affordable funded clocks of a free lot (spec rules 2, 3, 4, 5, 7): today's
// `segValue` and `kindLatentInto` (`funded.ts:452-478, 772-871`) evaluated over policy frames
// instead of finance segment days. Nothing is stored: a clock is recomputed from the spell.
import { FILL_LEVELS, fillStories, type ScenarioParcels } from '$lib/data/scenario-codec';
import {
  PROTOTYPES,
  costPerHome,
  oddsShift,
  prototypeFor,
  uncoveredPerHome,
  type Prototype,
  type PrototypeId
} from '$lib/sim/finance';
import { NEVER_KEY_DAY } from '$lib/sim/scenario/funded';
import { coverageLevel } from '$lib/sim/scenario/funding';
import { lastInitiationMonth, piecewiseMonth, sizeCumAgainst } from '$lib/sim/scenario/input';
import { P, drawOn } from '$lib/sim/scenario/rng';
import { exp, log } from '$lib/timelapse/math';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { Calibration, ProjectKind } from '$lib/timelapse/types';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline, ZoningView } from '../policy/frame';
import { startRates } from '../rates';
import type { Statics } from '../statics';
import { frameMoney } from './frame-money';

const F = FILL_LEVELS.length;
const EMPTY: number[] = [];
const PROTOTYPE = new Map<PrototypeId, Prototype>(PROTOTYPES.map((p) => [p.id, p]));
const logistic = (x: number) => 1 / (1 + exp(-x));
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
  /** Size of lot-month T (f = -1, units 0, stories 0, protoId 'E' when T = 0 or there is none). */
  f: number;
  units: number;
  stories: number;
  protoId: PrototypeId;
  /** Lot-month T's bundle: ascending programme indices of that frame, a shared array (never mutate); [] when T = 0. */
  bundle: number[];
  /** Coverage level of `bundle` (0 when empty). */
  level: number;
  /** Lot-month T's bundle is certain (its rate is -Infinity). */
  certain: boolean;
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

/** A lot's size at one fill level. */
interface Size {
  f: number;
  units: number;
  stories: number;
  protoId: PrototypeId;
}

/** Sizes per (parcels table, row, level), built once and shared (never mutated). */
const sizeMemo = new WeakMap<ScenarioParcels, (Size | undefined)[]>();

function sizeAt(p: ScenarioParcels, lot: number, f: number): Size {
  let memo = sizeMemo.get(p);
  if (memo === undefined) {
    memo = new Array(p.count * F);
    sizeMemo.set(p, memo);
  }
  let sz = memo[lot * F + f];
  if (sz === undefined) {
    const units = p.yield[lot * F + f];
    const stories = fillStories(FILL_LEVELS[f], p.envelopeStories[lot]);
    sz = { f, units, stories, protoId: prototypeFor(stories, units).id };
    memo[lot * F + f] = sz;
  }
  return sz;
}

/**
 * The size the attempt's SIZE draw gives in `view` against `existing`, as `startRow` draws it
 * (`world.ts:288-315`); null when no level gains a home.
 */
export function sizeIn(
  statics: Statics,
  view: ZoningView,
  calibration: Calibration,
  lot: number,
  existing: number,
  uS: number
): { f: number; units: number; stories: number; protoId: PrototypeId } | null {
  const parcels = view.parcels;
  const own = existing === parcels.existingUnits[lot];
  const cum = own
    ? view.pre.sizeCum
    : sizeCumAgainst(
        {
          parcels,
          projects: statics.projects,
          calibration,
          asOf: statics.asOf,
          districtMaxStories: statics.districtMaxStories
        },
        lot,
        existing
      );
  const at = own ? lot * F : 0;
  let f = 0;
  while (f < F && !(uS < cum[at + f])) f++;
  if (f === F) return null;
  return sizeAt(parcels, lot, f);
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

/** One segment's values (`segValue`, `funded.ts:452-478`, on a frame). */
interface Seg {
  ord: number;
  rate: number;
  ref: number;
  bundle: number[];
  level: number;
  size: Size | null;
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
  const ord = market ? startRates(g.view, g.market)[lot] : 0;
  const z = g.view.pre.logit[lot];
  const size = sizeIn(statics, g.view, g.calibration, lot, spell.existing, uS);
  // A frame with no money is a frame where nothing is offered and nothing shifts.
  if (size === null || z === -Infinity || g.finance === null)
    return { ord, rate: ord, ref: ord, bundle: EMPTY, level: 0, size };
  const fm = frameMoney(timeline, g);
  const slope = g.finance.slope;
  const p = PROTOTYPE.get(size.protoId)!;
  const x0 = market
    ? z + g.market
    : z +
      g.market -
      (slope * (uncoveredPerHome('affordable', p) - uncoveredPerHome('market', p))) /
        costPerHome('affordable', p);
  const ref = market ? ord : log(1 - logistic(x0));
  const bundle = fm.bundleOf(kind, size.units);
  if (bundle.length === 0) return { ord, rate: ref, ref, bundle, level: 0, size };
  const priced = fm.index.price(kind, bundle, size.protoId);
  const level = coverageLevel(priced.coverage);
  if (priced.certain) return { ord, rate: -Infinity, ref, bundle, level, size };
  const x = log(1 - logistic(x0 + oddsShift(priced.grantEquivalent, kind, p, slope)));
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
      protoId: 'E',
      bundle: EMPTY,
      level: 0,
      certain: false
    };
  }
  const j = segOf(bounds, T);
  const s = segs[j];
  const certain = s.rate === -Infinity && s.bundle.length > 0;
  let day: Day | null = null;
  if (s.bundle.length > 0)
    day = certain ? startOf(r, T) : r + 1 + Math.floor((T - 1 + v) * MONTH_DAYS);
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
    protoId: s.size ? s.size.protoId : 'E',
    bundle: s.bundle,
    level: s.level,
    certain
  };
}
