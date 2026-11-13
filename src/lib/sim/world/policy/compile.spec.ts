// Policy-timeline Task 10: compiling a dated policy into monthly frames (spec rules 16 to 21, 23).
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { twinInput } from '$lib/sim/levers/apply';
import { allNeeds, needKey, resolveEnvelopes } from '$lib/sim/levers/resolve';
import { DEFAULT_LEVERS, LeverFormatError } from '$lib/sim/levers/types';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import { DEFAULT_POLICY4, type Effect, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import type { Day } from '$lib/timelapse/time';
import { monthFirstDay } from '../months';
import { inForceAt, permittingOf, zoningLevers, type ZoningLevers } from './combine';
import { compileTimeline, type CompileCtx, type TimelineCompile } from './compile';
import type { PolicyTimeline, ZoningView } from './frame';
import { cellYields, fakeClock, fakeYields, miniCompileCtx } from './test/compile-fixtures';
import { miniDoc, span, timingSet } from './test/fixtures';
import { createViewJob } from './zoning-view';

const ASOF: Day = miniCompileCtx().input.asOf;
const W = 60;

const ctx60 = (o: Parameters<typeof miniCompileCtx>[0] = {}): CompileCtx =>
  miniCompileCtx({ windowMonths: W, ...o });

// District-1 lots outside the Local Program with no base cap: FZP 4 stories.
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

/** A policy with spans `[fromMonth, toMonth, what]` on the mini input's dataset date. */
function policy(
  id: string,
  where: Policy['where'],
  spans: [number, number | null, Effect][],
  on = true
): Policy {
  return {
    id,
    label: id,
    preset: where.tag === 'routes' ? 'observed' : null,
    on,
    where,
    spans: spans.map(([a, b, what]) => span(ASOF, a, b, what))
  };
}
const painted = (id: string, spans: [number, number | null, number][]) =>
  policy(
    id,
    { tag: 'painted' },
    spans.map(([a, b, s]) => [a, b, brushes(s)])
  );

/** A fund policy adding `fundingOnly()`'s pool and programme from `fromMonth`. */
function fund(fromMonth: number): Policy {
  const f = fundingOnly();
  return policy('fund', { tag: 'fund', pool: f.pools[0].id }, [
    [fromMonth, null, { tag: 'fund', pool: f.pools[0], programmes: f.programmes }]
  ]);
}

/**
 * The mini finance's guarantee needs `guaranteeRateCut`, which its baseline types but money
 * levers resolve afresh (as today's `buildFinance`): typed here from month 1.
 */
const RATE_CUT = policy('terms', { tag: 'terms' }, [
  [1, null, { tag: 'terms', terms: { guaranteeRateCut: 0.01 } }]
]);

/** The document reconciled with the mini calibration (it re-fits timing preset layers). */
const reconciled = (doc: SimPolicy4) =>
  reconcilePolicy4(doc, miniCompileCtx().input.calibration, miniCompileCtx().input.asOf).doc;

function compiled(doc: SimPolicy4, ctx: CompileCtx, base: 'plan' | 'preFzp' = 'plan') {
  const c = compileTimeline(doc, LOTS, ctx, base);
  expect(c.step(Infinity)).toBe(true);
  return { c, t: c.result() };
}

const monthsOf = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
const idsOf = (t: PolicyTimeline, n = W) => monthsOf(n).map((m) => t.frameAt(m).id);

/** Rows whose zoning-view row differs, by a column-by-column scan. */
function scanRows(a: ZoningView, b: ZoningView): number[] {
  const p = a.parcels;
  const q = b.parcels;
  const F = p.fillLevels.length;
  const out: number[] = [];
  for (let i = 0; i < p.count; i++) {
    let d = false;
    const cols: [ArrayLike<number>, ArrayLike<number>][] = [
      [p.envelopeStories, q.envelopeStories],
      [p.hostable, q.hostable],
      [p.localProgram, q.localProgram],
      [p.potentialRatio.fzp, q.potentialRatio.fzp],
      [p.storiesGap.fzp, q.storiesGap.fzp],
      [a.pre.logit, b.pre.logit]
    ];
    for (const [x, y] of cols) if (!Object.is(x[i], y[i])) d = true;
    for (let f = 0; f < F; f++) if (p.yield[i * F + f] !== q.yield[i * F + f]) d = true;
    if (d) out.push(i);
  }
  return out;
}

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('compileTimeline: frames (rules 16, 17)', () => {
  const ctx = ctx60();
  const two = miniDoc(
    painted('p', [
      [13, 24, 6],
      [25, null, 8]
    ])
  );

  it('two spans give three frames', () => {
    const { t } = compiled(two, ctx);
    const { t: d } = compiled(DEFAULT_POLICY4, ctx);
    expect(t.changes()).toEqual([13, 25]);
    const ids = idsOf(t);
    expect(new Set(ids).size).toBe(3);
    expect(ids.slice(0, 12)).toEqual(idsOf(d).slice(0, 12));
    expect(new Set(idsOf(d)).size).toBe(1);
    expect(d.changes()).toEqual([]);
    expect(t.readyThrough()).toBe(W);
    // months with one id share their view, calibrations and scale objects
    for (const m of [14, 30]) {
      const a = t.frameAt(m - 1);
      const b = t.frameAt(m);
      expect(b.view).toBe(a.view);
      expect(b.newCalibration).toBe(a.newCalibration);
      expect(b.speed).toBe(a.speed);
      expect(b.speedNew).toBe(a.speedNew);
    }
    expect(t.frameAt(1).calibration).toBe(ctx.input.calibration);
    expect(t.frameAt(1).finance).toBeNull();
  });

  it('rule 17: an added span from month 30 keeps months 1-29 and their views', () => {
    const later = miniDoc(
      painted('p', [
        [13, 24, 6],
        [25, 29, 8],
        [30, null, 10]
      ])
    );
    const { t: a } = compiled(two, ctx);
    const { t: b } = compiled(later, ctx);
    expect(idsOf(b, 29)).toEqual(idsOf(a, 29));
    for (const m of monthsOf(29)) expect(b.frameAt(m).view).toBe(a.frameAt(m).view);
    expect(b.frameAt(30).id).not.toBe(a.frameAt(30).id);
    expect(b.changes()).toEqual([13, 25, 30]);
  });

  it('nothing in the frames depends on the window', () => {
    const { t: a } = compiled(two, ctx);
    const { t: b } = compiled(two, { ...ctx, windowMonths: 24 });
    expect(b.readyThrough()).toBe(24);
    expect(idsOf(b, 24)).toEqual(idsOf(a, 24));
    expect(() => b.frameAt(25)).toThrow(RangeError);
  });

  it('a policy that is off, or a span after the window, changes nothing in the window', () => {
    const { t: a } = compiled(two, ctx);
    const after = miniDoc(...two.kinds.zoning, painted('q', [[W + 1, null, 9]]));
    const offDoc = miniDoc(...two.kinds.zoning, { ...painted('q', [[2, null, 9]]), on: false });
    for (const d of [after, offDoc]) {
      const { t: b } = compiled(d, ctx);
      expect(idsOf(b)).toEqual(idsOf(a));
      expect(b.changes()).toEqual(a.changes());
    }
  });
});

describe('compileTimeline: touched (rule 20)', () => {
  it('for an added paint policy is exactly the rows whose view row changed', () => {
    const ctx = ctx60({ finance: true });
    const doc = miniDoc(painted('p', [[13, null, 7]]), RATE_CUT, fund(20));
    expect(reconcilePolicy4(doc, ctx.input.calibration, ctx.input.asOf).doc).toBe(doc);
    const { t } = compiled(doc, ctx);
    expect(t.changes()).toEqual([13, 20]);
    const want = scanRows(t.frameAt(12).view, t.frameAt(13).view);
    expect(want.length).toBe(D1.length);
    expect(Array.from(t.touched(13)!)).toEqual(want);
    // a money-only change
    expect(t.frameAt(20).view).toBe(t.frameAt(19).view);
    expect(Array.from(t.touched(20)!)).toEqual([]);
    expect(t.touched(1)).toBeNull();
    expect(Array.from(t.touched(5)!)).toEqual([]);
    expect(() => t.touched(W + 1)).toThrow(RangeError);
  });

  it('removing a painted policy differs from month 1 by exactly the lots it raised', () => {
    const ctx = ctx60();
    const { t: withP } = compiled(miniDoc(painted('p', [[1, null, 7]])), ctx);
    const { t: without } = compiled(DEFAULT_POLICY4, ctx);
    expect(without.frameAt(1).id).not.toBe(withP.frameAt(1).id);
    expect(without.touched(1)).toBeNull();
    expect(without.changes()).toEqual([]);
    const a = withP.frameAt(1).view;
    const b = without.frameAt(1).view;
    const rows = D1.map((id) => ctx.input.parcels.index.get(id)!).sort((x, y) => x - y);
    expect(scanRows(a, b)).toEqual(rows);
  });
});

describe('compileTimeline: money and market (rules 15, 21)', () => {
  it('finance: null in every frame without baselineFunding, with money policies in force', () => {
    const ctx = ctx60();
    expect(ctx.input.finance).toBeUndefined();
    const { t } = compiled(miniDoc(fund(1)), ctx);
    for (const m of monthsOf(W)) expect(t.frameAt(m).finance).toBeNull();
    expect(t.changes()).toEqual([]);
  });

  it('gives the month its finance frame and arrivals', () => {
    const ctx = ctx60({ finance: true });
    const { t } = compiled(miniDoc(RATE_CUT, fund(3)), ctx);
    const f2 = t.frameAt(2).finance!;
    const f3 = t.frameAt(3).finance!;
    const g = f3.programmes.findIndex((p) => p.id === fundingOnly().programmes[0].id);
    expect(f2.offered[g]).toBe(0);
    expect(f3.offered[g]).toBe(1);
    expect(t.changes()).toEqual([3]);
    // arrivals are not part of the id
    expect(t.frameAt(4).id).toBe(t.frameAt(16).id);
    expect(t.frameAt(4).finance).not.toBe(t.frameAt(16).finance);
  });

  it('market changes in the month of its second step', () => {
    const base = ctx60({ market: true });
    const ctx: CompileCtx = {
      ...base,
      input: {
        ...base.input,
        market: [...base.input.market!, { from: monthFirstDay(ASOF, 7), logOdds: -0.1 }]
      }
    };
    const { t } = compiled(DEFAULT_POLICY4, ctx);
    expect(t.frameAt(6).market).toBe(base.input.market![0].logOdds);
    expect(t.frameAt(7).market).toBe(-0.1);
    expect(t.changes()).toEqual([7]);
    expect(Array.from(t.touched(7)!)).toEqual([]);
  });

  it('market is 0 without market steps', () => {
    const { t } = compiled(DEFAULT_POLICY4, ctx60());
    expect(t.frameAt(1).market).toBe(0);
  });
});

describe('compileTimeline: permitting (rules 13, 14)', () => {
  // The Local Program switch: every valid document keeps it on today (`parseTimingSet`, and
  // `reconcileTiming` restores the preset's), so its off path is covered in zoning-view.spec.ts.
  it('route shares reach newCalibration only, from the month they start', () => {
    const ctx = ctx60();
    const shares = { discretionary: 20, streamlined: 70, permitOnly: 10 };
    const set = timingSet({ routeShares: shares });
    const doc = reconciled(
      miniDoc(policy('t', { tag: 'routes' }, [[4, null, { tag: 'timing', set }]]))
    );
    const { t } = compiled(doc, ctx);
    expect(t.changes()).toEqual([4]);
    expect(t.frameAt(3).newCalibration).toBe(ctx.input.calibration);
    expect(t.frameAt(4).newCalibration.pathwayForNew).toMatchObject({
      discretionary: 0.2,
      streamlined: 0.7,
      permitOnly: 0.1
    });
    expect(t.frameAt(4).calibration).toBe(ctx.input.calibration);
    expect(t.frameAt(4).view).toBe(t.frameAt(3).view);
    expect(Array.from(t.touched(4)!)).toEqual([]);
  });
});

describe('compileTimeline: checks', () => {
  it('throws on an unreconciled document; the reconciled one compiles', () => {
    const ctx = ctx60();
    const g = { ...fundingOnly().programmes[0], id: 'u-x', pool: 'no-such-pool' };
    const doc = miniDoc(
      policy('f', { tag: 'fund', pool: 'no-such-pool' }, [
        [1, null, { tag: 'fund', pool: null, programmes: [g] }]
      ])
    );
    const err = errorOf(() => compileTimeline(doc, LOTS, ctx, 'plan'));
    expect(err).toBeInstanceOf(LeverFormatError);
    expect((err as LeverFormatError).path).toBe('policy');
    const ok = reconcilePolicy4(doc, ctx.input.calibration, ctx.input.asOf).doc;
    expect(ok).not.toBe(doc);
    compiled(ok, ctx);
  });

  it('throws on a span that is not month-aligned', () => {
    const ctx = ctx60();
    const p = painted('p', [[3, null, 6]]);
    p.spans[0] = { ...p.spans[0], from: p.spans[0].from + 1 };
    const err = errorOf(() => compileTimeline(miniDoc(p), LOTS, ctx, 'plan'));
    expect(err).toBeInstanceOf(LeverFormatError);
    expect((err as LeverFormatError).path).toBe('kinds.zoning[0].spans[0].from');
  });
});

describe("compileTimeline: base 'preFzp'", () => {
  it("the default document gives twinInput(…, 'preFzp')'s view in every month", () => {
    const ctx = ctx60();
    const { c, t } = compiled(DEFAULT_POLICY4, ctx, 'preFzp');
    const twin = twinInput(ctx.input, ctx.layers, 'preFzp');
    const v = t.frameAt(W).view;
    expect(Array.from(v.parcels.envelopeStories)).toEqual(Array.from(twin.parcels.envelopeStories));
    expect(Array.from(v.parcels.localProgram)).toEqual(Array.from(twin.parcels.localProgram));
    expect(t.changes()).toEqual([]);
    expect(c.capacity().protectedLots).toBe(0);
    expect(c.unknownLots()).toBe(0);
    const { t: plan } = compiled(DEFAULT_POLICY4, ctx, 'plan');
    expect(plan.frameAt(1).id).not.toBe(t.frameAt(1).id);
  });

  it('route shares follow rule 14; the view keeps the pre-plan Local Program column', () => {
    const ctx = ctx60();
    const shares = { discretionary: 50, streamlined: 50, permitOnly: 0 };
    const set = timingSet({ routeShares: shares });
    const doc = reconciled(
      miniDoc(policy('t', { tag: 'routes' }, [[2, null, { tag: 'timing', set }]]))
    );
    const { t } = compiled(doc, ctx, 'preFzp');
    expect(t.frameAt(2).newCalibration.pathwayForNew.discretionary).toBe(0.5);
    expect(t.frameAt(2).view).toBe(t.frameAt(1).view);
    const lp = t.frameAt(2).view.parcels.localProgram;
    expect(Array.from(lp).every((x) => x === 0)).toBe(true);
  });

  it('a zoning policy in force throws LeverFormatError at base', () => {
    const ctx = ctx60();
    const c = compileTimeline(miniDoc(painted('p', [[13, null, 6]])), LOTS, ctx, 'preFzp');
    const err = errorOf(() => c.step(Infinity));
    expect(err).toBeInstanceOf(LeverFormatError);
    expect((err as LeverFormatError).path).toBe('base');
  });
});

describe('compileTimeline: slicing (rule 19)', () => {
  const doc = miniDoc(
    painted('p', [
      [13, 24, 6],
      [25, null, 8]
    ])
  );

  it('step(1) grows readyThrough to a one-call compile, capacity after completion', () => {
    const clock = fakeClock();
    const ctx = ctx60({ clock });
    const c = compileTimeline(doc, LOTS, ctx, 'plan');
    expect(() => c.result()).toThrow();
    expect(() => c.capacity()).toThrow();
    expect(() => c.unknownLots()).toThrow();
    let prev = 0;
    let calls = 0;
    let done = false;
    while (!done) {
      done = c.step(1);
      expect(++calls).toBeLessThan(200);
      const t = c.result();
      const r = t.readyThrough();
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(t.frameAt(r).id).toBeGreaterThan(0);
      if (!done) {
        expect(r).toBeLessThan(W);
        expect(() => t.frameAt(r + 1)).toThrow(RangeError);
        expect(() => c.capacity()).toThrow();
      }
      prev = r;
    }
    expect(calls).toBeGreaterThan(2);
    const t = c.result();
    expect(t.readyThrough()).toBe(W);
    expect(() => t.frameAt(0)).toThrow(RangeError);

    const { c: one, t: oneT } = compiled(doc, ctx);
    expect(idsOf(t)).toEqual(idsOf(oneT));
    for (const m of monthsOf(W)) expect(t.frameAt(m).view).toBe(oneT.frameAt(m).view);
    expect(t.changes()).toEqual(oneT.changes());

    const z = zoningLevers(inForceAt(doc, monthFirstDay(ASOF, W)), LOTS, true);
    const job = createViewJob(ctx.input, ctx.layers, fakeYields(), clock.now, z, 'plan');
    expect(job.step(Infinity)).toBe(true);
    expect(c.capacity()).toEqual(job.result().info.capacity);
    expect(c.unknownLots()).toBe(job.result().info.unknownLots);
    expect(one.capacity()).toEqual(c.capacity());
  });

  it('progress: total is the need count of the zoning states', () => {
    const ctx = ctx60();
    const c = compileTimeline(doc, LOTS, ctx, 'plan');
    expect(c.progress()).toEqual({ done: 0, total: 0, failedCells: [] });
    expect(c.step(Infinity)).toBe(true);
    let want = 0;
    for (const m of [1, 13, 25]) {
      const f = inForceAt(doc, monthFirstDay(ASOF, m));
      const z: ZoningLevers = zoningLevers(f, LOTS, permittingOf(f).localProgramStreamlined);
      const r = resolveEnvelopes(ctx.layers, { ...DEFAULT_LEVERS, ...z }, ASOF);
      want += new Set(allNeeds(r).map(needKey)).size;
    }
    expect(want).toBeGreaterThan(0);
    expect(c.progress()).toEqual({ done: want, total: want, failedCells: [] });
  });
});

describe('compileTimeline: waiting on cells', () => {
  /** A compile of a policy painted from month 13 whose yields wait on cells. */
  function waiting(failed: (needed: string[]) => string[]) {
    const clock = fakeClock();
    const ctx = ctx60({ clock });
    const needed: string[] = [];
    const yields = cellYields(clock, {
      missing: ['3512005'],
      get failed() {
        return failed(needed);
      }
    });
    const doc = miniDoc(painted('p', [[13, null, 7]]));
    const c: TimelineCompile = compileTimeline(doc, LOTS, { ...ctx, yields }, 'plan');
    return { c, yields, needed, ctx, doc };
  }

  it('returns false without spinning, passes through only the needed failed cells, then completes', () => {
    const { c, yields, needed, ctx, doc } = waiting((n) => ['no-such-cell', ...n]);
    expect(c.step(5)).toBe(false);
    expect(c.result().readyThrough()).toBe(12);
    const steps = yields.steps;
    for (let k = 0; k < 3; k++) {
      expect(c.step(5)).toBe(false);
      expect(c.result().readyThrough()).toBe(12);
    }
    expect(yields.steps).toBe(steps + 3);
    expect(c.progress().done).toBe(0);
    expect(c.progress().total).toBeGreaterThan(0);

    const cells = new Set(
      D1.map((id) => ctx.input.parcels.index.get(id)!).map(
        (row) => ctx.input.parcels.cells[ctx.input.parcels.cell[row]].cellId
      )
    );
    needed.push(...cells);
    expect(new Set(c.progress().failedCells)).toEqual(cells);

    for (const cell of cells) yields.loaded.add(cell);
    expect(c.missingLots()).toBe(0);
    expect(c.step(Infinity)).toBe(true);
    expect(c.result().readyThrough()).toBe(W);
    expect(c.progress().failedCells).toEqual([]);
    expect(c.missingLots()).toBe(1);

    const { t } = compiled(doc, ctx);
    expect(idsOf(c.result())).toEqual(idsOf(t));
  });
});
