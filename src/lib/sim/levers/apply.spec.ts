// Plan 2 Task 10: compiling a filled lever resolution into the plan's and the twin's SimInputs.
import { describe, expect, it } from 'vitest';
import type { EnvelopeRow } from '$lib/data/envelope-row';
import { chanceTable, parseCalibration, typicalMonths } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import miniCalibrationJson from '../scenario/fixtures/mini-calibration.json';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { MINI_S207_ID, MINI_SB79_ID, miniPolicy } from '../scenario/fixtures/mini-policy';
import { MINI_HORIZON, miniProjectsJson } from '../scenario/fixtures/mini-projects';
import { buildSimInput } from '../scenario/input';
import { applyPolicies, baseZoning } from '../scenario/policy';
import { REFERENCES, monthsOf, planEffectOf } from '../scenario/score';
import { simulateDetailed, simulateNet } from '../scenario/simulate';
import type { SimInput } from '../scenario/types';
import { applyLevers, lookupsOf, twinInput } from './apply';
import type { LayerCtx } from './layers';
import { allNeeds, fillNeeds, needKey, resolveEnvelopes } from './resolve';
import { CURRENT_LAW_SWITCH, DEFAULT_LEVERS, FZP_COMPAT_LEVERS, type SimLevers } from './types';

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
  const window = { asOf: base.asOf, horizon: H, switchDay: CURRENT_LAW_SWITCH.day };
  const filled = fillNeeds(resolveEnvelopes(ctx, levers, window), new Map());
  return applyLevers(base, ctx, levers, filled, H);
}

const clone = (l: SimLevers, patch: Partial<SimLevers> = {}): SimLevers => ({
  ...structuredClone(l),
  ...patch
});

describe('applyLevers: the FZP-compatible levers', () => {
  const { base, ctx } = setup();
  const { plan, twin, references } = compile(base, ctx, clone(FZP_COMPAT_LEVERS));
  const months = monthsOf(base.asOf, H);
  const preFzp = applyPolicies([baseZoning], base);

  it('reproduce the base run and the baseZoning twin, seeds 1-20', () => {
    expect(plan.lawSwitch).toBeUndefined();
    expect(plan.inFlightScale).toBeUndefined();
    for (const seed of seeds(20)) {
      expect(simulateDetailed(plan, seed, H)).toEqual(simulateDetailed(base, seed, H));
      expect(simulateNet(twin, seed, H, months)).toEqual(simulateNet(preFzp, seed, H, months));
    }
  });

  it("show every reference with compare 'preFzp'", () => {
    expect(references).toBe(REFERENCES);
  });
});

describe('applyLevers: the default levers', () => {
  const { base, ctx } = setup();
  const levers = clone(DEFAULT_LEVERS);
  const out = compile(base, ctx, levers);
  const months = monthsOf(base.asOf, H);

  it('switch the law on the switch day, as does the current-law twin', () => {
    expect(out.plan.lawSwitch?.day).toBe(CURRENT_LAW_SWITCH.day);
    expect(out.twin.lawSwitch?.day).toBe(CURRENT_LAW_SWITCH.day);
  });

  it('give a zero plan effect at every month, seeds 1-5', () => {
    let built = 0;
    for (const seed of seeds(5)) {
      const net = simulateNet(out.plan, seed, H, months);
      built += net.entitledNew[months.length - 1];
      const effect = planEffectOf(net, simulateNet(out.twin, seed, H, months));
      expect(effect).toHaveLength(months.length);
      for (const m of effect) expect(m).toEqual({ entitledNew: 0, completedNetNew: 0 });
    }
    expect(built).not.toBe(0); // the runs entitle new projects, so the zero is not vacuous
  });

  it("keep only the completedNet references with compare 'currentLaw'", () => {
    expect(out.references).toEqual(REFERENCES.filter((r) => r.measure === 'completedNet'));
  });

  it('give the same result when called twice', () => {
    const again = compile(base, ctx, clone(DEFAULT_LEVERS));
    for (const seed of seeds(3)) {
      expect(simulateNet(again.plan, seed, H, months)).toEqual(
        simulateNet(out.plan, seed, H, months)
      );
    }
  });

  it('never mutate the shared lever constants', () => {
    expect(DEFAULT_LEVERS.stock).toEqual(['currentLaw']);
    expect(DEFAULT_LEVERS.assumeAlternativePlanKept).toBe(false);
    expect(FZP_COMPAT_LEVERS.stock).toEqual(['fzp']);
  });
});

