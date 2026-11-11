// finance-engine Task 8: re-pricing, lapse and regimes of waiting applications (spec 4.6 "When
// the line is served", "Known limit", "Leaving the line"; 4.8 step 3; 4.11; section 6 test 4).
import { describe, expect, it } from 'vitest';
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import type { Day } from '$lib/timelapse/time';
import type { Inflow } from '$lib/timelapse/types';
import { runOf } from './engine';
import { TINY_IDS, tinyQueue, tinyStack, type TinyStackOpts } from './fixtures/tiny-queue';
import { attemptLatents, financePreOf, fundedRunStats, respell } from './funded';
import type { App } from './line';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { checkLedger, runCollect, type Collected } from './test/finance-harness';
import type { Schedule, SimInput } from './types';

const H = GOLDEN_HORIZON;
const F = FILL_LEVELS.length;
const asOf = goldenInput().asOf;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const once = (day: Day, dollars: number): Inflow => ({ kind: 'once', day, dollars });
const AMPLE = 1_000_000_000_000;
const ROWS = [0, 1, 2, 3, 4];
const sid = (row: number, k = 0) => `sim:${TINY_IDS[row]}:${k}`;
const byId = (ss: Schedule[]) => new Map(ss.map((s) => [s.projectId, s]));
const funded = (c: Collected) => c.schedules.filter((s) => s.funding !== undefined);
/** the City-short level of a certain tinyStack bundle with `t-state` off: (fed + City) ÷ total */
const FED_CITY = (443108 + 300027) / 861525;

/** A waiting application as the line held it at the end of a day (copied: re-making mutates). */
type Snap = Pick<App, 'lot' | 'kind' | 'applied' | 'keyDay' | 'level' | 'view' | 'units'> & {
  bundle: number[];
};

interface Probed extends Collected {
  /** per processed day (and the horizon, for the end of the run): the line after the day */
  line: Map<Day, Snap[]>;
  stats: ReturnType<typeof fundedRunStats>;
}

/** One run with the ledger checked, the line snapshotted after every day, and the run's stats. */
function run(input: SimInput, seed: number, horizon: Day = H): Probed {
  const line = new Map<Day, Snap[]>();
  const c = runCollect(input, seed, horizon, {
    lineProbe(day, apps) {
      line.set(
        day,
        apps.map((a) => ({
          lot: a.lot,
          kind: a.kind,
          applied: a.applied,
          keyDay: a.keyDay,
          level: a.level,
          view: a.view,
          units: a.units,
          bundle: [...a.bundle]
        }))
      );
    }
  });
  const stats = fundedRunStats();
  checkLedger(c.ledger, input.finance!, c.probes);
  return { ...c, line, stats };
}

/** The line at the end of the last processed day before D. */
function lineBefore(p: Probed, D: Day): Snap[] {
  let best = -Infinity;
  for (const d of p.line.keys()) if (d < D && d > best) best = d;
  return best === -Infinity ? [] : p.line.get(best)!;
}

const withStack = (o: Omit<TinyStackOpts, 'asOf'>, q: Parameters<typeof tinyQueue>[0] = {}) => ({
  ...tinyQueue(q),
  finance: tinyStack({ asOf, ...o })
});

/** Attempt 0's latents of a tiny lot at risk from asOf. */
const lat0 = (input: SimInput, seed: number, row: number) =>
  attemptLatents(input, seed, H, row, 0, asOf, input.parcels.existingUnits[row]);

/** The new spell `respell` gives attempt 0 of a tiny lot after a lapse on D. */
function spell(input: SimInput, seed: number, row: number, D: Day) {
  const r = runOf(input, seed, H, true);
  return respell(r, financePreOf(input), row, lat0(input, seed, row), 'affordable', D);
}

const NEVER = Array(5).fill(-12);
const LOGODDS = -3;

