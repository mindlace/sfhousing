/**
 * Opening a schema 3 policy as schema 4 (policy-timeline spec, "Opening an old document"): the
 * pairs table, rules 1 and 2. In memory only; nothing is stored. Pure TS.
 */
import { canonicalJson, type SimPolicy } from '$lib/sim-page/policy';
import { OBSERVED_TIMING, timingLabel } from '$lib/sim-page/timing';
import { monthFirstDay } from '$lib/sim/world/months';
import type { Day } from '$lib/timelapse/time';
import type { Effect, Policy, Selector, SimPolicy4 } from './policy4';

/** Schema 3 policy `p` as a schema 4 document whose policies are in force from the day after `asOf`. */
export function upgradePolicy(p: SimPolicy, asOf: Day): SimPolicy4 {
  const from = monthFirstDay(asOf, 1);
  const used = new Set<string>();
  const idFor = (want: string): string => {
    let id = want;
    for (let n = 2; used.has(id); n++) id = `${want}-${n}`;
    used.add(id);
    return id;
  };
  const make = (
    id: string,
    label: string,
    where: Selector,
    what: Effect,
    preset: string | null = null,
    on = true
  ): Policy => ({
    id: idFor(id),
    label,
    preset,
    on,
    where,
    spans: [{ from, to: null, what: structuredClone(what) }]
  });

  const zoning: Policy[] = [];
  for (const r of p.rules) {
    zoning.push(
      make(
        r.id,
        'Transit rule',
        { tag: 'transit', stopTypes: [...r.stopTypes] },
        { tag: 'bands', bands: r.bands }
      )
    );
  }
  if (p.custom.length > 0) {
    zoning.push(
      make('painted', 'Painted zoning', { tag: 'painted' }, { tag: 'brushes', brushes: p.custom })
    );
  }
  const protect = (
    on: boolean,
    c: 'rentControl' | 'historic' | 'newerThan',
    label: string,
    years: number | null
  ) => {
    if (on)
      zoning.push(
        make(`protect-${c}`, label, { tag: 'category', category: c }, { tag: 'protect', years })
      );
  };
  protect(p.protect.rentControl, 'rentControl', 'Protect rent-controlled buildings', null);
  protect(p.protect.historic, 'historic', 'Protect historic buildings', null);
  const n = p.protect.newerThanYears;
  protect(n !== null, 'newerThan', `Protect buildings newer than ${n} years`, n);

  const permitting: Policy[] = [];
  const { current, saved } = p.timing;
  if (canonicalJson(current) !== canonicalJson(OBSERVED_TIMING.current)) {
    permitting.push(
      make(
        'timing',
        timingLabel(current),
        { tag: 'routes' },
        { tag: 'timing', set: current },
        current.preset
      )
    );
  }
  if (saved) {
    permitting.push(
      make(
        'timing-saved',
        saved.label,
        { tag: 'routes' },
        { tag: 'timing', set: saved.set },
        saved.set.preset,
        false
      )
    );
  }

  const money: Policy[] = [];
  const f = p.funding;
  if (f.baselineScale.length > 0) {
    money.push(
      make(
        'baseline',
        'City funding scale',
        { tag: 'baseline' },
        { tag: 'scales', entries: f.baselineScale }
      )
    );
  }
  const added = new Set(f.pools.map((pool) => pool.id));
  for (const pool of f.pools) {
    money.push(
      make(
        `fund-${pool.id}`,
        pool.label,
        { tag: 'fund', pool: pool.id },
        { tag: 'fund', pool, programmes: f.programmes.filter((g) => g.pool === pool.id) }
      )
    );
  }
  const baselinePools = [
    ...new Set(f.programmes.filter((g) => !added.has(g.pool)).map((g) => g.pool))
  ];
  for (const id of baselinePools) {
    money.push(
      make(
        `fund-${id}`,
        `Programmes on ${id}`,
        { tag: 'fund', pool: id },
        { tag: 'fund', pool: null, programmes: f.programmes.filter((g) => g.pool === id) }
      )
    );
  }
  if (Object.keys(f.terms).length > 0) {
    money.push(make('terms', 'Market terms', { tag: 'terms' }, { tag: 'terms', terms: f.terms }));
  }

  return { schema: 4, kinds: { zoning, permitting, money } };
}
