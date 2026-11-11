// finance-engine Task 7: funded starts, the line and the pools in the engine (spec 4.1, 4.5 to
// 4.12, 4.16; section 6 test 4). Re-pricing is Task 8's (engine-finance-repricing.spec.ts).
import { describe, expect, it } from 'vitest';
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import { MARKET_TERMS, projectDollars, resolveTerms } from '$lib/sim/finance';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import {
  PATHWAYS,
  STAGE_ORDER,
  type Inflow,
  type Pathway,
  type Pool,
  type PoolKind,
  type Programme,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import { scaleTable, type StageScale } from '../levers/timers';
import type { TimedStage } from '../levers/types';
import { dayOf } from './dates';
import { nextStage, runOf } from './engine';
import { benchRoutes } from './fixtures/bench-finance';
import { miniCalibrationWithRoutes, miniFinance } from './fixtures/mini-finance';
import { selectRows } from './fixtures/select-rows';
import { synthCity } from './fixtures/synth-city';
import { TINY_IDS, tinyQueue, tinyStack } from './fixtures/tiny-queue';
import { attemptLatents, financePreOf, latentsOf, lineKey } from './funded';
import { buildSimInput, precomputeOf, sizeCumAgainst } from './input';
import { P, drawOn, simEntity, streamOf } from './rng';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { checkLedger, runCollect, type Collected } from './test/finance-harness';
import type { Schedule, SimInput } from './types';

type Finance = NonNullable<SimInput['finance']>;

const H = GOLDEN_HORIZON;
const F = FILL_LEVELS.length;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const base = goldenInput();
const asOf = base.asOf;
const routesCal = miniCalibrationWithRoutes();
/** The mini city on the calibration with `affordableRoutes`. */
const mini = (over: Partial<SimInput> = {}): SimInput => ({
  ...base,
  calibration: routesCal,
  ...over
});
const withFinance = (input: SimInput, finance: Finance | undefined): SimInput => {
  const { finance: _drop, ...rest } = input;
  return finance ? { ...rest, finance } : rest;
};

/** One run, with the ledger identities checked whenever the input has finance. */
function run(input: SimInput, seed: number, horizon: Day = H): Collected {
  const c = runCollect(input, seed, horizon);
  if (input.finance) checkLedger(c.ledger, input.finance, c.probes);
  return c;
}

const byId = (ss: Schedule[]) => new Map(ss.map((s) => [s.projectId, s]));
const funded = (c: Collected) => c.schedules.filter((s) => s.funding !== undefined);
const sid = (row: number, k = 0) => `sim:${TINY_IDS[row]}:${k}`;
const firstStage = (s: Schedule): Stage => STAGE_ORDER.find((g) => s.entered[g] !== undefined)!;

const pool = (id: string, kind: PoolKind, inflows: Inflow[], uncapped = false): Pool => ({
  id,
  kind,
  label: id,
  inflows,
  uncapped,
  debt: kind === 'goBond' || kind === 'cop' ? { rate: 0.04, termYears: 30 } : null,
  leverage: kind === 'bank' ? 0.8 : 1
});
const TIERS = { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 };
const grant = (id: string, poolId: string, reach: 'market' | 'affordable', share: number) =>
  ({
    id,
    label: id,
    pool: poolId,
    reach,
    instrument: { kind: 'grant', share },
    from: asOf,
    to: null,
    minHomes: 1,
    tiers: reach === 'affordable' ? { ...TIERS } : null
  }) satisfies Programme;
const once = (day: Day, dollars: number): Inflow => ({ kind: 'once', day, dollars });
const AMPLE = 1_000_000_000_000;

/** The ids of the rows some in-flight project names (the engine's held rows). */
function heldRows(input: SimInput): Set<number> {
  const held = new Set<number>();
  for (const p of input.projects) {
    for (const id of [...p.parcelIds, ...(p.phases ?? []).flatMap((ph) => ph.parcelIds)]) {
      const i = input.parcels.index.get(id);
      if (i !== undefined) held.add(i);
    }
  }
  return held;
}

/** The latents of attempt 0 of a tiny lot at risk from asOf. */
const lat0 = (input: SimInput, seed: number, row: number) =>
  attemptLatents(input, seed, H, row, 0, asOf, input.parcels.existingUnits[row]);

describe('no public money means no change', () => {
  const MID = dayOf(2032, 1, 31);
  const doubled = {
    ...base.parcels,
    yield: base.parcels.yield.map((y) => y * 2)
  };
  const reserved = new Int32Array(base.parcels.count);
  for (let i = 0; i < reserved.length; i += 3) reserved[i] = asOf + 1000 + 37 * i;
  const scale: StageScale = scaleTable([], 'new');
  scale.discretionary.filed = 0.5;
  scale.streamlined.permitFiled = 0.5;
  const variants: Record<string, SimInput> = {
    plain: mini(),
    regimes: mini({ regimes: [{ day: MID, parcels: doubled }] }),
    reserved: mini({ reservedFrom: reserved }),
    timers: mini({ newProjects: { calibration: routesCal, scale } })
  };
  const empty = (): Finance => ({
    pools: [],
    programmes: [],
    off: [],
    slope: 3,
    terms: resolveTerms()
  });
  const never = (): Finance => {
    const f = miniFinance(asOf);
    for (const g of f.programmes) {
      g.from = asOf - 10;
      g.to = asOf - 1;
    }
    return f;
  };
  const allOff = (): Finance => {
    const f = miniFinance(asOf);
    f.off = f.pools.map((p) => ({ pool: p.id, from: asOf, to: null }));
    return f;
  };

  for (const [name, input] of Object.entries(variants)) {
    it(`${name}: an empty, a never-active and an all-off finance give the run without finance`, () => {
      const finances = [empty(), never(), allOff()].map((f) => withFinance(input, f));
      for (const seed of seeds(50)) {
        const R = run(input, seed);
        expect(R.ledger).toEqual([]);
        for (const [n, inp] of finances.entries()) {
          const got = run(inp, seed);
          expect(got.schedules).toEqual(R.schedules);
          expect(got.reservations).toEqual(R.reservations);
          for (const s of got.schedules) {
            expect('kind' in s || 'funding' in s).toBe(false);
          }
          if (n === 2) expect(got.ledger.filter((e) => e.kind === 'in')).toEqual([]);
        }
      }
    });
  }
});

describe('moneyless pools change nothing', () => {
  const moneyless = (): Finance => {
    const f = tinyStack({ asOf, state: [], city: [], bond: undefined });
    f.programmes = f.programmes.filter((g) => g.id !== 't-fed');
    return f;
  };
  it('parked lots start ordinarily in the day loop, as without finance', () => {
    let parked = 0;
    for (const input of [tinyQueue(), mini()]) {
      const fin = withFinance(input, moneyless());
      for (const seed of seeds(20)) {
        const R = run(input, seed);
        const got = run(fin, seed);
        expect(got.schedules).toEqual(R.schedules);
        expect(got.ledger.filter((e) => e.kind !== 'in')).toEqual([]);
        // a lot parks when its affordable application is on or before its ordinary start
        for (const s of R.schedules) {
          if (s.origin !== 'simulated' || !s.projectId.endsWith(':0')) continue;
          const row = input.parcels.index.get(s.parcelIds[0])!;
          if (heldRows(input).has(row)) continue;
          const lat = attemptLatents(fin, seed, H, row, 0, asOf, input.parcels.existingUnits[row]);
          if (lat.affordable?.day != null && lat.affordable.day <= s.revisions[0].day) parked++;
        }
      }
    }
    expect(parked).toBeGreaterThan(5);
  });
});

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random valid finance on `asOf` (test values). */
function randomFinance(seed: number): Finance {
  const r = rng(seed * 7919 + 13);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const kinds: PoolKind[] = ['generalRevenue', 'state', 'dedicatedTax', 'bank', 'goBond'];
  const pools: Pool[] = [];
  const nCapped = 1 + Math.floor(r() * 3);
  for (let q = 0; q < nCapped; q++) {
    const inflows: Inflow[] = [];
    const nIn = Math.floor(r() * 3);
    for (let j = 0; j < nIn; j++) {
      if (r() < 0.5) inflows.push(once(asOf + Math.floor(r() * 4000), Math.floor(r() * 3e7)));
      else {
        const from = asOf + Math.floor(r() * 1000);
        inflows.push({
          kind: 'yearly',
          from,
          to: r() < 0.5 ? null : from + Math.floor(r() * 5000),
          dollarsPerYear: Math.floor(r() * 2e7)
        });
      }
    }
    const p = pool(`p${q}`, pick(kinds), inflows);
    if (p.kind === 'bank') p.leverage = 0.5 + r() * 0.5;
    pools.push(p);
  }
  if (r() < 0.6) pools.push(pool('fed', 'federal', [], true));
  const programmes: Programme[] = [];
  const nProg = 1 + Math.floor(r() * 5);
  for (let g = 0; g < nProg; g++) {
    const reach = r() < 0.5 ? 'market' : 'affordable';
    const x = r();
    const instrument: Programme['instrument'] =
      x < 0.5
        ? { kind: 'grant', share: 0.05 + r() * 0.95 }
        : x < 0.75
          ? { kind: 'loan', costShare: 0.1 + r() * 0.7, rate: r() * 0.08, requiredReturn: null }
          : { kind: 'guarantee', costShare: 0.2 + r() * 0.6, reserve: 0.05 + r() * 0.25 };
    const from = asOf - 100 + Math.floor(r() * 3000);
    programmes.push({
      id: `g${g}`,
      label: `g${g}`,
      pool: pick(pools).id,
      reach,
      instrument,
      from,
      to: r() < 0.6 ? null : from + Math.floor(r() * 4000),
      minHomes: Math.floor(r() * 4),
      tiers: reach === 'affordable' ? { ...TIERS } : null
    });
  }
  const off: Finance['off'] = [];
  if (r() < 0.4) {
    const from = asOf + Math.floor(r() * 5000);
    off.push({ pool: pick(pools).id, from, to: r() < 0.5 ? null : from + Math.floor(r() * 800) });
  }
  return {
    pools,
    programmes,
    off,
    slope: 1 + r() * 4,
    terms: resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01, lossOnExit: r() })
  };
}