describe('re-pricing days (FinancePre.repricing)', () => {
  it('programme and off bounds and regime days after asOf, once each; market days are not', () => {
    const base = withStack({
      cityTo: asOf + 99,
      bond: { share: 0.5, from: asOf + 50, to: asOf + 400, inflows: [] },
      off: [
        { pool: 't-state', from: asOf + 100, to: asOf + 199 },
        { pool: 't-bond', from: asOf - 30, to: null }
      ]
    });
    const input: SimInput = {
      ...base,
      market: [
        { from: asOf - 400, logOdds: 0 },
        { from: asOf + 300, logOdds: 0.2 }
      ],
      regimes: [{ day: asOf + 100, parcels: base.parcels }]
    };
    const fp = financePreOf(input);
    expect(fp.repricing).toEqual([asOf + 50, asOf + 100, asOf + 200, asOf + 401]);
    expect(fp.days).toContain(asOf + 300);
  });
});

describe('a programme opening later (spec 6 test 4)', () => {
  it('re-prices the waiting line in place, and the first ones in line are awarded that day', () => {
    const B = asOf + 365;
    const input = withStack(
      { city: [], bond: { share: 0.5, from: B, inflows: [once(asOf, AMPLE)] } },
      { logOdds: NEVER }
    );
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      // keyDay, then parcel rank: the line's order
      const want = ROWS.map((row) => ({ row, lat: lat0(input, seed, row).affordable! })).sort(
        (a, b) => a.lat.keyDay - b.lat.keyDay || a.row - b.row
      );
      expect(want.every((w) => w.lat.day === asOf + 1)).toBe(true);
      const first = c.line.get(asOf + 1)!;
      expect(first.map((a) => a.lot)).toEqual(want.map((w) => w.row));
      expect(first.every((a) => a.applied === asOf + 1 && a.bundle.length === 3)).toBe(true);
      expect(lineBefore(c, B)).toEqual(first);
      expect(c.ledger.filter((e) => e.kind === 'commit' && e.day < B)).toEqual([]);
      // all five awarded on B in line order, keeping their applied day
      expect(c.order.filter((id) => ids.get(id)!.funding)).toEqual(want.map((w) => sid(w.row)));
      for (const w of want) {
        const s = ids.get(sid(w.row))!;
        expect(s.revisions[0].day).toBe(B);
        expect(s.funding!.applied).toBe(asOf + 1);
        expect(s.funding!.certain).toBe(true);
        expect(s.funding!.programmes).toEqual(['t-fed', 't-state', 't-bond-grant']);
      }
      expect(c.stats.respells).toBe(0);
    }
  });
});

describe('a programme ending (spec 6 test 4)', () => {
  it('lapses its waiting applications on to + 1, and each re-spells on the federal and state shares', () => {
    const D = asOf + 61;
    const input = withStack({ city: [], cityTo: D - 1 });
    let lapsed = 0;
    let again = 0;
    for (const seed of seeds(20)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      const waiting = lineBefore(c, D);
      expect(c.stats.respells).toBe(waiting.length);
      for (const a of waiting) {
        lapsed++;
        expect(a.applied).toBe(asOf + 1);
        const nl = spell(input, seed, a.lot, D);
        const s = ids.get(sid(a.lot));
        const O = lat0(input, seed, a.lot).O;
        if (nl === null || (O !== null && O < nl.day!)) {
          // no new application, or the ordinary start comes first (on one day the funded start
          // is served first)
          expect(s?.funding).toBeUndefined();
          continue;
        }
        again++;
        expect(nl.day!).toBeGreaterThanOrEqual(D);
        expect(s!.funding!.applied).toBe(nl.day);
        expect(s!.revisions[0].day).toBe(nl.day);
        expect(s!.funding!.programmes).toEqual(['t-fed', 't-state']);
        expect(s!.funding!.certain).toBe(false);
      }
      expect(funded(c).every((s) => s.funding!.applied >= D)).toBe(true);
    }
    expect(lapsed).toBeGreaterThan(20);
    expect(again).toBeGreaterThan(0);
  });
});

