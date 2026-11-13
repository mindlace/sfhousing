// Policy-timeline Task 9: one zoning state's view, in slices (spec rules 18 and 20).
import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { applyLevers, twinInput } from '$lib/sim/levers/apply';
import { allNeeds, fillNeeds, resolveEnvelopes } from '$lib/sim/levers/resolve';
import { DEFAULT_LEVERS, LeverFormatError } from '$lib/sim/levers/types';
import { MINI_HORIZON as H } from '$lib/sim/scenario/fixtures/mini-projects';
import { precomputeOf, type Precompute } from '$lib/sim/scenario/input';
import type { ZoningLevers } from './combine';
import type { ZoningView } from './frame';
import {
  cellYields,
  fakeClock,
  fakeRows,
  fakeYields,
  miniCompileCtx
} from './test/compile-fixtures';
import { createViewJob, touchedRows, viewDigest, type ViewJob } from './zoning-view';

const NONE: ZoningLevers = {
  rules: [],
  paint: [],
  protect: { rentControl: false, historic: false, newerThanYears: null },
  localProgramStreamlined: true
};
const zoning = (patch: Partial<ZoningLevers>): ZoningLevers => ({ ...NONE, ...patch });

// District-1 lots outside the Local Program with no base cap: FZP 4 stories.
const D1 = ['2999A001', '2999A013', '3512005', '3600014', '3600016'];
// Already at 6 stories, uncapped, under FZP: painting them 6 leaves their FZP row.
const AT_SIX = ['0026T002', '0026T004'];

const PAINTED = zoning({ paint: [{ lots: [...D1, 'no-such-lot'], stories: 7 }] });
const TRANSIT = zoning({
  rules: [
    { lots: ['0026T001A', '2999A001', '3512005'], stories: 9 },
    { lots: ['2999A001', '3600014'], stories: 12 }
  ]
});
const PROTECTED = zoning({
  protect: { rentControl: true, historic: true, newerThanYears: null },
  paint: [{ lots: ['0026T009', '2999A009', '3512014'], stories: 8 }]
});

const COLUMNS = [
  'envelopeStories',
  'yield',
  'hostable',
  'localProgram',
  'potentialRatio',
  'storiesGap'
] as const;

function expectSameColumns(a: ScenarioParcels, b: ScenarioParcels) {
  for (const c of COLUMNS) {
    if (c === 'potentialRatio' || c === 'storiesGap')
      expect(Array.from(a[c].fzp), c).toEqual(Array.from(b[c].fzp));
    else expect(Array.from(a[c]), c).toEqual(Array.from(b[c]));
  }
}

/** A precompute's data, its closures applied to fixed arguments. */
function preData(pre: Precompute) {
  const { parcelIndexOf, skipAbove, ...data } = pre;
  return { ...data, index: parcelIndexOf('2999A001'), skip: skipAbove(H) };
}

function build(job: ViewJob) {
  expect(job.step(Infinity)).toBe(true);
  return job.result();
}

describe('createViewJob: parity with today (rule 18)', () => {
  for (const [name, z] of [
    ['painted', PAINTED],
    ['transit', TRANSIT],
    ['protected', PROTECTED]
  ] as const) {
    it(`${name} levers give applyLevers' plan, precompute, capacity and unknown lots`, () => {
      const ctx = miniCompileCtx({ market: true });
      const { input, layers } = ctx;
      const { view, info } = build(createViewJob(input, layers, ctx.yields, ctx.now!, z, 'plan'));

      const levers = { ...DEFAULT_LEVERS, ...z };
      const r = resolveEnvelopes(layers, levers, input.asOf);
      expect(allNeeds(r).length).toBeGreaterThan(0);
      const ref = applyLevers(input, layers, levers, fillNeeds(r, fakeRows(allNeeds(r))));
      expectSameColumns(view.parcels, ref.plan.parcels);
      expect(preData(view.pre)).toEqual(preData(precomputeOf(ref.plan)));
      expect(info.capacity).toEqual(ref.capacity);
      expect(info.unknownLots).toBe(ref.unknownLots);
    });
  }

  it('reports one unknown lot for a painted id not in the dataset', () => {
    const ctx = miniCompileCtx();
    const { info } = build(
      createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, PAINTED, 'plan')
    );
    expect(info.unknownLots).toBe(1);
  });

  it('runs with public money in the input', () => {
    const ctx = miniCompileCtx({ finance: true, market: true });
    const { view } = build(
      createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, PAINTED, 'plan')
    );
    expect(view.parcels.count).toBe(ctx.input.parcels.count);
  });

  it('lp off gives an all-zero Local Program column', () => {
    const ctx = miniCompileCtx();
    expect(ctx.input.parcels.localProgram.some((x) => x === 1)).toBe(true);
    const z = zoning({ localProgramStreamlined: false });
    const { view } = build(createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, z, 'plan'));
    expect(Array.from(view.parcels.localProgram).every((x) => x === 0)).toBe(true);
  });
});

