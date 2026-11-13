/**
 * The policies in force on a day and how they combine into today's undated lever shapes
 * (policy-timeline spec, rules 10 to 15). Pure TS, worker-safe.
 */
import type { ParcelId } from '$lib/data/parcel';
import { isIdentity, scaleTable, type StageScale } from '$lib/sim/levers/timers';
import {
  LeverFormatError,
  type FinanceLevers,
  type SimLevers,
  type StoryEdit,
  type TimerEdit
} from '$lib/sim/levers/types';
import {
  canonicalJson,
  compileLevers,
  DEFAULT_POLICY,
  paintedLots,
  type Lots,
  type ZoningRule
} from '$lib/sim-page/policy';
import { compileTiming } from '$lib/sim-page/timing';
import {
  spanAt,
  type Effect,
  type Policy,
  type SimPolicy4,
  type Span
} from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Pathway } from '$lib/timelapse/types';

/** A policy in force: its place in its kind's list, the policy, and the span covering the day. */
export interface Active {
  index: number;
  policy: Policy;
  span: Span;
}

/** The policies in force on one day, per kind, in list order. */
export interface InForce {
  zoning: Active[];
  permitting: Active[];
  money: Active[];
}

/** The policies that are on with a span covering `day`. */
export function inForceAt(doc: SimPolicy4, day: Day): InForce {
  const pick = (ps: readonly Policy[]): Active[] =>
    ps.flatMap((policy, index) => {
      const span = spanAt(policy, day);
      return span === null ? [] : [{ index, policy, span }];
    });
  return {
    zoning: pick(doc.kinds.zoning),
    permitting: pick(doc.kinds.permitting),
    money: pick(doc.kinds.money)
  };
}

export type ZoningLevers = Pick<
  SimLevers,
  'rules' | 'paint' | 'protect' | 'localProgramStreamlined'
>;

type What<T extends Effect['tag']> = Extract<Effect, { tag: T }>;

/** The span's effect, checked against the tag its selector pairs with. */
function whatOf<T extends Effect['tag']>(a: Active, tag: T): What<T> {
  if (a.span.what.tag !== tag)
    throw new LeverFormatError(
      `policy ${a.policy.id}`,
      `expected a ${tag} effect for a ${a.policy.where.tag} policy`
    );
  return a.span.what as What<T>;
}

const byId = (a: ParcelId, b: ParcelId) => (a < b ? -1 : a > b ? 1 : 0);

/** One edit per story value, lots sorted, edits by stories: each lot once, so order is moot. */
function editsOf(stories: ReadonlyMap<ParcelId, number>): StoryEdit[] {
  const by = new Map<number, ParcelId[]>();
  for (const [lot, n] of stories) {
    const l = by.get(n);
    if (l === undefined) by.set(n, [lot]);
    else l.push(lot);
  }
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([n, lots]) => ({ lots: lots.sort(byId), stories: n }));
}

/**
 * The zoning in force as today's lever fields. Rules: each lot takes the highest rule naming it
 * (rule 10). Paint: each policy as today, then the lower in the list wins a lot (rule 11).
 * Protections: any policy turns one on, `newerThan` takes the largest years (rule 12). `lp` is
 * the Local Program switch (`permittingOf(f).localProgramStreamlined`). Throws
 * `LeverFormatError` naming a query key absent from `lots`.
 */
export function zoningLevers(
  f: InForce,
  lots: Record<string, ParcelId[]>,
  lp: boolean
): ZoningLevers {
  const lookup: Lots = (key) => {
    const l = lots[key];
    if (l === undefined) throw new LeverFormatError('lots', `no lots for query ${key}`);
    return l;
  };

  const rules: ZoningRule[] = [];
  const painted: Map<ParcelId, number>[] = [];
  const protect: ZoningLevers['protect'] = {
    rentControl: false,
    historic: false,
    newerThanYears: null
  };
  for (const a of f.zoning) {
    const where = a.policy.where;
    if (where.tag === 'transit') {
      rules.push({
        id: a.policy.id,
        kind: 'transit',
        stopTypes: where.stopTypes,
        bands: whatOf(a, 'bands').bands
      });
    } else if (where.tag === 'painted') {
      const brushes = whatOf(a, 'brushes').brushes;
      painted.push(paintedLots({ ...DEFAULT_POLICY, custom: brushes }, lookup)!);
    } else if (where.tag === 'category') {
      const years = whatOf(a, 'protect').years;
      if (where.category === 'newerThan') {
        if (years !== null)
          protect.newerThanYears = Math.max(protect.newerThanYears ?? years, years);
      } else protect[where.category] = true;
    } else {
      throw new LeverFormatError(`policy ${a.policy.id}`, `not a zoning policy: ${where.tag}`);
    }
  }

  const highest = new Map<ParcelId, number>();
  if (rules.length > 0) {
    for (const e of compileLevers({ ...DEFAULT_POLICY, rules }, lookup)!.rules)
      for (const lot of e.lots) highest.set(lot, Math.max(highest.get(lot) ?? 0, e.stories));
  }
  const paint = new Map<ParcelId, number>();
  for (const m of painted) for (const [lot, n] of m) paint.set(lot, n);

  return {
    rules: editsOf(highest),
    paint: editsOf(paint),
    protect,
    localProgramStreamlined: lp
  };
}