describe('a pool switched off (spec 6 test 4)', () => {
  const D = asOf + 200;
  const E = asOf + 601;
  const input = withStack(
    { city: [], off: [{ pool: 't-state', from: D, to: E - 1 }] },
    { logOdds: NEVER }
  );

  it('every waiting application lapses on its from and is drawn again on its same u and v', () => {
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      const before = lineBefore(c, D);
      expect(before.length).toBe(5);
      expect(before.every((a) => a.level === 1 && a.applied === asOf + 1)).toBe(true);
      expect(c.stats.respells).toBe(5);
      // no state money is received while the pool is off
      const stateIn = c.ledger.filter((e) => e.kind === 'in' && e.pool === 't-state');
      expect(stateIn.some((e) => e.day >= D && e.day < E)).toBe(false);
      expect(stateIn.some((e) => e.day >= E)).toBe(true);
      const end = c.line.get(H)!;
      expect(end.map((a) => a.lot).sort()).toEqual(ROWS);
      for (const a of end) {
        const nl = spell(input, seed, a.lot, D)!;
        expect(a.applied).toBe(nl.day);
        expect(a.keyDay).toBe(nl.keyDay);
        expect(a.applied).toBeGreaterThanOrEqual(D);
        const old = before.find((b) => b.lot === a.lot)!;
        expect(a.keyDay === old.keyDay && a.applied === old.applied).toBe(false);
      }
      // no new application is certain before E
      for (const [day, apps] of c.line) {
        for (const a of apps) {
          if (a.applied >= D && a.applied < E) expect(a.level).toBeLessThan(1);
          if (day >= D && day < E && a.applied < D) throw new Error('an old application survived');
        }
      }
      expect(funded(c)).toEqual([]);
    }
  });

  it('when the pool comes back on, waiting applications whose level rises keep their place', () => {
    // likelier starts, so some new spells apply before E at the federal and City level
    const likely = withStack(
      { city: [], off: [{ pool: 't-state', from: D, to: E - 1 }] },
      { logOdds: Array(5).fill(LOGODDS) }
    );
    let rose = 0;
    for (const seed of seeds(40)) {
      const c = run(likely, seed);
      const before = lineBefore(c, E);
      const after = c.line.get(E)!;
      for (const a of before) {
        if (a.applied >= E) continue;
        const b = after.find((x) => x.lot === a.lot && x.kind === a.kind)!;
        expect(b.applied).toBe(a.applied);
        expect(b.keyDay).toBe(a.keyDay);
        expect(a.level).toBeCloseTo(FED_CITY, 12);
        expect(b.level).toBe(1);
        rose++;
      }
      expect(c.stats.respells).toBe(lineBefore(c, D).length);
    }
    expect(rose).toBeGreaterThan(0);
  });

  it('bond off while it shares the City tier lapses nothing: the level stays 1', () => {
    const off = withStack(
      {
        city: [],
        bond: { share: 0.5, from: asOf, inflows: [] },
        off: [{ pool: 't-bond', from: D, to: null }]
      },
      { logOdds: NEVER }
    );
    for (const seed of seeds(5)) {
      const c = run(off, seed);
      expect(lineBefore(c, D).every((a) => a.bundle.length === 4 && a.level === 1)).toBe(true);
      expect(c.stats.respells).toBe(0);
      const end = c.line.get(H)!;
      expect(end.length).toBe(5);
      for (const a of end) {
        expect(a.applied).toBe(asOf + 1);
        expect(a.level).toBe(1);
        expect(a.bundle).toEqual([0, 1, 2]);
      }
    }
  });
});

describe('the known limit: an application waits on a spent pool (spec 4.6)', () => {
  const units = [10, 10, 10, 10, 10];
  const one = 300027 * 10;
  const city = [once(asOf, Math.round(one * 1.5))];

  it('the second application is never awarded, never lapses, and waits to the horizon', () => {
    const input = withStack({ city }, { logOdds: NEVER, units });
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      expect(funded(c).length).toBe(1);
      expect(c.stats.respells).toBe(0);
      expect(c.stats.awards).toBe(1);
      const end = c.line.get(H)!;
      expect(end.length).toBe(4);
      expect(end.every((a) => a.applied === asOf + 1 && a.level === 1)).toBe(true);
      expect(c.ledger.filter((e) => e.kind === 'in' && e.pool === 't-city').length).toBe(1);
    }
  });

  it('ending the City programme later lapses it on to + 1 and redraws it as a new spell', () => {
    const D = asOf + 61;
    const input = withStack({ city, cityTo: D - 1 }, { units });
    let lapsed = 0;
    let again = 0;
    for (const seed of seeds(20)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      const waiting = lineBefore(c, D);
      expect(c.stats.respells).toBe(waiting.length);
      for (const a of waiting) {
        lapsed++;
        const nl = spell(input, seed, a.lot, D);
        const O = lat0(input, seed, a.lot).O;
        const s = ids.get(sid(a.lot));
        if (nl === null || (O !== null && O < nl.day!)) continue;
        again++;
        expect(s!.funding!.applied).toBe(nl.day);
        expect(s!.funding!.programmes).toEqual(['t-fed', 't-state']);
      }
    }
    expect(lapsed).toBeGreaterThan(20);
    expect(again).toBeGreaterThan(0);
  });
});

