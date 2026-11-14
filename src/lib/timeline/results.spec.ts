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
  it('the header number is baseline plus the average at lastIndex', () => {
    const v = whole();
    expect(headerOf(v).total).toBe(v.baseline.completedNet + v.mean[v.lastIndex].completedNet);
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
    expect(headerOf(v).delta).toBe(Math.round(v.planEffect[v.lastIndex].completedNetNew));
    expect(headerOf(whole('preFzp')).delta).toBeNull();
  });

  it('the target waits for its deadline month to be filled', () => {
    const v = whole();
    expect(headerOf(cut(v, 0)).target).toBeNull();
    const t = headerOf(v).target;
    expect(t?.target.id).toBe('rhna');
    expect(t?.fraction).toBe(v.targets[0].fraction[v.lastIndex]);
  });
});

describe('fractional means', () => {
  function fractional(): TimelineView {
    const v = whole();
    const mean = v.mean.map((m, i) => ({
      ...m,
      completedNet: 10.4 + i,
      completedNetPipeline: 5.4 + i / 2,
      completedNetNew: 5.4 + i / 2
    }));
    return { ...v, mean };
  }

  it('rounds the headline and the header to whole homes', () => {
    const v = fractional();
    expect(headerOf(v).total).toBe(v.baseline.completedNet + 33);
    expect(resultsAt(v, null, 0).at.total).toBe(v.baseline.completedNet + 10);
  });

  it('the pipeline and new parts add up to the rounded total', () => {
    const v = fractional();
    for (let i = 0; i < 24; i++) {
      const { at } = resultsAt(v, null, i);
      expect(at.pipeline + at.fresh).toBe(at.total - at.actual);
    }
  });
});

describe('scoreOfView and resultsAt', () => {
  it('resultsAt gives the average basis and This city', () => {
    const v = whole();
    const r = resultsAt(v, null, 12);
    const base = v.baseline.completedNet;
    expect(r.at.total).toBe(base + v.mean[12].completedNet);
    // Whole homes: the band's ends are rounded (the mean and sd are fractions).
    expect(r.at.band).toEqual({
      low: base + Math.round(v.band[12].lo),
      high: base + Math.round(v.band[12].hi)
    });
    expect(r.city).toBe(base + v.shown[12].completedNet);
    expect(r.at.planCompleted).toBe(v.planEffect[12].completedNetNew);
    expect(r.at.planBand).toEqual({
      low: Math.round(v.planEffectBand[12].lo.completedNetNew),
      high: Math.round(v.planEffectBand[12].hi.completedNetNew)
    });
  });

  it('keeps only the filled months, money from the view and no tiers without a baseline', () => {
    const v = cut(whole(), 10);
    const s = scoreOfView(v, null);
    expect(s.shown).toHaveLength(11);
    expect(s.band).toHaveLength(11);
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
