import { describe, expect, it } from 'vitest';
import { FIXTURE_AS_OF, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import {
  DEFAULT_POLICY,
  isDefaultPolicy,
  parseSimPolicy,
  type CustomBrush,
  type SimPolicy
} from '$lib/sim-page/policy';
import { OBSERVED_TIMING, timingLabel, type TimingSet } from '$lib/sim-page/timing';
import { monthFirstDay } from '$lib/sim/world/months';
import { parsePolicy4 } from './parse4';
import { DEFAULT_POLICY4, nothingInForce, type Policy } from './policy4';
import { upgradePolicy } from './upgrade';

const AS_OF = FIXTURE_AS_OF;
const stroke = { path: [[-122.4, 37.7] as [number, number]], radiusM: 50 };
const bands = [{ maxM: 402, stories: 6 }];
const rule = (id: string) => ({
  id,
  kind: 'transit' as const,
  stopTypes: ['metro' as const],
  bands
});
const brushes: CustomBrush[] = [
  { id: 'b1', kind: 'paint', strokes: [stroke], stories: 5 },
  { id: 'b2', kind: 'erase', strokes: [stroke] },
  { id: 'b3', kind: 'paint', strokes: [stroke], stories: 7 }
];
const BENCH: TimingSet = {
  preset: 'benchmarkPermits',
  presetTimers: [{ pathway: 'discretionary', stage: 'permitFiled', scale: 0.4786, reach: 'all' }],
  presetRouteShares: null,
  edits: [],
  routeShares: null,
  localProgramStreamlined: true
};
const NO_DISC: TimingSet = {
  ...structuredClone(OBSERVED_TIMING.current),
  preset: 'noDiscretionary',
  presetRouteShares: { discretionary: 0, streamlined: 67, permitOnly: 33 }
};
const base = (over: Partial<SimPolicy> = {}): SimPolicy => ({
  ...structuredClone(DEFAULT_POLICY),
  ...over
});
const up = (p: SimPolicy) => upgradePolicy(p, AS_OF);
const all = (d: ReturnType<typeof up>): Policy[] => Object.values(d.kinds).flat();

function fundingPolicy(): SimPolicy {
  const f = fundingOnly();
  f.programmes.push({ ...structuredClone(f.programmes[0]), id: 'u-prog-2', pool: 'state' });
  f.terms = { constructionRate: 0.07 };
  return base({ funding: f });
}

const CASES: Record<string, SimPolicy> = {
  default: base(),
  rules: base({ rules: [rule('r1'), rule('r2')] }),
  paint: base({ custom: brushes }),
  protect: base({ protect: { rentControl: true, historic: false, newerThanYears: 30 } }),
  timing: base({ timing: { current: BENCH, saved: null } }),
  saved: base({ timing: { current: BENCH, saved: { label: 'Mine', set: NO_DISC } } }),
  savedOnly: base({
    timing: {
      current: structuredClone(OBSERVED_TIMING.current),
      saved: { label: 'Mine', set: NO_DISC }
    }
  }),
  funding: fundingPolicy(),
  collision: base({ rules: [rule('painted'), rule('painted-2')], custom: brushes })
};

describe('upgradePolicy', () => {
  it('the span starts the day after the dataset date', () => {
    expect(monthFirstDay(AS_OF, 1)).toBe(AS_OF + 1);
  });

  it('the default policy upgrades to the default document', () => {
    expect(up(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY4);
  });

  it.each(Object.keys(CASES))('%s: one open span each, parses back, same as input', (name) => {
    const doc = up(CASES[name]);
    for (const p of all(doc)) {
      expect(p.spans.map((s) => [s.from, s.to])).toEqual([[AS_OF + 1, null]]);
    }
    expect(parsePolicy4(doc, { asOf: AS_OF })).toEqual(doc);
    expect(parsePolicy4(JSON.parse(JSON.stringify(doc)), { asOf: AS_OF })).toEqual(doc);
  });

  it.each(Object.keys(CASES))('%s: default policy iff nothing in force', (name) => {
    expect(isDefaultPolicy(CASES[name])).toBe(nothingInForce(up(CASES[name])));
  });

  it('two rules give two transit policies in order, with the rule ids', () => {
    const z = up(CASES.rules).kinds.zoning;
    expect(z.map((p) => [p.id, p.where.tag, p.label])).toEqual([
      ['r1', 'transit', 'Transit rule'],
      ['r2', 'transit', 'Transit rule']
    ]);
  });

  it('custom paint, erase, paint is one painted policy holding the brushes in order', () => {
    const z = up(CASES.paint).kinds.zoning;
    expect(z).toHaveLength(1);
    expect(z[0].where).toEqual({ tag: 'painted' });
    expect(z[0].spans[0].what).toEqual({ tag: 'brushes', brushes });
    expect(up(base()).kinds.zoning).toEqual([]);
  });

  it('protections become category policies, none for historic', () => {
    const z = up(CASES.protect).kinds.zoning;
    expect(z.map((p) => [p.id, p.where, p.spans[0].what])).toEqual([
      [
        'protect-rentControl',
        { tag: 'category', category: 'rentControl' },
        { tag: 'protect', years: null }
      ],
      [
        'protect-newerThan',
        { tag: 'category', category: 'newerThan' },
        { tag: 'protect', years: 30 }
      ]
    ]);
    expect(z[1].label).toBe('Protect buildings newer than 30 years');
  });

  it('timing: a current set, then a saved one that is off', () => {
    const m = up(CASES.saved).kinds.permitting;
    expect(m.map((p) => [p.id, p.on, p.preset, p.label])).toEqual([
      ['timing', true, 'benchmarkPermits', timingLabel(BENCH)],
      ['timing-saved', false, 'noDiscretionary', 'Mine']
    ]);
    expect(up(CASES.timing).kinds.permitting).toHaveLength(1);
  });

  it('observed current timing makes no policy; a saved set alone is off', () => {
    expect(up(base()).kinds.permitting).toEqual([]);
    const m = up(CASES.savedOnly).kinds.permitting;
    expect(m.map((p) => [p.id, p.on])).toEqual([['timing-saved', false]]);
  });

  it('funding: baseline scale, added pool, baseline-pool programmes, terms', () => {
    const p = CASES.funding;
    const m = up(p).kinds.money;
    expect(m.map((x) => x.id)).toEqual(['baseline', 'fund-u-pool-1', 'fund-state', 'terms']);
    expect(m.every((x) => x.preset === null)).toBe(true);
    expect(m[0].spans[0].what).toEqual({ tag: 'scales', entries: p.funding.baselineScale });
    expect(m[1].where).toEqual({ tag: 'fund', pool: 'u-pool-1' });
    expect(m[1].spans[0].what).toEqual({
      tag: 'fund',
      pool: p.funding.pools[0],
      programmes: [p.funding.programmes[0]]
    });
    expect(m[1].label).toBe('Added pool');
    expect(m[2].where).toEqual({ tag: 'fund', pool: 'state' });
    expect(m[2].spans[0].what).toEqual({
      tag: 'fund',
      pool: null,
      programmes: [p.funding.programmes[1]]
    });
    expect(m[2].label).toBe('Programmes on state');
    expect(m[3].spans[0].what).toEqual({ tag: 'terms', terms: { constructionRate: 0.07 } });
  });

  it('empty funding parts make no policies', () => {
    expect(up(base()).kinds.money).toEqual([]);
  });

  it('ids stay unique when a rule id equals a fixed id', () => {
    const ids = up(CASES.collision).kinds.zoning.map((p) => p.id);
    expect(ids).toEqual(['painted', 'painted-2', 'painted-3']);
  });

  it('what is cloned, not shared', () => {
    const p = CASES.paint;
    const what = up(p).kinds.zoning[0].spans[0].what;
    if (what.tag !== 'brushes') throw new Error('expected brushes');
    what.brushes.pop();
    expect(p.custom).toHaveLength(3);
  });

  it('a schema 2 document opened as schema 3 has no money policies', () => {
    const v2: Record<string, unknown> = {
      ...structuredClone(DEFAULT_POLICY),
      schema: 2,
      rules: [rule('r1')]
    };
    delete v2.funding;
    const doc = up(parseSimPolicy(v2, { schema2: 'upgrade' }));
    expect(doc.kinds.money).toEqual([]);
    expect(doc.kinds.zoning).toHaveLength(1);
  });
});
