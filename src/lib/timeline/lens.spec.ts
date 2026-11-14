import { describe, expect, it } from 'vitest';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { DEFAULT_POLICY, type SimPolicy, type TransitBand } from '$lib/sim-page/policy';
import { OBSERVED_TIMING } from '$lib/sim-page/timing';
import { replaceRule } from '$lib/sim-page/transit-edit';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { project, spanLens, writeBack } from './lens';
import type { Effect, Policy, PolicyKind, SimPolicy4 } from './policy4';
import type { SpanRef } from './spans';

const asOf = 100;
const first = (m: number) => monthFirstDay(asOf, m);
const last = (m: number) => monthLastDay(asOf, m);

const F = fundingOnly();
const pool = F.pools[0];
const grant = F.programmes[0];
const b1: TransitBand = { maxM: 402, stories: 8 };
const b2: TransitBand = { maxM: 300, stories: 5 };

const pol = (
  id: string,
  where: Policy['where'],
  whats: Effect[],
  over: Partial<Policy> = {}
): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans: whats.map((what, i) => ({
    from: first(1 + 12 * i),
    to: i === whats.length - 1 ? null : last(12 * (i + 1)),
    what
  })),
  ...over
});

const richDoc: SimPolicy4 = {
  schema: 4,
  kinds: {
    zoning: [
      pol('r1', { tag: 'transit', stopTypes: ['metro'] }, [
        { tag: 'bands', bands: [b1] },
        { tag: 'bands', bands: [b2] }
      ]),
      pol(
        'r-off',
        { tag: 'transit', stopTypes: ['regionalRail'] },
        [{ tag: 'bands', bands: [b1] }],
        {
          on: false
        }
      ),
      pol('painted', { tag: 'painted' }, [
        {
          tag: 'brushes',
          brushes: [
            {
              id: 'b',
              kind: 'paint',
              strokes: [{ path: [[-122.4, 37.77]], radiusM: 50 }],
              stories: 6
            }
          ]
        }
      ]),
      pol('rc', { tag: 'category', category: 'rentControl' }, [{ tag: 'protect', years: null }], {
        on: false
      }),
      pol('nt', { tag: 'category', category: 'newerThan' }, [
        { tag: 'protect', years: 30 },
        { tag: 'protect', years: 10 }
      ])
    ],
    permitting: [
      pol(
        'timing',
        { tag: 'routes' },
        [
          {
            tag: 'timing',
            set: { ...structuredClone(OBSERVED_TIMING.current), preset: 'observed' }
          }
        ],
        { preset: 'observed' }
      )
    ],
    money: [
      pol('baseline', { tag: 'baseline' }, [
        { tag: 'scales', entries: [{ pool: 'state', from: asOf + 400, scale: 2 }] }
      ]),
      pol('fund-u-pool-1', { tag: 'fund', pool: pool.id }, [
        { tag: 'fund', pool, programmes: [grant] },
        { tag: 'fund', pool: { ...pool, label: 'Later' }, programmes: [grant] }
      ]),
      pol('fund-state', { tag: 'fund', pool: 'state' }, [
        { tag: 'fund', pool: null, programmes: [{ ...grant, id: 'g-state', pool: 'state' }] }
      ]),
      pol('terms', { tag: 'terms' }, [{ tag: 'terms', terms: { guaranteeRateCut: 0.01 } }])
    ]
  }
};

function everyRef(doc: SimPolicy4): SpanRef[] {
  return (['zoning', 'permitting', 'money'] as PolicyKind[]).flatMap((kind) =>
    doc.kinds[kind].flatMap((p) => p.spans.map((_, span) => ({ kind, id: p.id, span })))
  );
}

/** A minimal undoable store of a schema 4 document (Task 6 makes PolicyStore generic). */
class DocStore {
  policy: SimPolicy4;
  private past: { doc: SimPolicy4; label: string }[] = [];
  private future: { doc: SimPolicy4; label: string }[] = [];
  readonly labels: string[] = [];
  constructor(doc: SimPolicy4) {
    this.policy = doc;
  }
  apply(c: (p: SimPolicy4) => SimPolicy4, label: string): void {
    const next = c(this.policy);
    if (next === this.policy) return;
    this.past.push({ doc: this.policy, label });
    this.future = [];
    this.labels.push(label);
    this.policy = next;
  }
  undo(): string | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ doc: this.policy, label: e.label });
    this.policy = e.doc;
    return e.label;
  }
  redo(): string | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ doc: this.policy, label: e.label });
    this.policy = e.doc;
    return e.label;
  }
}

