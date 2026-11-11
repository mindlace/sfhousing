// finance-engine Task 9: stacked money in the engine (spec 4.6 examples, 4.12 "Re-pricing
// `funding.programmes` gives the same dollars"; section 6 test 4: "A bond stacked on the baseline
// adds homes", "A short pool is made up by another only as far as its share allows",
// "`funding.programmes` and re-pricing agree").
import { describe, expect, it } from 'vitest';
import { fundBundle, isCertain, projectDollars, prototypeFor } from '$lib/sim/finance';
import type { Day } from '$lib/timelapse/time';
import type { Inflow } from '$lib/timelapse/types';
import { miniCalibrationWithRoutes, miniFinance } from './fixtures/mini-finance';
import { TINY_IDS, tinyQueue, tinyStack, type TinyStackOpts } from './fixtures/tiny-queue';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { checkLedger, runCollect, type Collected } from './test/finance-harness';
import type { LedgerEvent } from './money';
import type { Schedule, SimInput } from './types';

type Finance = NonNullable<SimInput['finance']>;

const H = GOLDEN_HORIZON;
const base = goldenInput();
const asOf = base.asOf;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const once = (day: Day, dollars: number): Inflow => ({ kind: 'once', day, dollars });
const AMPLE = 1_000_000_000_000;
const NEVER = Array(5).fill(-12);
const TOTAL = 861525;
/** the City tier's dollars per home (design baseline, tier 1) */
const CITY = 300027;
/** spec 4.6, "A bond in the City tier": the pro rata payments of a 0.5 bond beside the City */
const CITY_PRO_RATA = (CITY * CITY) / (CITY + 0.5 * TOTAL);
const BOND_PRO_RATA = (CITY * 0.5 * TOTAL) / (CITY + 0.5 * TOTAL);

const funded = (c: Collected) => c.schedules.filter((s) => s.funding !== undefined);
const sid = (row: number, k = 0) => `sim:${TINY_IDS[row]}:${k}`;

/** The mini city on the calibration with `affordableRoutes`, with `finance`. */
const mini = (finance: Finance): SimInput => ({
  ...base,
  calibration: miniCalibrationWithRoutes(),
  finance
});
const tiny = (finance: Finance, q: Parameters<typeof tinyQueue>[0] = {}): SimInput => ({
  ...tinyQueue(q),
  finance
});
const stack = (o: Omit<TinyStackOpts, 'asOf'>) => tinyStack({ asOf, ...o });

interface Run extends Collected {
  /** the funded schedules in award order */
  awards: Schedule[];
  /** each award's commit events, in award order (one per listed programme) */
  commits: LedgerEvent[][];
  /** the largest size of any application ever in line, and of any funded project */
  largest: number;
  /** the applications waiting at the horizon */
  waiting: number;
}

/** One run, with the ledger identities checked and each award's commits split out. */
function run(input: SimInput, seed: number): Run {
  let largest = 0;
  let waiting = 0;
  const c = runCollect(input, seed, H, {
    lineProbe(day, apps) {
      for (const a of apps) largest = Math.max(largest, a.units);
      if (day === H) waiting = apps.length;
    }
  });
  checkLedger(c.ledger, input.finance!, c.probes);
  const ids = new Map(c.schedules.map((s) => [s.projectId, s]));
  const awards = c.order.map((id) => ids.get(id)!).filter((s) => s.funding !== undefined);
  for (const s of awards) largest = Math.max(largest, s.revisions[0].units);
  const all = c.ledger.filter((e) => e.kind === 'commit');
  let n = 0;
  const commits = awards.map((s) => {
    const mine = all.slice(n, n + s.funding!.programmes.length);
    n += mine.length;
    // the commits line up with the award: its day, its programmes in order
    expect(mine.map((e) => [e.day, e.programme])).toEqual(
      s.funding!.programmes.map((p) => [s.revisions[0].day, p])
    );
    return mine;
  });
  expect(n).toBe(all.length);
  return { ...c, awards, commits, largest, waiting };
}

const commitOf = (cs: LedgerEvent[], programme: string) =>
  cs.find((e) => e.programme === programme)?.dollars;

