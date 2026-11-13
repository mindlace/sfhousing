// Policy-timeline Task 16: `newScale`, the new-project scale `lookupsAt` uses, against today's
// `applyLevers(compileLevers(p)).plan.newProjects.scale`.
import { describe, expect, it } from 'vitest';
import { applyLevers } from '$lib/sim/levers/apply';
import { allNeeds, fillNeeds, resolveEnvelopes } from '$lib/sim/levers/resolve';
import { sameScale, type StageScale } from '$lib/sim/levers/timers';
import { MAX_SCALE, MIN_SCALE } from '$lib/sim/levers/types';
import { compileLevers, DEFAULT_POLICY, type SimPolicy } from '$lib/sim-page/policy';
import { resolvePreset, setStageMonths } from '$lib/sim-page/timing';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import { upgradePolicy } from '$lib/timeline/upgrade';
import { compileTimeline } from './compile';
import type { PolicyFrame } from './frame';
import { newScale } from './lookups';
import { fakeRows, miniCompileCtx } from './test/compile-fixtures';

const CTX = miniCompileCtx({ windowMonths: 6 });
const ASOF = CTX.input.asOf;
const CAL = CTX.input.calibration;
const none = () => [];

describe('newScale', () => {
  it('equals today’s newProjects.scale for `all` and `new` timers', () => {
    // sb423Clock's `new` timer, with `all` edits on other stages
    let set = resolvePreset('sb423Clock', CAL);
    set = setStageMonths(CAL, set, 'discretionary', 'filed', 3).set;
    set = setStageMonths(CAL, set, 'streamlined', 'permitFiled', 2).set;
    expect(set.presetTimers.some((t) => t.reach === 'new')).toBe(true);
    expect(set.edits.length).toBe(2);
    const p: SimPolicy = {
      ...structuredClone(DEFAULT_POLICY),
      timing: { current: set, saved: null }
    };

    const levers = compileLevers(p, none)!;
    const r = resolveEnvelopes(CTX.layers, levers, ASOF);
    const want = applyLevers(CTX.input, CTX.layers, levers, fillNeeds(r, fakeRows(allNeeds(r))))
      .plan.newProjects!.scale;

    const { doc } = reconcilePolicy4(upgradePolicy(p, ASOF), CAL, ASOF);
    const c = compileTimeline(doc, {}, CTX, 'plan');
    expect(c.step(Infinity)).toBe(true);
    const f = c.result().frameAt(1);
    expect(f.speedNew.length).toBeGreaterThan(0);
    expect(sameScale(newScale(f), want)).toBe(true);
  });

  it('clamps the product to [MIN_SCALE, MAX_SCALE]', () => {
    const empty = (): StageScale => ({ discretionary: {}, streamlined: {}, permitOnly: {} });
    const speed = empty();
    speed.discretionary.filed = 0.2;
    speed.streamlined.filed = 5;
    const a = empty();
    a.discretionary.filed = 0.2;
    a.streamlined.filed = 4;
    a.permitOnly.filed = 0.5;
    const frame = { speed, speedNew: [{ from: ASOF + 1, scale: a }] } as unknown as PolicyFrame;
    const s = newScale(frame);
    expect(s.discretionary.filed).toBe(MIN_SCALE);
    expect(s.streamlined.filed).toBe(MAX_SCALE);
    expect(s.permitOnly.filed).toBe(0.5);
  });
});