describe('regimes (spec 4.11)', () => {
  it('a waiting application is re-made on a regime day and runs on its award day’s view', () => {
    const R = asOf + 300;
    const X = asOf + 500;
    const base = tinyQueue({ logOdds: NEVER });
    const doubled = { ...base.parcels, yield: base.parcels.yield.map((y) => y * 2) };
    const input: SimInput = {
      ...base,
      regimes: [{ day: R, parcels: doubled }],
      finance: tinyStack({ asOf, city: [once(X, AMPLE)] })
    };
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      const before = lineBefore(c, R);
      expect(before.length).toBe(5);
      expect(before.every((a) => a.view === 0)).toBe(true);
      const after = c.line.get(R)!;
      expect(after.map((a) => [a.lot, a.applied, a.keyDay])).toEqual(
        before.map((a) => [a.lot, a.applied, a.keyDay])
      );
      expect(after.every((a) => a.view === 1)).toBe(true);
      expect(c.stats.respells).toBe(0);
      const all = funded(c);
      expect(all.length).toBe(5);
      for (const s of all) {
        const row = input.parcels.index.get(s.parcelIds[0])!;
        expect(s.revisions[0].day).toBe(X);
        expect(s.funding!.applied).toBe(asOf + 1);
        expect(s.regime).toBe(1);
        expect(s.revisions[0].units).toBe(doubled.yield[row * F + F - 1]);
      }
    }
  });
});

describe('review focus 2: change kinds on one day', () => {
  const D = asOf + 400;

  it('FinancePre holds the day once, and a lapse compares with the bundle just before D', () => {
    // At D the state pool goes off and a bond opens: the level stays 1, so nothing lapses (one
    // change at a time would lapse every application on the state pool alone).
    const base = tinyQueue({ logOdds: NEVER });
    const input: SimInput = {
      ...base,
      regimes: [{ day: D, parcels: base.parcels }],
      finance: tinyStack({
        asOf,
        city: [],
        bond: { share: 0.5, from: D, inflows: [once(asOf, AMPLE)] },
        off: [{ pool: 't-state', from: D, to: null }]
      })
    };
    const fp = financePreOf(input);
    expect(fp.days.filter((d) => d === D).length).toBe(1);
    expect(fp.repricing).toEqual([D]);
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      expect(lineBefore(c, D).length).toBe(5);
      expect(c.stats.respells).toBe(0);
      const all = funded(c);
      expect(all.length).toBe(5);
      for (const s of all) {
        expect(s.revisions[0].day).toBe(D);
        expect(s.funding!.applied).toBe(asOf + 1);
        expect(s.funding!.programmes).toEqual(['t-fed', 't-bond-grant']);
      }
    }
  });

  it('a programme end, a pool off and a regime on one day re-make each application once', () => {
    const base = tinyQueue({ logOdds: NEVER });
    const input: SimInput = {
      ...base,
      regimes: [{ day: D, parcels: base.parcels }],
      finance: tinyStack({
        asOf,
        city: [],
        cityTo: D - 1,
        off: [{ pool: 't-state', from: D, to: null }]
      })
    };
    const fp = financePreOf(input);
    expect(fp.days.filter((d) => d === D).length).toBe(1);
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      expect(lineBefore(c, D).length).toBe(5);
      expect(c.stats.respells).toBe(5);
      for (const a of c.line.get(H)!) {
        expect(a.applied).toBeGreaterThanOrEqual(D);
        expect(a.bundle).toEqual([0]);
      }
    }
  });
});

describe('stats', () => {
  it('respells is reset per run', () => {
    const lapsing = withStack(
      { city: [], off: [{ pool: 't-state', from: asOf + 200, to: null }] },
      { logOdds: NEVER }
    );
    const quiet = withStack({ city: [] }, { logOdds: NEVER });
    expect(run(lapsing, 1).stats.respells).toBe(5);
    expect(run(quiet, 1).stats.respells).toBe(0);
  });
});