describe('conservation (property)', () => {
  for (const [name, city] of [
    ['the mini city', () => mini()],
    ['tinyQueue', () => tinyQueue()]
  ] as const) {
    it(`200 random finances on ${name}: E1 to E7 after every event, available >= 0`, () => {
      let commits = 0;
      for (let n = 1; n <= 200; n++) {
        const finance = randomFinance(n);
        const c = run(withFinance(city(), finance), n);
        c.ledger.forEach((e, k) => {
          if (e.kind !== 'commit') return;
          commits++;
          const probe = c.probes.find((p) => p.after === k)!;
          finance.pools.forEach((p, q) => {
            if (!p.uncapped) expect(probe.available[q]).toBeGreaterThanOrEqual(0);
          });
        });
        expect(c.probes.length).toBe(c.ledger.length);
      }
      expect(commits).toBeGreaterThan(50);
    }, 120_000);
  }
});

describe('determinism and lot order', () => {
  it('two runs are identical, and permuting the rows changes nothing', () => {
    const input = mini({ finance: miniFinance(asOf) });
    const p = input.parcels;
    const rows = Array.from({ length: p.count }, (_, i) => p.count - 1 - i);
    const parcels = selectRows(
      p,
      rows,
      rows.map((r) => p.id[r]),
      () => 'all'
    );
    const permuted = { ...input, parcels };
    let awards = 0;
    for (const seed of seeds(5)) {
      const a = run(input, seed);
      expect(run(input, seed)).toEqual(a);
      const b = run(permuted, seed);
      expect(b.schedules).toEqual(a.schedules);
      expect(b.ledger).toEqual(a.ledger);
      awards += funded(a).length;
    }
    expect(awards).toBeGreaterThan(5);
  });
});