/** The schedule's funding priced again from `funding.programmes` (spec 4.12). */
function reprice(fin: Finance, s: Schedule) {
  const progs = s.funding!.programmes.map((id) => fin.programmes.find((g) => g.id === id)!);
  const items = progs.map((g) => ({
    instrument: g.instrument,
    poolKind: fin.pools.find((q) => q.id === g.pool)!.kind
  }));
  const r0 = s.revisions[0];
  const p = prototypeFor(r0.stories!, r0.units);
  return fundBundle(items, s.kind ?? 'market', p, fin.terms);
}

describe('a bond stacked on the baseline adds homes (spec 6 test 4)', () => {
  /**
   * The City pool C and the bond B_d, once each on asOf; `t-state` ample. B_d is large enough
   * beside C that the City pool runs short first (its pro rata part, 123,176.65 a home, is the
   * smaller one, so B_d > C × 176,850.35 ÷ 123,176.65 is needed).
   */
  const cases: { name: string; input: (bond: boolean) => SimInput; C: number; B: number }[] = [
    {
      name: 'tinyQueue',
      C: CITY * 20,
      B: CITY * 40,
      input: (bond) =>
        tiny(
          stack({
            city: [once(asOf, CITY * 20)],
            ...(bond ? { bond: { share: 0.5, from: asOf, inflows: [once(asOf, CITY * 40)] } } : {})
          }),
          { logOdds: NEVER }
        )
    },
    {
      name: 'the mini city',
      C: CITY * 60,
      B: CITY * 120,
      input: (bond) =>
        mini(
          stack({
            city: [once(asOf, CITY * 60)],
            ...(bond ? { bond: { share: 0.5, from: asOf, inflows: [once(asOf, CITY * 120)] } } : {})
          })
        )
    }
  ];

  for (const k of cases) {
    it(`${k.name}: H fills C + B_d to within one more project from each pool`, () => {
      let both = 0;
      let bondOnly = 0;
      for (const seed of seeds(20)) {
        const homes = (r: Run) => r.awards.reduce((n, s) => n + s.revisions[0].units, 0);
        const without = run(k.input(false), seed);
        const withBond = run(k.input(true), seed);
        const H0 = homes(without);
        const H1 = homes(withBond);
        // more applicants than money
        expect(without.waiting, `seed ${seed}: someone waits without the bond`).toBeGreaterThan(0);
        expect(withBond.waiting, `seed ${seed}: someone waits with the bond`).toBeGreaterThan(0);
        expect(H0 * CITY).toBeLessThanOrEqual(k.C);
        expect(k.C - H0 * CITY).toBeLessThan(2 * CITY * without.largest);
        expect(H1 * CITY).toBeLessThanOrEqual(k.C + k.B);
        expect(k.C + k.B - H1 * CITY).toBeLessThan(2 * CITY * withBond.largest);
        expect(H1, `seed ${seed}: the bond adds homes`).toBeGreaterThan(H0);

        for (const r of [without, withBond]) {
          for (const s of r.awards) {
            const u = s.revisions[0].units;
            expect(s.kind).toBe('affordable');
            expect(s.funding!.certain).toBe(true);
            expect(s.funding!.granted).toBeLessThanOrEqual(projectDollars(TOTAL, u));
          }
        }
        for (const s of without.awards) {
          expect(s.funding!.programmes).toEqual(['t-fed', 't-state', 't-city']);
        }
        withBond.awards.forEach((s, n) => {
          const u = s.revisions[0].units;
          const cs = withBond.commits[n];
          const ps = s.funding!.programmes;
          expect(ps.slice(0, 2)).toEqual(['t-fed', 't-state']);
          if (ps.includes('t-city') && ps.includes('t-bond-grant')) {
            // both pools pay: F8's pro rata, rounded per project
            both++;
            expect(commitOf(cs, 't-city')).toBe(projectDollars(CITY_PRO_RATA, u));
            expect(commitOf(cs, 't-bond-grant')).toBe(projectDollars(BOND_PRO_RATA, u));
          } else if (ps.includes('t-bond-grant')) {
            // the City pool is short: the bond pays the City tier's whole part, not its share
            bondOnly++;
            expect(ps).toEqual(['t-fed', 't-state', 't-bond-grant']);
            expect(commitOf(cs, 't-bond-grant')).toBe(projectDollars(CITY, u));
          } else {
            // the bond is short: the City grant pays its full share again
            expect(ps).toEqual(['t-fed', 't-state', 't-city']);
            expect(commitOf(cs, 't-city')).toBe(projectDollars(CITY, u));
          }
        });
        // the first award, with both pools full, takes from both
        expect(withBond.awards[0].funding!.programmes).toEqual([
          't-fed',
          't-state',
          't-city',
          't-bond-grant'
        ]);
      }
      expect(CITY_PRO_RATA).toBeCloseTo(123176.65, 1);
      expect(BOND_PRO_RATA).toBeCloseTo(176850.35, 1);
      expect(both).toBeGreaterThan(0);
      expect(bondOnly).toBeGreaterThan(0);
    });
  }
});

