// Policy-timeline Task 11: first differences, the comparison and frame lookups (rules 17, 22).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { applyLevers, lookupsOf, twinInput } from '$lib/sim/levers/apply';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { buildFinance } from '$lib/sim/levers/finance';
import { fillNeeds, resolveEnvelopes } from '$lib/sim/levers/resolve';
import { DEFAULT_LEVERS, type SimLevers } from '$lib/sim/levers/types';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import { resolvePreset } from '$lib/sim-page/timing';
import { DEFAULT_POLICY4, type Effect, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { monthFirstDay } from '../months';
import { comparisonOf, firstDifference } from './compare';
import { compileTimeline, type CompileCtx } from './compile';
import { lookupsAt } from './lookups';
import { miniCompileCtx } from './test/compile-fixtures';
import { miniDoc, off, span, timingSet } from './test/fixtures';

const ctx = miniCompileCtx({ finance: true, windowMonths: 40 });
const ASOF: Day = ctx.input.asOf;

const D1: ParcelId[] = ['2999A001', '2999A013', '3512005', '3600014', '3600016'];
const stroke = { path: [[-122.4, 37.7] as [number, number]], radiusM: 50 };
const paint = (stories: number): CustomBrush => ({
  id: `b${stories}`,
  kind: 'paint',
  strokes: [stroke],
  stories
});
const LOTS: Record<string, ParcelId[]> = { [queryKey(customQuery(paint(6)))]: D1 };
const brushes = (stories: number): Effect => ({ tag: 'brushes', brushes: [paint(stories)] });

function policy(
  id: string,
  where: Policy['where'],
  spans: [number, number | null, Effect][]
): Policy {
  return {
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: spans.map(([a, b, what]) => span(ASOF, a, b, what))
  };
}
const painted = (id: string, from: number, stories = 6) =>
  policy(id, { tag: 'painted' }, [[from, null, brushes(stories)]]);

const RATE_CUT = policy('terms', { tag: 'terms' }, [
  [1, null, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } }]
]);

function fund(fromMonth: number): Policy {
  const f = fundingOnly();
  return policy('fund', { tag: 'fund', pool: f.pools[0].id }, [
    [fromMonth, null, { tag: 'fund', pool: f.pools[0], programmes: f.programmes }]
  ]);
}

function tl(doc: SimPolicy4, c: CompileCtx = ctx, base: 'plan' | 'preFzp' = 'plan') {
  const k = compileTimeline(doc, LOTS, c, base);
  expect(k.step(Infinity)).toBe(true);
  return k.result();
}

describe('firstDifference (rule 17)', () => {
  const before = miniDoc(painted('p', 3), RATE_CUT);

  it('is null for identical documents', () => {
    expect(firstDifference(tl(before), tl(before))).toBeNull();
  });

  it('is month m for an edit dated month m', () => {
    const a = tl(miniDoc(painted('p', 20), RATE_CUT));
    const b = tl(miniDoc(painted('p', 20), painted('q', 31, 8), RATE_CUT));
    expect(firstDifference(a, b)).toBe(31);
    for (let m = 1; m < 31; m++) expect(b.frameAt(m).id).toBe(a.frameAt(m).id);
  });

  it('is month m when one inflow dated in month m is raised', () => {
    const f = fundingOnly();
    const pool = f.pools[0];
    const m = 9;
    const inflow = { kind: 'once' as const, day: monthFirstDay(ASOF, m) + 3, dollars: 1_000_000 };
    const raised = (dollars: number) =>
      miniDoc(
        RATE_CUT,
        policy('fund', { tag: 'fund', pool: pool.id }, [
          [
            1,
            null,
            {
              tag: 'fund',
              pool: { ...pool, inflows: [{ ...inflow, dollars }] },
              programmes: f.programmes
            }
          ]
        ])
      );
    const a = tl(raised(inflow.dollars));
    const b = tl(raised(inflow.dollars * 2));
    // same ids, different arrivals
    expect(b.frameAt(m).id).toBe(a.frameAt(m).id);
    expect(firstDifference(a, b)).toBe(m);
  });

  it('is month m when a fund whose span begins in month m is added', () => {
    const a = tl(miniDoc(RATE_CUT));
    const b = tl(miniDoc(RATE_CUT, fund(7)));
    expect(firstDifference(a, b)).toBe(7);
  });

  it("is month m when a programme's setting changes in a span that begins in month m", () => {
    const f = fundingOnly();
    const prog = f.programmes[0];
    const fundOf = (second: number) =>
      miniDoc(
        RATE_CUT,
        policy('fund', { tag: 'fund', pool: f.pools[0].id }, [
          [1, 9, { tag: 'fund', pool: f.pools[0], programmes: [prog] }],
          [10, null, { tag: 'fund', pool: f.pools[0], programmes: [{ ...prog, minHomes: second }] }]
        ])
      );
    expect(firstDifference(tl(fundOf(prog.minHomes)), tl(fundOf(prog.minHomes + 5)))).toBe(10);
  });

  it('is null when only a label changes, or an added policy is off', () => {
    const a = tl(before);
    const relabelled = miniDoc({ ...painted('p', 3), label: 'another name' }, RATE_CUT);
    expect(firstDifference(a, tl(relabelled))).toBeNull();
    const added = miniDoc(painted('p', 3), off(painted('q', 9, 9)), RATE_CUT);
    expect(firstDifference(a, tl(added))).toBeNull();
  });

  it('answers min(readyThrough) + 1 when a partly compiled timeline matches a whole one', () => {
    const whole = tl(before);
    const k = compileTimeline(before, LOTS, ctx, 'plan');
    k.step(0);
    const partial = k.result();
    const ready = partial.readyThrough();
    expect(ready).toBeLessThan(whole.readyThrough());
    expect(firstDifference(partial, whole)).toBe(ready + 1);
    expect(firstDifference(whole, partial)).toBe(ready + 1);
  });
});

