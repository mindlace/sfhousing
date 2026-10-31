// Plan 2 Task 10, sim runs plan 1 Task 1: compiling a filled lever resolution into the plan's
// and the twin's SimInputs.
import { describe, expect, it } from 'vitest';
import { chanceTable, parseCalibration, typicalMonths } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import miniCalibrationJson from '../scenario/fixtures/mini-calibration.json';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { miniPolicy } from '../scenario/fixtures/mini-policy';
import { MINI_HORIZON, miniProjectsJson } from '../scenario/fixtures/mini-projects';
import { buildSimInput } from '../scenario/input';
import { applyPolicies, baseZoning } from '../scenario/policy';
import { REFERENCES, monthsOf } from '../scenario/score';
import { simulateDetailed, simulateNet } from '../scenario/simulate';
import type { SimInput } from '../scenario/types';
import { applyLevers, lookupsOf, twinInput } from './apply';
import type { LayerCtx } from './layers';
import { fillNeeds, resolveEnvelopes } from './resolve';
import { DEFAULT_LEVERS, type Compare, type SimLevers } from './types';

const H = MINI_HORIZON;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function setup(): { base: SimInput; ctx: LayerCtx } {
  const city = miniCity();
  const base = buildSimInput({
    parcels: city.parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown)
  });
  return { base, ctx: { parcels: city.parcels, policy: miniPolicy(city) } };
}

function compile(base: SimInput, ctx: LayerCtx, levers: SimLevers) {
  const filled = fillNeeds(resolveEnvelopes(ctx, levers, base.asOf), new Map());
  return applyLevers(base, ctx, levers, filled);
}

const clone = (patch: Partial<SimLevers> = {}): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  ...patch
});

describe('applyLevers: the default levers', () => {
  const { base, ctx } = setup();
  const { plan, twin, references } = compile(base, ctx, clone());
  const months = monthsOf(base.asOf, H);
  const preFzp = applyPolicies([baseZoning], base);

  it('reproduce the base run and the baseZoning twin, seeds 1-20', () => {
    expect(plan.lawSwitch).toBeUndefined();
    expect(plan.inFlightScale).toBeUndefined();
    // `newProjects` is set, so in-flight schedules carry the cohort flag (Call 15); nothing else
    const unflag = (r: ReturnType<typeof simulateDetailed>) => ({
      ...r,
      schedules: r.schedules.map(({ inFlight: _, ...s }) => s)
    });
    for (const seed of seeds(20)) {
      expect(unflag(simulateDetailed(plan, seed, H))).toEqual(simulateDetailed(base, seed, H));
      expect(simulateNet(twin, seed, H, months)).toEqual(simulateNet(preFzp, seed, H, months));
    }
  });

  it("show every reference with compare 'preFzp'", () => {
    expect(references).toBe(REFERENCES);
  });

  it('never mutate the shared lever constants', () => {
    compile(base, ctx, clone({ paint: [{ lots: ['2999A001'], stories: 0 }] }));
    expect(DEFAULT_LEVERS.rules).toEqual([]);
    expect(DEFAULT_LEVERS.paint).toEqual([]);
    expect(DEFAULT_LEVERS.compare).toBe('preFzp');
  });
});