describe("createViewJob: base 'preFzp'", () => {
  it("with no zoning levers gives twinInput(…, 'preFzp')'s parcels", () => {
    const ctx = miniCompileCtx();
    const { view, info } = build(
      createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, NONE, 'preFzp')
    );
    const twin = twinInput(ctx.input, ctx.layers, 'preFzp');
    expectSameColumns(view.parcels, twin.parcels);
    expect(view.pre).toBe(precomputeOf(twin));
    expect(info.unknownLots).toBe(0);
    expect(info.capacity.protectedLots).toBe(0);
    expect(info.capacity.plan).toBe(info.capacity.withoutProtections);
  });

  it('with any zoning lever throws LeverFormatError at base', () => {
    const ctx = miniCompileCtx();
    for (const z of [PAINTED, TRANSIT, PROTECTED]) {
      let err: unknown;
      try {
        createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, z, 'preFzp');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(LeverFormatError);
      expect((err as LeverFormatError).path).toBe('base');
    }
  });
});

describe('createViewJob: slicing', () => {
  it('step(3) computes at most 3 needs a call and ends at the one-call result', () => {
    const clock = fakeClock();
    const ctx = miniCompileCtx({ clock });
    const z = zoning({
      paint: [
        { lots: D1, stories: 7 },
        { lots: ['0026T009', '2999A009', '3512012', '3512014'], stories: 9 }
      ]
    });
    const job = createViewJob(ctx.input, ctx.layers, ctx.yields, clock.now, z, 'plan');
    expect([job.done, job.total]).toEqual([0, 0]);
    const dones: number[] = [];
    let calls = 0;
    while (!job.step(3)) {
      dones.push(job.done);
      expect(++calls).toBeLessThan(100);
    }
    dones.push(job.done);
    expect(job.total).toBe(9);
    expect(job.done).toBe(9);
    let prev = 0;
    for (const d of dones) {
      expect(d - prev).toBeGreaterThanOrEqual(0);
      expect(d - prev).toBeLessThanOrEqual(3);
      prev = d;
    }
    expect(dones.length).toBeGreaterThanOrEqual(3);
    expect(job.cellsNeeded()).toEqual([]);

    const once = miniCompileCtx();
    const one = build(createViewJob(once.input, once.layers, fakeYields(), once.now!, z, 'plan'));
    const sliced = job.result();
    expectSameColumns(sliced.view.parcels, one.view.parcels);
    expect(preData(sliced.view.pre)).toEqual(preData(one.view.pre));
    expect(sliced.info).toEqual(one.info);
  });

  it('waits on cells without progress, then finishes and reports the missing lots', () => {
    const clock = fakeClock();
    const ctx = miniCompileCtx({ clock });
    const yields = cellYields(clock, { missing: ['2999A013'] });
    const job = createViewJob(ctx.input, ctx.layers, yields, clock.now, PAINTED, 'plan');
    expect(job.step(5)).toBe(false);
    const cells = job.cellsNeeded();
    expect(cells.length).toBeGreaterThan(0);
    const steps = yields.steps;
    expect(job.step(5)).toBe(false);
    expect(yields.steps).toBe(steps + 1);
    expect(job.done).toBe(0);
    expect(job.missing()).toEqual([]);
    for (const c of cells) yields.loaded.add(c);
    expect(job.step(Infinity)).toBe(true);
    expect(job.cellsNeeded()).toEqual([]);
    expect(job.missing()).toEqual(['2999A013']);
  });

  it('result() before the view is built throws', () => {
    const ctx = miniCompileCtx();
    const job = createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, PAINTED, 'plan');
    expect(() => job.result()).toThrow();
  });
});

describe('touchedRows (rule 20)', () => {
  const ctx = miniCompileCtx();
  const viewOf = (z: ZoningLevers): ZoningView =>
    build(createViewJob(ctx.input, ctx.layers, ctx.yields, ctx.now!, z, 'plan')).view;
  const base = viewOf(NONE);
  const painted = viewOf(zoning({ paint: [{ lots: [...D1, ...AT_SIX], stories: 6 }] }));
  const rowsOf = (ids: string[]) => ids.map((id) => ctx.input.parcels.index.get(id)!);

  it('finds exactly the lots whose row changed, ascending', () => {
    const want = rowsOf(D1).sort((a, b) => a - b);
    expect(Array.from(touchedRows(base, painted))).toEqual(want);
    expect(Array.from(touchedRows(painted, base))).toEqual(want);
  });

  it('is empty for identical views', () => {
    expect(touchedRows(base, base).length).toBe(0);
    expect(touchedRows(base, viewOf(NONE)).length).toBe(0);
  });

  it('viewDigest: equal for equal content, different when a row differs', () => {
    expect(viewDigest(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(viewDigest(viewOf(NONE))).toBe(viewDigest(base));
    // a different lever key, the same content
    expect(viewDigest(viewOf(zoning({ paint: [{ lots: AT_SIX, stories: 6 }] })))).toBe(
      viewDigest(base)
    );
    expect(viewDigest(painted)).not.toBe(viewDigest(base));
  });
});