describe('comparisonOf (rule 22)', () => {
  it('gives the same document on preFzp when nothing is in force', () => {
    const r = comparisonOf(DEFAULT_POLICY4);
    expect(r.base).toBe('preFzp');
    expect(r.doc).toBe(DEFAULT_POLICY4);
    const offDoc = miniDoc(off(painted('p', 2)));
    const o = comparisonOf(offDoc);
    expect(o.base).toBe('preFzp');
    expect(o.doc).toBe(offDoc);
  });

  it('gives the default on the plan for anything in force', () => {
    for (const d of [miniDoc(painted('p', 2)), miniDoc(RATE_CUT), miniDoc(fund(3))]) {
      const r = comparisonOf(d);
      expect(r.base).toBe('plan');
      expect(r.doc).toBe(DEFAULT_POLICY4);
    }
  });

  it('is unchanged by adding an off policy', () => {
    const a = miniDoc(painted('p', 2));
    const b = miniDoc(painted('p', 2), off(painted('q', 4)));
    expect(comparisonOf(b)).toEqual(comparisonOf(a));
    expect(comparisonOf(miniDoc(off(painted('q', 4)))).base).toBe('preFzp');
  });

  it('compiles the default on preFzp to the twin of today', () => {
    const c = miniCompileCtx({ finance: true, market: true, windowMonths: 6 });
    const { doc, base } = comparisonOf(DEFAULT_POLICY4);
    const t = tl(doc, c, base);
    const twin = twinInput(c.input, c.layers, 'preFzp');
    const f = t.frameAt(3);
    const p = f.view.parcels;
    const q = twin.parcels;
    expect(p.count).toBe(q.count);
    for (const col of ['envelopeStories', 'hostable', 'localProgram', 'yield'] as const) {
      expect(Array.from(p[col] as ArrayLike<number>)).toEqual(
        Array.from(q[col] as ArrayLike<number>)
      );
    }
    expect(Array.from(p.potentialRatio.fzp)).toEqual(Array.from(q.potentialRatio.fzp));
    expect(Array.from(p.storiesGap.fzp)).toEqual(Array.from(q.storiesGap.fzp));
    expect(f.calibration).toEqual(twin.calibration);
    expect(f.market).toBe(twin.market?.[0].logOdds ?? 0);
    const want = buildFinance(c.input.finance, DEFAULT_LEVERS.finance, c.input.asOf)!;
    expect(f.finance!.terms).toEqual(want.terms);
    expect(f.finance!.slope).toBe(want.slope);
    expect(f.finance!.pools).toEqual(want.pools);
    expect(f.finance!.programmes).toEqual(want.programmes);
  });
});

describe('lookupsAt', () => {
  it('equals lookupsOf the plan today, for an upgraded sb423Clock document', () => {
    const c = miniCompileCtx({ windowMonths: 6 });
    const r = resolvePreset('sb423Clock', c.input.calibration);
    const set = timingSet({
      preset: 'sb423Clock',
      presetTimers: r.presetTimers,
      presetRouteShares: r.presetRouteShares
    });
    const frame = tl(
      miniDoc(policy('t', { tag: 'routes' }, [[1, null, { tag: 'timing', set }]])),
      c
    ).frameAt(1);
    const levers: SimLevers = { ...DEFAULT_LEVERS, timers: r.presetTimers.map((x) => ({ ...x })) };
    const filled = fillNeeds(resolveEnvelopes(c.layers, levers, c.input.asOf), new Map());
    const want = applyLevers(c.input, c.layers, levers, filled).lookups;
    const got = lookupsAt(frame);
    expect(got.inFlight).toEqual(want.inFlight);
    expect(got.fresh).toEqual(want.fresh);
    expect(lookupsAt(frame)).toBe(got);
    // an unscaled frame matches the plain input
    expect(lookupsAt(tl(DEFAULT_POLICY4, c).frameAt(1))).toEqual(lookupsOf(c.input));
  });

  it('multiplies speed by every speedNew scale and clamps', () => {
    const c = miniCompileCtx({ windowMonths: 6 });
    const f = tl(DEFAULT_POLICY4, c).frameAt(1);
    const one = (x: number) => ({ discretionary: {}, streamlined: { filed: x }, permitOnly: {} });
    const frame = {
      ...f,
      id: -1,
      speed: one(0.5),
      speedNew: [
        { from: 0, scale: one(0.5) },
        { from: 0, scale: one(0.01) }
      ]
    };
    const ref = lookupsOf({
      ...c.input,
      parcels: f.view.parcels,
      inFlightScale: frame.speed,
      newProjects: { calibration: f.newCalibration, scale: one(0.05) }
    });
    const out = lookupsAt(frame);
    expect(out.fresh).toEqual(ref.fresh);
    expect(out.inFlight).toEqual(ref.inFlight);
  });
});