describe('twins', () => {
  it("the 'preFzp' twin has no lawSwitch, even when the plan switches", () => {
    const { base, ctx } = setup();
    const out = compile(base, ctx, clone(DEFAULT_LEVERS, { compare: 'preFzp' }));
    expect(out.plan.lawSwitch).toBeDefined();
    expect(out.twin.lawSwitch).toBeUndefined();
    expect(out.twin.newProjects).toBeUndefined();
    expect(out.twin.inFlightScale).toBeUndefined();
  });

  it("the 'currentLaw' twin with assumeAlternativePlanKept has no lawSwitch", () => {
    const { base, ctx } = setup();
    const twin = twinInput(
      base,
      ctx,
      clone(DEFAULT_LEVERS, { assumeAlternativePlanKept: true }),
      H
    );
    expect(twin.lawSwitch).toBeUndefined();
  });

  it("the 'currentLaw' twin has no timers, whatever the plan's", () => {
    const { base, ctx } = setup();
    const levers = clone(DEFAULT_LEVERS, {
      timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'all' }]
    });
    const out = compile(base, ctx, levers);
    expect(out.plan.inFlightScale).toBeDefined();
    expect(out.twin.inFlightScale).toBeUndefined();
    expect(out.twin.calibration).toBe(base.calibration);
  });

  it('twinInput is the same object for lever documents that differ only in user', () => {
    const { base, ctx } = setup();
    const a = clone(DEFAULT_LEVERS);
    const b = clone(DEFAULT_LEVERS, {
      user: [{ lots: ['2999A001'], mode: 'raise', stories: 9, densityLimits: false }]
    });
    expect(twinInput(base, ctx, b, H)).toBe(twinInput(base, ctx, a, H));
    const pre = clone(a, { compare: 'preFzp' });
    expect(twinInput(base, ctx, pre, H)).not.toBe(twinInput(base, ctx, a, H));
  });
});

describe('lookupsOf', () => {
  it('shares one lookup set without timers, equal to the base calibration tables', () => {
    const { base, ctx } = setup();
    const { plan, lookups } = compile(base, ctx, clone(DEFAULT_LEVERS));
    expect(lookups.fresh).toBe(lookups.inFlight);
    expect(lookups.inFlight.chance).toEqual(chanceTable(base.calibration));
    expect(lookups.inFlight.typicalMonths).toEqual(typicalMonths(base.calibration));
    const again = lookupsOf(plan);
    expect(again.fresh).toBe(again.inFlight);
    expect(again).toEqual(lookups);
  });

  it("shares one lookup set with only an 'all' timer", () => {
    const { base, ctx } = setup();
    const levers = clone(DEFAULT_LEVERS, {
      timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'all' }]
    });
    const { lookups } = compile(base, ctx, levers);
    expect(lookups.fresh).toBe(lookups.inFlight);
    expect(lookups.inFlight.chance).not.toEqual(chanceTable(base.calibration));
  });

  it("gives new projects their own lookup set with a 'new' timer", () => {
    const { base, ctx } = setup();
    const levers = clone(DEFAULT_LEVERS, {
      timers: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'new' }]
    });
    const { plan, lookups } = compile(base, ctx, levers);
    expect(lookups.fresh).not.toBe(lookups.inFlight);
    expect(lookups.inFlight.chance).toEqual(chanceTable(base.calibration));
    expect(lookups.fresh.chance).toEqual(chanceTable(plan.newProjects!.calibration));
    expect(plan.inFlightScale).toBeUndefined(); // a 'new' timer leaves in-flight rows alone
  });
});