const ref = (kind: PolicyKind, id: string, span = 0): SpanRef => ({ kind, id, span });

describe('project and writeBack', () => {
  it('project then writeBack of an unchanged projection is the same document', () => {
    const refs = everyRef(richDoc);
    expect(refs).toHaveLength(13);
    for (const r of refs) {
      expect(writeBack(richDoc, r, project(richDoc, r)), JSON.stringify(r)).toEqual(richDoc);
      expect(writeBack(richDoc, r, project(richDoc, r)), JSON.stringify(r)).toBe(richDoc);
    }
  });

  it('projects only the span’s effect onto the default policy', () => {
    const p = project(richDoc, ref('zoning', 'r1', 1));
    expect(p).toEqual({
      ...DEFAULT_POLICY,
      rules: [{ id: 'r1', kind: 'transit', stopTypes: ['metro'], bands: [b2] }]
    });
    expect(project(richDoc, ref('zoning', 'nt', 1)).protect).toEqual({
      rentControl: false,
      historic: false,
      newerThanYears: 10
    });
    expect(project(richDoc, ref('money', 'fund-u-pool-1', 1)).funding).toEqual({
      ...DEFAULT_POLICY.funding,
      pools: [{ ...pool, label: 'Later' }],
      programmes: [grant]
    });
    expect(project(richDoc, ref('money', 'fund-state')).funding.pools).toEqual([]);
    expect(project(richDoc, ref('money', 'terms')).funding.terms).toEqual({
      guaranteeRateCut: 0.01
    });
    expect(project(richDoc, ref('money', 'baseline')).funding.baselineScale).toEqual([
      { pool: 'state', from: asOf + 400, scale: 2 }
    ]);
  });

  it('an off protection projects as off; switching it on turns the policy on', () => {
    const r = ref('zoning', 'rc');
    const p = project(richDoc, r);
    expect(p.protect.rentControl).toBe(false);
    const on = writeBack(richDoc, r, { ...p, protect: { ...p.protect, rentControl: true } });
    expect(on.kinds.zoning.find((x) => x.id === 'rc')!.on).toBe(true);
  });

  it('switching newer-than off turns the policy off and keeps its years', () => {
    const r = ref('zoning', 'nt', 1);
    const p = project(richDoc, r);
    const off = writeBack(richDoc, r, { ...p, protect: { ...p.protect, newerThanYears: null } });
    const nt = off.kinds.zoning.find((x) => x.id === 'nt')!;
    expect(nt.on).toBe(false);
    expect(nt.spans).toEqual(richDoc.kinds.zoning[4].spans);
    const years = writeBack(richDoc, r, { ...p, protect: { ...p.protect, newerThanYears: 15 } });
    expect(years.kinds.zoning[4].spans[1].what).toEqual({ tag: 'protect', years: 15 });
    expect(years.kinds.zoning[4].spans[0]).toBe(richDoc.kinds.zoning[4].spans[0]);
  });

  it('a transit projection with no rule turns the policy off; stop types write to the selector', () => {
    const r = ref('zoning', 'r1', 0);
    const p = project(richDoc, r);
    const off = writeBack(richDoc, r, { ...p, rules: [] });
    expect(off.kinds.zoning[0].on).toBe(false);
    expect(off.kinds.zoning[0].spans).toBe(richDoc.kinds.zoning[0].spans);
    const stops = writeBack(richDoc, r, {
      ...p,
      rules: [{ ...p.rules[0], stopTypes: ['metro', 'rapidBus'] }]
    });
    expect(stops.kinds.zoning[0].where).toEqual({
      tag: 'transit',
      stopTypes: ['metro', 'rapidBus']
    });
  });

  it('writeBack on a fund span ignores a changed pool.debt and keeps amount, kind and label edits', () => {
    const debtPool = { ...pool, kind: 'goBond' as const, debt: { rate: 0.06, termYears: 20 } };
    const doc: SimPolicy4 = {
      ...richDoc,
      kinds: {
        ...richDoc.kinds,
        money: [
          pol('fund-u-pool-1', { tag: 'fund', pool: pool.id }, [
            { tag: 'fund', pool: debtPool, programmes: [grant] }
          ])
        ]
      }
    };
    const r = ref('money', 'fund-u-pool-1');
    const p = project(doc, r);
    const edited = {
      ...debtPool,
      kind: 'cop' as const,
      label: 'Renamed',
      inflows: [{ kind: 'once' as const, day: asOf + 500, dollars: 5_000_000 }],
      debt: { rate: 0.09, termYears: 30 }
    };
    const out = writeBack(doc, r, {
      ...p,
      funding: { ...p.funding, pools: [edited], programmes: [] }
    });
    expect(out.kinds.money[0].spans[0].what).toEqual({
      tag: 'fund',
      pool: { ...edited, debt: { rate: 0.06, termYears: 20 } },
      programmes: []
    });
  });

  it('a timing change writes the set and the policy’s preset', () => {
    const r = ref('permitting', 'timing');
    const p = project(richDoc, r);
    const set = { ...p.timing.current, preset: 'benchmarkPermits' as const };
    const out = writeBack(richDoc, r, { ...p, timing: { current: set, saved: null } });
    expect(out.kinds.permitting[0].preset).toBe('benchmarkPermits');
    expect(out.kinds.permitting[0].spans[0].what).toEqual({ tag: 'timing', set });
  });

  it('a missing ref projects the default policy and writes nothing', () => {
    const r = ref('zoning', 'nope');
    expect(project(richDoc, r)).toBe(DEFAULT_POLICY);
    expect(writeBack(richDoc, r, { ...DEFAULT_POLICY, rules: [] })).toBe(richDoc);
    expect(project(richDoc, ref('zoning', 'r1', 9))).toBe(DEFAULT_POLICY);
  });
});