describe('the plan and the twin share draws', () => {
  it('a capped pool with no inflows and a City-tier grant on it changes no schedule', () => {
    const twin = miniFinance(asOf);
    const plan = miniFinance(asOf);
    plan.pools.push(pool('empty-city', 'dedicatedTax', []));
    plan.programmes.push({ ...grant('empty-grant', 'empty-city', 'affordable', 0.2), minHomes: 2 });
    let awards = 0;
    for (const seed of seeds(10)) {
      const a = run(mini({ finance: twin }), seed);
      const b = run(mini({ finance: plan }), seed);
      expect(b.schedules).toEqual(a.schedules);
      awards += funded(a).length;
    }
    expect(awards).toBeGreaterThan(5);
  });
});

describe('certain projects keep their counterpart’s stage times (spec 6 test 4)', () => {
  const H50 = dayOf(2050, 12, 31);
  const certainMarket = (): Finance => ({
    pools: [pool('fed', 'federal', [], true)],
    programmes: [grant('fed-market', 'fed', 'market', 1)],
    off: [],
    slope: 3,
    terms: resolveTerms(MARKET_TERMS)
  });

  /** Per compared (pathway, stage): the (A days, B days) pairs, over attempt 0 of each lot. */
  function compare(A: Collected, B: Collected) {
    const b = byId(B.schedules);
    const out: { pathway: Pathway; stage: Stage; id: string; a: number; b: number }[] = [];
    for (const s of A.schedules) {
      if (s.origin !== 'simulated' || !s.projectId.endsWith(':0')) continue;
      const t = b.get(s.projectId);
      if (!t || t.pathway !== s.pathway || firstStage(t) !== firstStage(s)) continue;
      for (const stage of STAGE_ORDER) {
        if (stage === 'complete' || s.entered[stage] === undefined) continue;
        const next = s.entered[nextStage(s.pathway, stage)];
        if (next === undefined) continue;
        const tNext = t.entered[nextStage(t.pathway, stage)];
        out.push({
          pathway: s.pathway,
          stage,
          id: s.projectId,
          a: next - s.entered[stage]!,
          b: tNext === undefined ? NaN : tNext - t.entered[stage]!
        });
      }
    }
    return out;
  }

  it('equal days in every compared stage, and a timer scales them alike', () => {
    const A0 = { ...base, market: [] };
    const B0 = { ...A0, finance: certainMarket() };
    const pairs = new Set<string>();
    const unscaledB = new Map<string, number>();
    let compared = 0;
    for (const seed of seeds(20)) {
      const B = run(B0, seed, H50);
      expect(funded(B).every((s) => s.funding!.certain && s.end.kind !== 'exit')).toBe(true);
      for (const c of compare(run(A0, seed, H50), B)) {
        expect(c.b, `${c.id} ${c.stage}`).toBe(c.a);
        pairs.add(`${c.pathway}|${c.stage}`);
        unscaledB.set(`${seed}|${c.id}|${c.stage}`, c.b);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
    const scale = scaleTable([], 'new');
    const scaled = new Set<string>();
    for (const k of pairs) {
      const [pathway, stage] = k.split('|') as [Pathway, Stage];
      if (stage === 'construction') continue;
      scale[pathway][stage as TimedStage] = 0.5;
      scaled.add(k);
    }
    expect(scaled.size).toBeGreaterThan(0);
    const np = { newProjects: { calibration: base.calibration, scale } };
    let again = 0;
    for (const seed of seeds(20)) {
      const B = run({ ...B0, ...np }, seed, H50);
      const Bs = byId(B.schedules);
      for (const c of compare(run({ ...A0, ...np }, seed, H50), B)) {
        expect(c.b, `${c.id} ${c.stage}`).toBe(c.a);
        again++;
      }
      for (const [key, d] of unscaledB) {
        const [s, id, stage] = key.split('|');
        if (Number(s) !== seed) continue;
        const t = Bs.get(id)!;
        if (!scaled.has(`${t.pathway}|${stage}`)) continue;
        const enter = t.entered[stage as Stage]!;
        expect(t.entered[nextStage(t.pathway, stage as Stage)]! - enter).toBe(Math.floor(0.5 * d));
      }
    }
    expect(again).toBeGreaterThan(0);
  });
});

describe('unlimited money, a 100% grant', () => {
  it('every qualifying lot at risk at asOf is awarded on its application day', () => {
    const H50 = dayOf(2050, 12, 31);
    const city = synthCity();
    const cal = parseCalibration(structuredClone(city.calibration));
    const input: SimInput = {
      ...buildSimInput({
        parcels: city.parcels,
        projects: parseProjectsFile(structuredClone(city.projects)),
        calibration: { ...cal, affordableRoutes: benchRoutes() }
      }),
      market: [],
      finance: {
        pools: [pool('fed', 'federal', [], true)],
        programmes: [grant('aff', 'fed', 'affordable', 1)],
        off: [],
        slope: 3,
        terms: resolveTerms(MARKET_TERMS)
      }
    };
    const pre = precomputeOf(input);
    const held = heldRows(input);
    const lp = input.parcels.localProgram;
    const routes = benchRoutes();
    const counts: Record<Pathway, number> = { discretionary: 0, streamlined: 0, permitOnly: 0 };
    let n = 0;
    for (const seed of seeds(5)) {
      const c = runCollect(input, seed, H50);
      const ids = byId(c.schedules);
      const runIn = runOf(input, seed, H50, true);
      const fp = financePreOf(input);
      const missing: string[] = [];
      const keyed: { id: string; key: number }[] = [];
      for (let k = 0; k < pre.candidates.length; k++) {
        const i = pre.candidates[k];
        if (held.has(i) || pre.sizeCum[i * F + F - 1] !== 1) continue;
        const id = `sim:${input.parcels.id[i]}:0`;
        const s = ids.get(id);
        if (!s || s.funding?.applied !== asOf + 1 || s.revisions[0].day !== asOf + 1) {
          missing.push(id);
          continue;
        }
        const lat = latentsOf(
          runIn,
          fp,
          i,
          asOf,
          input.parcels.existingUnits[i],
          streamOf(runIn.sh, pre.entity[k], 0)
        );
        keyed.push({ id, key: lineKey(lat.affordable!.keyDay, fp.rank[i], 'affordable') });
      }
      expect(missing).toEqual([]);
      expect(keyed.length).toBeGreaterThan(1000);
      // award order (the sink's) on the first day is line-key order, and so is the commit order
      const first = c.order.filter((id) => ids.get(id)!.funding?.applied === asOf + 1);
      keyed.sort((a, b) => a.key - b.key);
      expect(first).toEqual(keyed.map((x) => x.id));
      const commits = c.ledger.filter((e) => e.kind === 'commit' && e.day === asOf + 1);
      expect(commits.map((e) => e.dollars)).toEqual(
        first.map((id) => ids.get(id)!.funding!.granted)
      );
      const all = funded(c);
      expect(all.filter((s) => s.end.kind === 'exit')).toEqual([]);
      for (const s of all) {
        if (!s.funding!.certain || s.kind !== 'affordable') continue;
        if (lp[input.parcels.index.get(s.parcelIds[0])!] === 1) continue;
        counts[s.pathway]++;
        n++;
      }
    }
    for (const p of PATHWAYS) {
      const share = routes[p];
      const se = Math.sqrt((share * (1 - share)) / n);
      expect(Math.abs(counts[p] / n - share), p).toBeLessThanOrEqual(3 * se);
    }
  }, 300_000);
});

describe('queue cases on tinyQueue', () => {
  const FED_PER_HOME = 443108;

  it('one day’s applications are served by keyDay, then parcel id', () => {
    let byKey = 0;
    for (const logOdds of [-3, 20]) {
      const input = withFinance(
        tinyQueue({ logOdds: Array(5).fill(logOdds) }),
        tinyStack({ asOf })
      );
      for (const seed of seeds(10)) {
        const c = run(input, seed);
        const want = [0, 1, 2, 3, 4]
          .map((row) => ({ row, lat: lat0(input, seed, row).affordable! }))
          .sort((a, b) => a.lat.keyDay - b.lat.keyDay || a.row - b.row);
        if (want.some((w, k) => w.row !== k)) byKey++;
        expect(want.every((w) => w.lat.day === asOf + 1)).toBe(true);
        expect(c.order.filter((id) => byId(c.schedules).get(id)!.funding)).toEqual(
          want.map((w) => sid(w.row))
        );
        if (logOdds === 20) expect(want.map((w) => w.row)).toEqual([0, 1, 2, 3, 4]);
      }
    }
    expect(byKey).toBeGreaterThan(0);
  });

  it('waiting applications are served by applied day first', () => {
    const X = asOf + 1500;
    const finance = tinyStack({
      asOf,
      city: [once(X, AMPLE)],
      off: [{ pool: 't-state', from: asOf, to: null }]
    });
    const input = withFinance(tinyQueue({ logOdds: Array(5).fill(-4) }), finance);
    let groups = 0;
    let appliedFirst = 0;
    for (const seed of seeds(100)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      const waiting = [0, 1, 2, 3, 4]
        .map((row) => ({ row, lat: lat0(input, seed, row) }))
        .filter(
          ({ lat }) =>
            lat.affordable!.day !== null &&
            lat.affordable!.day < X &&
            (lat.O === null || lat.O >= X)
        )
        .map(({ row, lat }) => ({
          row,
          applied: lat.affordable!.day!,
          keyDay: lat.affordable!.keyDay
        }))
        .sort((a, b) => a.applied - b.applied || a.keyDay - b.keyDay || a.row - b.row);
      // attempt 0 of each lot (a lot that exited may wait again on a later attempt)
      const onX = c.order.filter(
        (id) => id.endsWith(':0') && ids.get(id)!.funding && ids.get(id)!.revisions[0].day === X
      );
      expect(onX).toEqual(waiting.map((w) => sid(w.row)));
      for (const w of waiting) expect(ids.get(sid(w.row))!.funding!.applied).toBe(w.applied);
      if (waiting.length > 1) groups++;
      const byKeyDay = [...waiting].sort((a, b) => a.keyDay - b.keyDay || a.row - b.row);
      if (byKeyDay.some((w, k) => w.row !== waiting[k].row)) appliedFirst++;
    }
    expect(groups).toBeGreaterThan(5);
    expect(appliedFirst).toBeGreaterThan(0);
  });

  it('a smaller later application is awarded past a head that does not fit', () => {
    const units = [40, 5, 40, 40, 40];
    const finance = tinyStack({ asOf, city: [once(asOf, 1_600_000)] });
    const input = withFinance(tinyQueue({ logOdds: Array(5).fill(20), units }), finance);
    for (const seed of seeds(5)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      expect(ids.get(sid(1))!.funding!.applied).toBe(asOf + 1);
      expect(ids.get(sid(1))!.revisions[0].day).toBe(asOf + 1);
      expect(ids.get(sid(0))?.funding).toBeUndefined();
      const cityCommits = c.ledger.filter((e) => e.kind === 'commit' && e.pool === 't-city');
      expect(cityCommits).toEqual([
        {
          day: asOf + 1,
          pool: 't-city',
          programme: 't-city',
          kind: 'commit',
          dollars: projectDollars((300027 / 861525) * 861525, 5)
        }
      ]);
    }
  });

  it('an ordinary start on its market application day loses to money that suffices', () => {
    const market = (city: Inflow[]): Finance => {
      const f = tinyStack({ asOf, city });
      f.programmes = [grant('m-city', 't-city', 'market', 0.2)];
      return f;
    };
    const rich = withFinance(tinyQueue(), market([once(asOf, AMPLE)]));
    const poor = withFinance(tinyQueue(), market([]));
    let cases = 0;
    for (const seed of seeds(200)) {
      for (const row of [0, 1, 2, 3, 4]) {
        const lat = lat0(rich, seed, row);
        if (lat.O === null || lat.market!.day !== lat.O) continue;
        cases++;
        const a = run(rich, seed).schedules.filter((s) => s.projectId === sid(row));
        expect(a.length).toBe(1);
        expect(a[0].funding).toBeDefined();
        expect(a[0].revisions[0].day).toBe(lat.O);
        const b = run(poor, seed).schedules.filter((s) => s.projectId === sid(row));
        expect(b.length).toBe(1);
        expect(b[0].funding).toBeUndefined();
        expect(b[0].revisions[0].day).toBe(lat.O);
      }
      if (cases >= 5) break;
    }
    expect(cases).toBeGreaterThan(0);
  });

  it('a waiting lot’s ordinary start removes it from the line with no commit', () => {
    const X = asOf + 3000;
    const input = withFinance(tinyQueue(), tinyStack({ asOf, city: [once(X, AMPLE)] }));
    let cases = 0;
    for (const seed of seeds(40)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      expect(c.ledger.filter((e) => e.kind === 'commit' && e.day < X)).toEqual([]);
      for (const row of [0, 1, 2, 3, 4]) {
        const lat = lat0(input, seed, row);
        if (lat.O === null || lat.O >= X || lat.affordable!.day! >= lat.O) continue;
        const s = ids.get(sid(row))!;
        if (s.end.kind === 'exit') continue;
        cases++;
        expect(s.funding).toBeUndefined();
        expect(s.revisions[0].day).toBe(lat.O);
        const units = input.parcels.yield[row * F + F - 1];
        const fed = projectDollars((443108 / 861525) * 861525, units);
        expect(c.ledger.some((e) => e.kind === 'commit' && e.dollars === fed)).toBe(false);
      }
    }
    expect(cases).toBeGreaterThan(5);
  });

  it('a release on an exit before construction is re-served the same day', () => {
    const finance = tinyStack({
      asOf,
      city: [once(asOf, 6_000_000)],
      off: [{ pool: 't-state', from: asOf, to: null }]
    });
    const input = withFinance(tinyQueue(), finance);
    let found = 0;
    for (const seed of seeds(300)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      c.ledger.forEach((e, k) => {
        if (e.kind !== 'release' || e.pool !== 't-city') return;
        if (c.ledger.some((x) => x.kind === 'in' && x.day === e.day)) return;
        const next = c.ledger.slice(k + 1).find((x) => x.kind === 'commit' && x.pool === 't-city');
        if (!next || next.day !== e.day) return;
        const s = funded(c).find(
          (t) => t.revisions[0].day === e.day && t.funding!.programmes.includes('t-city')
        )!;
        expect(s.funding!.applied).toBeLessThan(e.day);
        expect(ids.get(s.projectId)).toBe(s);
        found++;
      });
      if (found >= 3) break;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a kept reservation lapses applications on its day, and no commit falls on or after it', () => {
    const d = asOf + 500;
    const finance = tinyStack({ asOf, city: [once(asOf + 800, AMPLE)] });
    const input = withFinance(
      tinyQueue({ logOdds: [-12, -3, -3, -3, -3], reservedFrom: [d, 0, 0, 0, 0] }),
      finance
    );
    const fed0 = projectDollars(FED_PER_HOME, 10);
    let cases = 0;
    let awarded = 0;
    for (const seed of seeds(10)) {
      const lat = lat0(input, seed, 0);
      expect(lat.affordable!.day).toBe(asOf + 1);
      if (lat.O !== null && lat.O < d) continue;
      cases++;
      const c = run(input, seed);
      expect(c.schedules.filter((s) => s.parcelIds[0] === TINY_IDS[0])).toEqual([]);
      expect(c.reservations.get(0)).toBe(true);
      expect(c.ledger.filter((e) => e.kind === 'commit' && e.day === asOf + 800).length).toBe(
        3 * funded(c).filter((s) => s.revisions[0].day === asOf + 800).length
      );
      awarded += funded(c).length;
      expect(c.ledger.some((e) => e.kind === 'commit' && e.dollars === fed0)).toBe(false);
    }
    expect(cases).toBeGreaterThan(3);
    expect(awarded).toBeGreaterThan(0);
  });

  it('displaced: the ordinary units less existing, 0 past the horizon or the reservation', () => {
    const existing = [3, 3, 3, 3, 3];
    const units = [10, 12, 14, 16, 18];
    const input = withFinance(
      tinyQueue({ existing, logOdds: [-3, -3, -3, -12, -12] }),
      tinyStack({ asOf })
    );
    let before = 0;
    let after = 0;
    for (const seed of seeds(10)) {
      const ids = byId(run(input, seed).schedules);
      for (const row of [0, 1, 2, 3, 4]) {
        const lat = lat0(input, seed, row);
        const f = ids.get(sid(row))!.funding!;
        if (lat.O !== null) {
          before++;
          expect(f.displaced).toBe(units[row] - existing[row]);
        } else {
          after++;
          expect(f.displaced).toBe(0);
        }
      }
    }
    expect(before).toBeGreaterThan(5);
    expect(after).toBeGreaterThan(5);
    const d = asOf + 200;
    const reserved = withFinance(
      tinyQueue({ existing, reservedFrom: [d, d, d, d, d] }),
      tinyStack({ asOf })
    );
    let cut = 0;
    for (const seed of seeds(20)) {
      const ids = byId(run(reserved, seed).schedules);
      for (const row of [0, 1, 2, 3, 4]) {
        const lat = lat0(reserved, seed, row);
        if (lat.O === null || lat.O < d) continue;
        cut++;
        expect(ids.get(sid(row))!.funding!.displaced).toBe(0);
      }
    }
    expect(cut).toBeGreaterThan(5);
  });
});

describe('certain projects and pipeline rows (miniFinance)', () => {
  it('no certain project exits or is revised; pipeline rows carry no funding', () => {
    const input = mini({ finance: miniFinance(asOf) });
    let certain = 0;
    let commits = 0;
    for (const seed of seeds(20)) {
      const c = run(input, seed);
      for (const s of c.schedules) {
        if (s.origin === 'pipeline') {
          expect(s.funding).toBeUndefined();
          expect(s.kind).toBeUndefined();
        }
        if (!s.funding?.certain) continue;
        certain++;
        expect(s.end.kind).not.toBe('exit');
        expect(s.revisions.length).toBe(1);
      }
      // every commit is a simulated funded project's, on its award (start) day
      const starts = new Map<Day, number>();
      for (const s of funded(c)) {
        expect(s.origin).toBe('simulated');
        const day = s.revisions[0].day;
        expect(s.entered[firstStage(s)]).toBe(day);
        starts.set(day, (starts.get(day) ?? 0) + s.funding!.programmes.length);
      }
      const perDay = new Map<Day, number>();
      for (const e of c.ledger) {
        if (e.kind !== 'commit') continue;
        commits++;
        perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1);
      }
      for (const [day, n] of perDay) expect(n).toBeLessThanOrEqual(starts.get(day) ?? 0);
    }
    expect(certain).toBeGreaterThan(5);
    expect(commits).toBeGreaterThan(5);
  });
});

describe('review focus', () => {
  it('RF1: after a funded project exits past construction, attempt k + 1 draws with 0 existing', () => {
    const f = tinyStack({ asOf });
    f.programmes = [grant('m-city', 't-city', 'market', 0.3)];
    f.terms = resolveTerms(MARKET_TERMS, { lossOnExit: 1 });
    const input = withFinance(tinyQueue({ existing: [4, 4, 4, 4, 4] }), f);
    let cases = 0;
    for (const seed of seeds(400)) {
      const c = run(input, seed);
      const ids = byId(c.schedules);
      for (const s of funded(c)) {
        const end = s.end;
        if (end.kind !== 'exit' || s.entered.construction === undefined) continue;
        expect(c.ledger.some((e) => e.kind === 'loss' && e.day === end.day)).toBe(true);
        const [, id, kText] = s.projectId.split(':');
        const k = Number(kText);
        const next = ids.get(`sim:${id}:${k + 1}`);
        if (!next) continue;
        cases++;
        const row = input.parcels.index.get(id)!;
        const stream = streamOf(runOf(input, seed, H, true).sh, simEntity(id), k + 1);
        const cum = sizeCumAgainst(input, row, 0);
        const u = drawOn(stream, P.SIZE, 0);
        let lvl = 0;
        while (lvl < F && !(u < cum[lvl])) lvl++;
        expect(next.existingUnits).toBe(0);
        expect(next.revisions[0].units).toBe(input.parcels.yield[row * F + lvl]);
      }
      if (cases >= 3) break;
    }
    expect(cases).toBeGreaterThan(0);
  });

  it('RF4: a certain project whose stages before construction take 0 days commits, then spends', () => {
    // A hand transition with all advance mass at month 0, and a 0 time scale on every timed stage:
    // the award day is the construction day.
    const cal = tinyQueue().calibration;
    const t0: Transition = {
      months: 1,
      advance: [1],
      exit: {},
      tail: { advance: 0.5, exit: {} },
      provenance: cal.transitions.discretionary.filed!.provenance,
      tailProvenance: cal.transitions.discretionary.filed!.provenance
    };
    const transitions = structuredClone(cal.transitions);
    for (const p of PATHWAYS) {
      for (const s of Object.keys(transitions[p]) as Stage[]) {
        if (s !== 'construction') (transitions[p] as Record<string, Transition>)[s] = t0;
      }
    }
    const scale = scaleTable([], 'new');
    for (const p of PATHWAYS) {
      for (const s of [
        'preApplication',
        'filed',
        'entitled',
        'permitFiled',
        'permitIssued'
      ] as const) {
        scale[p][s] = 0;
      }
    }
    const tq = tinyQueue();
    const input: SimInput = {
      ...tq,
      newProjects: { calibration: { ...tq.calibration, transitions }, scale },
      finance: tinyStack({ asOf })
    };
    for (const seed of seeds(3)) {
      const c = run(input, seed);
      const all = funded(c);
      expect(all.length).toBe(5);
      for (const s of all) expect(s.entered.construction).toBe(s.revisions[0].day);
      const day = asOf + 1;
      const kinds = c.ledger.filter((e) => e.day === day).map((e) => e.kind);
      const lastCommit = kinds.lastIndexOf('commit');
      const firstSpend = kinds.indexOf('spend');
      expect(firstSpend).toBeGreaterThan(lastCommit);
      expect(kinds.filter((k) => k === 'spend').length).toBe(
        kinds.filter((k) => k === 'commit').length
      );
    }
  });
});