describe('twins', () => {
  it("the 'fzp' twin is FZP as written and never switches", () => {
    const { base, ctx } = setup();
    const months = monthsOf(base.asOf, H);
    const twin = twinInput(base, ctx, 'fzp');
    expect(Array.from(twin.parcels.envelopeStories)).toEqual(
      Array.from(base.parcels.envelopeStories)
    );
    expect(simulateNet(twin, 7, H, months)).toEqual(simulateNet(base, 7, H, months));
    expect(twin.lawSwitch).toBeUndefined();
    expect(twin.inFlightScale).toBeUndefined();
    expect(twinInput(base, ctx, 'fzp')).toBe(twin); // memoised
  });

  it("the 'preFzp' twin is baseZoning with no lever fields", () => {
    const { base, ctx } = setup();
    const out = compile(base, ctx, clone());
    expect(out.twin.lawSwitch).toBeUndefined();
    expect(out.twin.newProjects).toBeUndefined();
    expect(out.twin.inFlightScale).toBeUndefined();
    expect(out.twin.parcels.envelopeStories).toBe(base.parcels.baseStories);
  });

  it("the 'fzp' twin has no timers, whatever the plan's", () => {
    const { base, ctx } = setup();
    const levers = clone({
      compare: 'fzp',
      timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'all' }]
    });
    const out = compile(base, ctx, levers);
    expect(out.plan.inFlightScale).toBeDefined();
    expect(out.twin.inFlightScale).toBeUndefined();
    expect(out.twin.calibration).toBe(base.calibration);
  });

  it('twinInput is the same object for lever documents with the same compare', () => {
    const { base, ctx } = setup();
    const a = compile(base, ctx, clone({ compare: 'fzp' }));
    const b = compile(
      base,
      ctx,
      clone({ compare: 'fzp', paint: [{ lots: ['2999A001'], stories: 0 }] })
    );
    expect(b.twin).toBe(a.twin);
    expect(twinInput(base, ctx, 'preFzp')).not.toBe(a.twin);
  });

  it('references: all under preFzp, only completedNet under fzp', () => {
    const { base, ctx } = setup();
    const r = (compare: Compare) =>
      applyLevers(
        base,
        ctx,
        { ...DEFAULT_LEVERS, compare },
        resolveEnvelopes(ctx, DEFAULT_LEVERS, base.asOf)
      ).references;
    expect(r('preFzp')).toEqual(REFERENCES);
    expect(r('fzp').every((x) => x.measure === 'completedNet')).toBe(true);
    expect(r('fzp')).toEqual(REFERENCES.filter((x) => x.measure === 'completedNet'));
  });
});

describe('lookupsOf', () => {
  it('shares one lookup set without timers, equal to the base calibration tables', () => {
    const { base, ctx } = setup();
    const { plan, lookups } = compile(base, ctx, clone());
    expect(lookups.fresh).toBe(lookups.inFlight);
    expect(lookups.inFlight.chance).toEqual(chanceTable(base.calibration));
    expect(lookups.inFlight.typicalMonths).toEqual(typicalMonths(base.calibration));
    const again = lookupsOf(plan);
    expect(again.fresh).toBe(again.inFlight);
    expect(again).toEqual(lookups);
  });

  it("shares one lookup set with only an 'all' timer", () => {
    const { base, ctx } = setup();
    const levers = clone({
      timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'all' }]
    });
    const { lookups } = compile(base, ctx, levers);
    expect(lookups.fresh).toBe(lookups.inFlight);
    expect(lookups.inFlight.chance).not.toEqual(chanceTable(base.calibration));
  });

  it("gives new projects their own lookup set with a 'new' timer", () => {
    const { base, ctx } = setup();
    const levers = clone({
      timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'new' }]
    });
    const { plan, lookups } = compile(base, ctx, levers);
    expect(lookups.fresh).not.toBe(lookups.inFlight);
    expect(lookups.inFlight.chance).toEqual(chanceTable(base.calibration));
    expect(lookups.fresh.chance).toEqual(chanceTable(plan.newProjects!.calibration));
    expect(plan.inFlightScale).toBeUndefined(); // a 'new' timer leaves in-flight rows alone
  });
});

describe('applyLevers: Local Program', () => {
  it('streamlining off zeroes the plan column', () => {
    const { base, ctx } = setup();
    const on = compile(base, ctx, clone());
    const off = compile(base, ctx, clone({ localProgramStreamlined: false }));
    expect(on.plan.parcels.localProgram).toBe(base.parcels.localProgram);
    expect(off.plan.parcels.localProgram.every((x) => x === 0)).toBe(true);
  });
});

describe('applyLevers: capacity and unknown lots', () => {
  it('passes the capacity and the unknown named lots through', () => {
    const { base, ctx } = setup();
    const levers = clone({
      rules: [{ lots: ['no-such-lot'], stories: 5 }],
      protect: { ...DEFAULT_LEVERS.protect, lots: ['no-such-lot'] }
    });
    const out = compile(base, ctx, levers);
    expect(out.unknownLots).toBe(1);
    expect(out.capacity.plan).toBeGreaterThan(0);
    expect(out.capacity).not.toHaveProperty('afterSwitch');
  });
});