describe('spanLens', () => {
  const twoSpanDoc: SimPolicy4 = {
    schema: 4,
    kinds: {
      zoning: [
        pol('r1', { tag: 'transit', stopTypes: ['metro'] }, [
          { tag: 'bands', bands: [b1] },
          { tag: 'bands', bands: [b1] }
        ])
      ],
      permitting: [],
      money: []
    }
  };

  it('an editor change through the lens lands in that span only', () => {
    const store = new DocStore(twoSpanDoc);
    const lens = spanLens(store, () => ({ kind: 'zoning', id: 'r1', span: 1 }));
    lens.apply((p: SimPolicy) => replaceRule(p, { ...p.rules[0], bands: [b2] }), 'Edited');
    expect(store.policy.kinds.zoning[0].spans[0]).toEqual(twoSpanDoc.kinds.zoning[0].spans[0]);
    expect(store.policy.kinds.zoning[0].spans[1].what).toEqual({ tag: 'bands', bands: [b2] });
    expect(lens.policy.rules[0].bands).toEqual([b2]);
    expect(store.labels).toEqual(['Edited']);
  });

  it('undo and redo go to the document store', () => {
    const store = new DocStore(twoSpanDoc);
    const lens = spanLens(store, () => ({ kind: 'zoning', id: 'r1', span: 0 }));
    lens.apply((p) => replaceRule(p, { ...p.rules[0], bands: [b2] }), 'Edited');
    expect(lens.undo()).toBe('Edited');
    expect(store.policy).toBe(twoSpanDoc);
    expect(lens.redo()).toBe('Edited');
    expect(lens.policy.rules[0].bands).toEqual([b2]);
  });

  it('with no selection the policy is the default and apply does nothing', () => {
    const store = new DocStore(twoSpanDoc);
    const lens = spanLens(store, () => null);
    expect(lens.policy).toBe(DEFAULT_POLICY);
    lens.apply((p) => ({ ...p, rules: [] }), 'Nothing');
    expect(store.policy).toBe(twoSpanDoc);
    expect(store.labels).toEqual([]);
  });
});