describe('a short pool is made up by another only as far as its share allows (spec 6 test 4)', () => {
  const input = (share: number) =>
    tiny(stack({ city: [], bond: { share, from: asOf, inflows: [once(asOf, AMPLE)] } }), {
      logOdds: NEVER
    });

  it('bond share 0.2: the application waits and no pool has a commit that day', () => {
    for (const seed of seeds(5)) {
      const r = run(input(0.2), seed);
      expect(r.ledger.filter((e) => e.kind === 'commit' && e.day === asOf + 1)).toEqual([]);
      expect(r.ledger.filter((e) => e.kind === 'commit')).toEqual([]);
      expect(funded(r)).toEqual([]);
      expect(r.waiting).toBe(5);
    }
  });

  it('bond share 0.5: awarded the same day, certain, the bond paying the City part', () => {
    for (const seed of seeds(5)) {
      const r = run(input(0.5), seed);
      expect(r.awards.length).toBe(5);
      r.awards.forEach((s, n) => {
        const u = s.revisions[0].units;
        expect(s.revisions[0].day).toBe(asOf + 1);
        expect(s.funding!.applied).toBe(asOf + 1);
        expect(s.funding!.certain).toBe(true);
        expect(s.funding!.programmes).toEqual(['t-fed', 't-state', 't-bond-grant']);
        expect(commitOf(r.commits[n], 't-bond-grant')).toBe(projectDollars(CITY, u));
      });
      expect(r.awards.map((s) => s.projectId).sort()).toEqual([0, 1, 2, 3, 4].map((i) => sid(i)));
    }
  });
});

describe('`funding.programmes` and re-pricing agree (spec 4.12, spec 6 test 4)', () => {
  const inputs: { name: string; input: SimInput }[] = [
    { name: 'miniFinance', input: mini(miniFinance(asOf)) },
    {
      name: 'tinyStack with a bond on the mini city',
      input: mini(
        stack({
          city: [once(asOf, CITY * 60)],
          bond: { share: 0.5, from: asOf, inflows: [once(asOf, CITY * 120)] }
        })
      )
    },
    {
      name: 'tinyStack with a bond on tinyQueue',
      input: tiny(
        stack({
          city: [once(asOf, CITY * 20)],
          bond: { share: 0.5, from: asOf, inflows: [once(asOf, CITY * 40)] }
        })
      )
    }
  ];

  for (const { name, input } of inputs) {
    it(name, () => {
      const fin = input.finance!;
      const order = new Map(fin.programmes.map((g, i) => [g.id, i]));
      let n = 0;
      let certain = 0;
      for (const seed of seeds(20)) {
        for (const s of funded(run(input, seed))) {
          n++;
          const f = s.funding!;
          const ix = f.programmes.map((id) => order.get(id)!);
          expect(ix.every((x, i) => x !== undefined && (i === 0 || x > ix[i - 1]))).toBe(true);
          const u = s.revisions[0].units;
          const priced = reprice(fin, s);
          const sum = (k: 'granted' | 'lent' | 'guaranteed') =>
            priced.items.reduce((t, it) => t + projectDollars(it[k], u), 0);
          expect([sum('granted'), sum('lent'), sum('guaranteed')]).toEqual([
            f.granted,
            f.lent,
            f.guaranteed
          ]);
          // every listed programme pays something per home
          expect(
            priced.items.every((it) => it.granted > 0 || it.lent > 0 || it.guaranteed > 0)
          ).toBe(true);
          expect(isCertain(priced.coverage)).toBe(f.certain);
          if (f.certain) {
            certain++;
            expect(s.end.kind).not.toBe('exit');
            expect(s.revisions.length).toBe(1);
          }
        }
      }
      expect(n).toBeGreaterThan(0);
      expect(certain).toBeGreaterThan(0);
      if (name === 'miniFinance') expect(certain).toBeLessThan(n);
    });
  }
});
