// market-baseline Task 9 (spec §4.8): `SimInput.market` shifts every simulated lot's initiation
// log-odds by the step in force on each month's first day; later market days and regime days
// form one merged segment list.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '$lib/generator/seed';
import type { ParcelId } from '$lib/data/parcel';
import { featureValue, type ScenarioParcels } from '$lib/data/scenario-codec';
import { exp, log } from '$lib/timelapse/math';
import { initiationLogit } from '$lib/timelapse/model';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { FeatureId, MarketStep } from '$lib/timelapse/types';
import { dayOf, isoOf } from './dates';
import { runEngine } from './engine';
import { piecewiseMonth, precomputeOf, regimeMonths } from './input';
import { P, draw, simEntity } from './rng';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { simulate } from './simulate';
import type { Schedule, SimInput } from './types';

const H = GOLDEN_HORIZON;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const base = goldenInput();
const asOf = base.asOf;

const startDay = (s: Schedule): Day => s.revisions[0].day;

/** Rows no in-flight project (or phase) names: at risk from `asOf` for k = 0. */
function freeRows(input: SimInput): Set<number> {
  const held = new Set<ParcelId>();
  for (const p of input.projects) {
    for (const id of p.parcelIds) held.add(id);
    for (const ph of p.phases ?? []) for (const id of ph.parcelIds) held.add(id);
  }
  const out = new Set<number>();
  for (let i = 0; i < input.parcels.count; i++) if (!held.has(input.parcels.id[i])) out.add(i);
  return out;
}

/** log(1 − h) for row i of `p` under shift s, built by hand from the model. */
function rateOf(input: SimInput, p: ScenarioParcels, i: number, s: number): number {
  const m = input.calibration.initiation;
  const f = {} as Record<FeatureId, number>;
  for (const t of m.terms) f[t.feature] = featureValue(p, i, t.feature, 'fzp');
  return log(1 - 1 / (1 + exp(-(initiationLogit(m, f) + s))));
}

const withMarket = (input: SimInput, market: MarketStep[]): SimInput => ({ ...input, market });

/** A runEngine call that must throw: its message. */
function thrown(input: SimInput): string {
  try {
    runEngine(input, 1, H, { schedule() {}, master() {} });
  } catch (e) {
    expect(e).toBeInstanceOf(RangeError);
    return (e as Error).message;
  }
  return 'no error';
}