describe('applyLevers: a capped edit under FZP stock', () => {
  it("lawSwitch.parcels carries the after view's envelope for the edited lot", () => {
    const { base, ctx } = setup();
    const i = ctx.parcels.index.get(MINI_SB79_ID)!;
    ctx.policy.sb79Cap[i] = 30; // current-law cap: none before the switch, 30 after
    const levers = clone(FZP_COMPAT_LEVERS, {
      user: [{ lots: [MINI_SB79_ID], mode: 'set', stories: 7, densityLimits: true }]
    });
    const window = { asOf: base.asOf, horizon: H, switchDay: CURRENT_LAW_SWITCH.day };
    const r = resolveEnvelopes(ctx, levers, window);
    const yields = new Map([
      [needKey({ row: i, stories: 7, cap: null }), [0, 1, 2, 3, 4]],
      [needKey({ row: i, stories: 7, cap: 30 }), [0, 1, 1, 2, 2]]
    ]);
    const rows = new Map<string, EnvelopeRow>(
      allNeeds(r).map((n) => [
        needKey(n),
        { stories: n.stories, cap: n.cap, yield: yields.get(needKey(n))!, hostable: true }
      ])
    );
    const out = applyLevers(base, ctx, levers, fillNeeds(r, rows), H);
    const F = base.parcels.fillLevels.length;
    const yieldOf = (p: SimInput['parcels']) => Array.from(p.yield.subarray(i * F, i * F + F));
    expect(out.plan.lawSwitch?.day).toBe(CURRENT_LAW_SWITCH.day);
    const after = out.plan.lawSwitch!.parcels;
    expect(after.envelopeStories[i]).toBe(7);
    expect(yieldOf(after)).toEqual([0, 1, 1, 2, 2]);
    expect(after.hostable[i]).toBe(1);
    expect(yieldOf(out.plan.parcels)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('applyLevers: Local Program after the switch', () => {
  it('a Local Program lot where SB 79 wins after the switch is forced only before it', () => {
    const { base, ctx } = setup();
    const i = ctx.parcels.index.get(MINI_SB79_ID)!;
    const out = compile(base, ctx, clone(DEFAULT_LEVERS));
    expect(out.plan.parcels.localProgram[i]).toBe(1);
    expect(out.plan.lawSwitch!.parcels.localProgram[i]).toBe(0);
    expect(out.twin.lawSwitch!.parcels.localProgram[i]).toBe(0);
  });

  it('keeps the switch when only the Local Program column changes at it', () => {
    const { base, ctx } = setup();
    const i = ctx.parcels.index.get(MINI_SB79_ID)!;
    // Pin the §207.11 lot to its before-switch row in both periods, so no envelope changes.
    const levers = clone(DEFAULT_LEVERS, {
      stock: ['currentLaw', 'sb79'],
      user: [{ lots: [MINI_S207_ID], mode: 'set', stories: 12, densityLimits: false }]
    });
    const window = { asOf: base.asOf, horizon: H, switchDay: CURRENT_LAW_SWITCH.day };
    const r = resolveEnvelopes(ctx, levers, window);
    expect(r.after).not.toBeNull();
    expect(r.after!.period.table).toEqual(r.before.table);
    const out = compile(base, ctx, levers);
    expect(out.plan.lawSwitch?.day).toBe(CURRENT_LAW_SWITCH.day);
    expect(out.plan.parcels.localProgram[i]).toBe(1);
    expect(out.plan.lawSwitch!.parcels.localProgram[i]).toBe(0);
  });
});

describe('applyLevers: capacity and unknown lots', () => {
  it('passes the capacity and the unknown named lots through', () => {
    const { base, ctx } = setup();
    const levers = clone(DEFAULT_LEVERS, {
      protect: { ...DEFAULT_LEVERS.protect, lots: ['no-such-lot'] }
    });
    const out = compile(base, ctx, levers);
    expect(out.unknownLots).toBe(1);
    expect(out.capacity.plan).toBeGreaterThan(0);
    expect(out.capacity.afterSwitch).not.toBeNull();
  });
});