const pairs = (edits: readonly StoryEdit[]): [ParcelId, number][] =>
  edits
    .flatMap((e) => e.lots.map((l): [ParcelId, number] => [l, e.stories]))
    .sort((a, b) => byId(a[0], b[0]));

/** Canonical text of a zoning state: equal exactly when resolution gives equal envelopes. */
export function zoningKeyOf(z: ZoningLevers): string {
  return canonicalJson({
    rules: pairs(z.rules),
    paint: pairs(z.paint),
    protect: z.protect,
    lp: z.localProgramStreamlined
  });
}

/** The permitting in force (rules 13 and 14). */
export interface Permitting {
  /** Every `all` timer in force, multiplied and clamped per route and stage. */
  speed: StageScale;
  /** Each policy's `new` timers from the start of its span in force; by `from`, then list order. */
  speedNew: { from: Day; scale: StageScale }[];
  /** From the lowest policy in force that sets them; null = observed. */
  routeShares: Record<Pathway, number> | null;
  /** False when some policy in force says the Local Program is not streamlined. */
  localProgramStreamlined: boolean;
}

export function permittingOf(f: InForce): Permitting {
  const all: TimerEdit[] = [];
  const speedNew: Permitting['speedNew'] = [];
  let routeShares: Permitting['routeShares'] = null;
  let localProgramStreamlined = true;
  for (const a of f.permitting) {
    if (a.policy.where.tag !== 'routes')
      throw new LeverFormatError(`policy ${a.policy.id}`, `not a permitting policy`);
    const c = compileTiming(whatOf(a, 'timing').set);
    all.push(...c.timers.filter((t) => t.reach === 'all'));
    const fresh = c.timers.filter((t) => t.reach === 'new');
    if (fresh.length > 0) {
      const scale = scaleTable(fresh, 'new');
      if (!isIdentity(scale)) speedNew.push({ from: a.span.from, scale });
    }
    if (c.routeShares !== null) routeShares = c.routeShares; // a lower policy overrides
    if (!c.localProgramStreamlined) localProgramStreamlined = false;
  }
  speedNew.sort((x, y) => x.from - y.from); // stable: list order within one day
  return { speed: scaleTable(all, 'inFlight'), speedNew, routeShares, localProgramStreamlined };
}

/**
 * The money in force as one `FinanceLevers` (rule 15): scale entries merged per (pool, from),
 * the lower policy winning, sorted by pool then from; added pools and programmes in document
 * order; terms merged, the lower policy winning.
 */
export function moneyLeversOf(f: InForce): FinanceLevers {
  const scales = new Map<string, FinanceLevers['baselineScale'][number]>();
  const out: FinanceLevers = { baselineScale: [], pools: [], programmes: [], terms: {} };
  for (const a of f.money) {
    const tag = a.policy.where.tag;
    if (tag === 'baseline') {
      for (const e of whatOf(a, 'scales').entries) scales.set(`${e.pool}\u0000${e.from}`, { ...e });
    } else if (tag === 'fund') {
      const w = whatOf(a, 'fund');
      if (w.pool !== null) out.pools.push(structuredClone(w.pool));
      out.programmes.push(...structuredClone(w.programmes));
    } else if (tag === 'terms') {
      Object.assign(out.terms, whatOf(a, 'terms').terms);
    } else {
      throw new LeverFormatError(`policy ${a.policy.id}`, `not a money policy: ${tag}`);
    }
  }
  out.baselineScale = [...scales.values()].sort((x, y) =>
    x.pool !== y.pool ? (x.pool < y.pool ? -1 : 1) : x.from - y.from
  );
  return out;
}