describe('engine market', () => {
  it('(a) one step at asOf equals the intercept shifted by s on a terms-free model', () => {
    const s = -0.693147;
    const cal = base.calibration;
    const flat = { ...cal, initiation: { ...cal.initiation, terms: [] } };
    const shifted = {
      ...cal,
      initiation: { ...cal.initiation, intercept: cal.initiation.intercept + s, terms: [] }
    };
    const a: SimInput = { ...base, calibration: flat, market: [{ from: asOf, logOdds: s }] };
    const b: SimInput = { ...base, calibration: shifted };
    let sims = 0;
    for (const seed of [1, 2, 3]) {
      const x = simulate(a, seed, H);
      expect(x).toEqual(simulate(b, seed, H));
      sims += x.filter((q) => q.origin === 'simulated').length;
    }
    expect(sims).toBeGreaterThan(0);
  });

  it('(b) a later step of -50 stops initiations in months beginning on or after its day', () => {
    const d = asOf + 3 * 365;
    const input = withMarket(base, [
      { from: asOf, logOdds: 0 },
      { from: d, logOdds: -50 }
    ]);
    let before = 0;
    for (const seed of seeds(20)) {
      for (const s of simulate(input, seed, H)) {
        if (s.origin !== 'simulated') continue;
        expect(startDay(s)).toBeLessThan(d + 31);
        if (startDay(s) < d) before++;
      }
    }
    expect(before).toBeGreaterThan(0);
  });

  for (const [name, dm, dr] of [
    ['distinct days (dm < dr)', dayOf(2030, 3, 1), dayOf(2036, 7, 1)],
    ['equal days', dayOf(2033, 5, 1), dayOf(2033, 5, 1)]
  ] as const) {
    it(`(c) a regime day and a market day compose, ${name}`, () => {
      const view = { ...base.parcels };
      const shift = 1;
      const input: SimInput = {
        ...base,
        regimes: [{ day: dr, parcels: view }],
        market: [
          { from: asOf, logOdds: 0 },
          { from: dm, logOdds: shift }
        ]
      };
      const pre = precomputeOf(input);
      const merged = dm === dr ? [dm] : [dm, dr];
      expect(pre.segments.days).toEqual(merged);
      if (dm === dr) expect(pre.segments.days.length).toBe(1);
      // hand-computed (view, shift) per segment
      const segs =
        dm === dr
          ? [
              { view: 0, s: 0 },
              { view: 1, s: shift }
            ]
          : [
              { view: 0, s: 0 },
              { view: 0, s: shift },
              { view: 1, s: shift }
            ];
      expect(pre.segments.view).toEqual(segs.map((g) => g.view));
      const bounds = regimeMonths(asOf, merged);
      const free = freeRows(input);
      const bySeg = new Array<number>(segs.length).fill(0);
      for (const seed of seeds(10)) {
        for (const s of simulate(input, seed, H)) {
          if (s.origin !== 'simulated') continue;
          const id = s.parcelIds[0];
          const i = input.parcels.index.get(id)!;
          if (!free.has(i) || !s.projectId.endsWith(':0')) continue;
          const rates = segs.map((g) => rateOf(input, g.view === 0 ? base.parcels : view, i, g.s));
          const u = draw(seed, simEntity(id), 0, P.INIT, 0);
          const T = piecewiseMonth(log(1 - u), bounds, rates);
          // the exact initiation day in month T (§4.4.4 step 3)
          const v = draw(seed, simEntity(id), 0, P.INIT_DAY, 0);
          expect(startDay(s)).toBe(asOf + 1 + Math.floor((T - 1 + v) * MONTH_DAYS));
          let seg = 0;
          while (seg < bounds.length && bounds[seg] < T) seg++;
          expect(s.regime).toBe(segs[seg].view);
          bySeg[seg]++;
        }
      }
      for (const n of bySeg) expect(n).toBeGreaterThan(0);
    });
  }

  it('(d) three steps run and are deterministic', () => {
    const input = withMarket(base, [
      { from: asOf, logOdds: -0.5 },
      { from: asOf + 365, logOdds: 0.4 },
      { from: asOf + 730, logOdds: -1.2 }
    ]);
    expect(precomputeOf(input).stepLog1mh).toHaveLength(2);
    expect(precomputeOf(input).segments.days).toEqual([asOf + 365, asOf + 730]);
    for (const seed of [1, 2]) {
      const a = simulate(input, seed, H);
      expect(a.some((s) => s.origin === 'simulated')).toBe(true);
      expect(simulate(input, seed, H)).toEqual(a);
    }
  });

  it('(e) rejects a bad market with a RangeError', () => {
    expect(
      thrown(
        withMarket(base, [
          { from: asOf, logOdds: 0 },
          { from: asOf + 10, logOdds: NaN }
        ])
      )
    ).toBe('market: logOdds of step 1 is not finite');
    expect(
      thrown(
        withMarket(base, [
          { from: asOf, logOdds: 0 },
          { from: asOf, logOdds: 1 }
        ])
      )
    ).toBe('market: steps must be strictly ascending by from (step 1)');
    expect(thrown(withMarket(base, [{ from: asOf + 1, logOdds: 0 }]))).toBe(
      `market: the first step must be on or before asOf (${isoOf(asOf + 1)} > ${isoOf(asOf)})`
    );
    // [] and absent are valid
    expect(thrown(withMarket(base, []))).toBe('no error');
  });

  for (const withRegime of [false, true]) {
    it(`(f) skipAbove never skips a parcel that initiates by the horizon, random steps${
      withRegime ? ', with a regime' : ''
    }, seeds 1-50`, () => {
      const rng = mulberry32(0x3a7e + (withRegime ? 1 : 0));
      const span = H - asOf;
      let sims = 0;
      let bounded = 0;
      for (const seed of seeds(50)) {
        const a = asOf + 1 + Math.floor(rng() * (span - 2));
        const b = asOf + 1 + Math.floor(rng() * (span - 2));
        const shift = () => -3 + 4 * rng();
        const later = [...new Set([a, b])].sort((x, y) => x - y);
        const market: MarketStep[] = [
          { from: asOf - Math.floor(rng() * 400), logOdds: shift() },
          ...later.map((from) => ({ from, logOdds: shift() }))
        ];
        const regimes = withRegime
          ? [{ day: dayOf(2034, 1, 1), parcels: { ...base.parcels } }]
          : undefined;
        const input: SimInput = { ...base, market, ...(regimes ? { regimes } : {}) };
        const forced: SimInput = { ...input };
        const pre = precomputeOf(forced);
        pre.skipAbove = () => new Float64Array(pre.candidates.length).fill(Infinity);
        const x = simulate(input, seed, H);
        expect(x).toEqual(simulate(forced, seed, H));
        sims += x.filter((s) => s.origin === 'simulated').length;
        // the bound is active: some first draw is above it
        const bound = precomputeOf(input).skipAbove(H);
        const ent = precomputeOf(input).entity;
        for (let c = 0; c < bound.length; c++)
          if (draw(seed, ent[c], 0, P.INIT, 0) > bound[c]) bounded++;
      }
      expect(sims).toBeGreaterThan(0);
      expect(bounded).toBeGreaterThan(0);
    });
  }

  it('in-flight rows do not read the market (seed 1)', () => {
    const input = withMarket(base, [
      { from: asOf, logOdds: -2 },
      { from: asOf + 900, logOdds: 1 }
    ]);
    const pipe = (ss: Schedule[]) => ss.filter((s) => s.origin === 'pipeline');
    const a = pipe(simulate(input, 1, H));
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(pipe(simulate(base, 1, H)));
  });
});
