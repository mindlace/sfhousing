import { describe, expect, it } from 'vitest';
import type { TimelineView } from '$lib/sim/world/score/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { headerOf, resultsAt, scoreOfView } from './results';
import { chunk, cut, statics } from './test/fixtures';

function whole(compare: 'plan' | 'preFzp' = 'plan'): TimelineView {
  const s = { ...statics({ finance: true }), compare };
  return viewOfLog(logFilled(logCompiled(EMPTY_LOG, s), chunk(0, 24, { pools: ['a', 'b'] })))!;
}

describe('headerOf', () => {
  it('the header number is baseline plus the world at lastIndex', () => {
    const v = whole();
    expect(headerOf(v).total).toBe(v.baseline.completedNet + v.rows[v.lastIndex].completedNet);
  });

  it('is calculating before the window is filled, and without a view', () => {
    expect(headerOf(cut(whole(), 10)).total).toBeNull();
    expect(headerOf(cut(whole(), 10)).delta).toBeNull();
    expect(headerOf(null).total).toBeNull();
  });

  it('the year is the last month', () => {
    expect(headerOf(whole()).year).toBe(1971);
  });

  it('the delta is the plan effect at lastIndex only against the plan', () => {
    const v = whole();
    expect(headerOf(v).delta).toBe(v.planEffect[v.lastIndex].completedNetNew);
    expect(headerOf(whole('preFzp')).delta).toBeNull();
  });

  it('the delta can be negative', () => {
    const v = whole();
    const planEffect = v.planEffect.map((p, i) =>
      i === v.lastIndex ? { ...p, completedNetNew: -569 } : p
    );
    expect(headerOf({ ...v, planEffect }).delta).toBe(-569);
  });

  it('an identical twin gives delta +0', () => {
    const v = whole();
    const planEffect = v.planEffect.map(() => ({ entitledNew: 0, completedNetNew: 0 }));
    expect(Object.is(headerOf({ ...v, planEffect }).delta, 0)).toBe(true);
  });

  it('the target waits for its deadline month to be filled', () => {
    const v = whole();
    expect(headerOf(cut(v, 0)).target).toBeNull();
    const t = headerOf(v).target;
    expect(t?.target.id).toBe('rhna');
    expect(t?.fraction).toBe(v.targets[0].fraction[v.lastIndex]);
  });
});

describe('scoreOfView and resultsAt', () => {
  it('resultsAt reads the world', () => {
    const v = whole();
    const r = resultsAt(v, null, 12);
    expect(r.total).toBe(v.baseline.completedNet + v.rows[12].completedNet);
    expect('band' in r).toBe(false);
    expect('planBand' in r).toBe(false);
    expect(r.planCompleted).toBe(v.planEffect[12].completedNetNew);
  });

  it('scoreOfView passes no band', () => {
    const v = cut(whole(), 10);
    const s = scoreOfView(v, null);
    expect(s.band).toEqual([]);
    expect(s.planEffectBand).toEqual([]);
    expect(s.shown).toEqual(v.rows.slice(0, 11));
  });

  it('keeps only the filled months, money from the view and no tiers without a baseline', () => {
    const v = cut(whole(), 10);
    const s = scoreOfView(v, null);
    expect(s.shown).toHaveLength(11);
    expect(s.months).toHaveLength(24);
    expect(s.money).toBe(v.money ?? undefined);
    expect(s.tiers).toBeUndefined();
  });

  it('an empty view has no money or tiers', () => {
    const empty = viewOfLog(logCompiled(EMPTY_LOG, statics()))!;
    const s = scoreOfView(empty, null);
    expect(s.money).toBeUndefined();
    expect(s.shown).toEqual([]);
  });
});
