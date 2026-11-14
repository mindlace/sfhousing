import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  queriesOf,
  queryKey,
  type CustomBrush,
  type ZoningRule
} from '$lib/sim-page/policy';
import {
  DEFAULT_POLICY4,
  nothingInForce,
  queriesOf4,
  spanAt,
  type Policy,
  type SimPolicy4
} from './policy4';

const bandsA = [{ maxM: 402, stories: 6 }];
const bandsB = [
  { maxM: 402, stories: 8 },
  { maxM: 805, stories: 4 }
];
const brush: CustomBrush = {
  id: 'b1',
  kind: 'paint',
  strokes: [
    {
      path: [
        [-122.4, 37.7],
        [-122.41, 37.71]
      ],
      radiusM: 50
    }
  ],
  stories: 5
};
const rule = (bands: ZoningRule['bands']): ZoningRule => ({
  id: 'r1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands
});

const transit = (): Policy => ({
  id: 'r1',
  label: 'Transit',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [
    { from: 10, to: 99, what: { tag: 'bands', bands: bandsA } },
    { from: 100, to: null, what: { tag: 'bands', bands: bandsB } }
  ]
});
const painted = (): Policy => ({
  id: 'p1',
  label: 'Painted',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [{ from: 10, to: null, what: { tag: 'brushes', brushes: [brush] } }]
});
const doc = (zoning: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money: [] }
});

describe('queriesOf4', () => {
  it('lists the queries of every span, keyed by queryKey, without duplicates', () => {
    const got = queriesOf4(doc([transit(), painted()]));
    const old = queriesOf({
      ...DEFAULT_POLICY,
      rules: [rule(bandsA), rule(bandsB)],
      custom: [brush]
    });
    expect(new Set(got.map((q) => q.key))).toEqual(new Set(old.map((q) => q.key)));
    expect(new Set(got.map((q) => q.key)).size).toBe(got.length);
    for (const q of got) expect(q.key).toBe(queryKey(q.query));
  });
  it('lists off policies too', () => {
    const p = painted();
    p.on = false;
    expect(queriesOf4(doc([p]))).toHaveLength(1);
  });
});

describe('spanAt', () => {
  it('is null for an off policy', () => {
    const p = transit();
    p.on = false;
    expect(spanAt(p, 50)).toBeNull();
  });
  it('finds the covering span, open ends included', () => {
    const p = transit();
    expect(spanAt(p, 10)).toBe(p.spans[0]);
    expect(spanAt(p, 99)).toBe(p.spans[0]);
    expect(spanAt(p, 100)).toBe(p.spans[1]);
    expect(spanAt(p, 99999)).toBe(p.spans[1]);
    expect(spanAt(p, 9)).toBeNull();
  });
  it('is null between spans', () => {
    const p = transit();
    p.spans[0]!.to = 50;
    expect(spanAt(p, 70)).toBeNull();
  });
});

describe('nothingInForce', () => {
  it('holds for the default and for off or spanless policies', () => {
    expect(nothingInForce(DEFAULT_POLICY4)).toBe(true);
    const off = transit();
    off.on = false;
    const empty = painted();
    empty.spans = [];
    expect(nothingInForce(doc([off, empty]))).toBe(true);
  });
  it('fails once an on policy has a span', () => {
    expect(nothingInForce(doc([transit()]))).toBe(false);
  });
});
