import { describe, expect, it } from 'vitest';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { DEFAULT_POLICY, type SimPolicy, type TransitBand } from '$lib/sim-page/policy';
import { limitAlert } from '$lib/sim-page/funding-copy';
import { OBSERVED_TIMING, timingLabel, type TimingSet } from '$lib/sim-page/timing';
import { replaceRule } from '$lib/sim-page/transit-edit';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import type { Programme, TermKey } from '$lib/timelapse/types';
import {
  CUSTOM_TIMING_LABEL,
  PRESET_PER_POLICY,
  project,
  spanLens,
  termsInForce,
  tryWriteBack,
  writeBack
} from './lens';
import { parsePolicy4 } from './parse4';
import type { Effect, Policy, PolicyKind, SimPolicy4, Span } from './policy4';
import type { SpanRef } from './spans';

const asOf = 20000;
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
    // A fund span carries the market terms in force at its start, as context (the test below).
    expect(project(richDoc, ref('money', 'fund-u-pool-1', 1)).funding).toEqual({
      ...DEFAULT_POLICY.funding,
      pools: [{ ...pool, label: 'Later' }],
      programmes: [grant],
      terms: { guaranteeRateCut: 0.01 }
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

  it('a fund span projects the market terms in force at its start, and never writes them', () => {
    const withTerms = (terms: Policy): SimPolicy4 => ({
      ...richDoc,
      kinds: {
        ...richDoc.kinds,
        money: [...richDoc.kinds.money.filter((p) => p.where.tag !== 'terms'), terms]
      }
    });
    const cut = (doc: SimPolicy4, span: number) =>
      project(doc, ref('money', 'fund-u-pool-1', span)).funding.terms;
    const terms = (over: Partial<Policy>, spans?: Span[]) =>
      withTerms({
        ...pol('terms', { tag: 'terms' }, [{ tag: 'terms', terms: { guaranteeRateCut: 0.01 } }]),
        ...(spans ? { spans } : {}),
        ...over
      });
    // In force from month 1: both fund spans (months 1 and 13) see it.
    expect(cut(richDoc, 0)).toEqual({ guaranteeRateCut: 0.01 });
    expect(cut(richDoc, 1)).toEqual({ guaranteeRateCut: 0.01 });
    // Switched off: none.
    expect(cut(terms({ on: false }), 0)).toEqual({});
    // Ended before the second fund span starts: only the first sees it.
    const ended = terms({}, [
      { from: first(1), to: last(6), what: { tag: 'terms', terms: { guaranteeRateCut: 0.01 } } }
    ]);
    expect(cut(ended, 0)).toEqual({ guaranteeRateCut: 0.01 });
    expect(cut(ended, 1)).toEqual({});
    // The fund's editor changing them writes nothing: the terms policy is where terms are written.
    const r = ref('money', 'fund-u-pool-1');
    const q = project(richDoc, r);
    const edited = { ...q, funding: { ...q.funding, terms: { guaranteeRateCut: 0.03 } } };
    expect(writeBack(richDoc, r, edited)).toBe(richDoc);
  });

  it('the terms in force merge every terms policy that is on, in document order', () => {
    const t = (id: string, terms: Partial<Record<TermKey, number>>, over: Partial<Policy> = {}) =>
      pol(id, { tag: 'terms' }, [{ tag: 'terms', terms }], over);
    const doc: SimPolicy4 = {
      ...richDoc,
      kinds: {
        ...richDoc.kinds,
        money: [
          t('t1', { guaranteeRateCut: 0.01, requiredReturn: 0.2 }),
          t('t2', { guaranteeRateCut: 0.02 }),
          t('t3', { requiredReturn: 0.9 }, { on: false })
        ]
      }
    };
    expect(termsInForce(doc, first(1))).toEqual({ guaranteeRateCut: 0.02, requiredReturn: 0.2 });
    expect(termsInForce(doc, asOf)).toEqual({});
  });

  it('a timing change writes the set and the policy’s preset', () => {
    const r = ref('permitting', 'timing');
    const p = project(richDoc, r);
    const set = { ...p.timing.current, preset: 'benchmarkPermits' as const };
    const out = writeBack(richDoc, r, { ...p, timing: { current: set, saved: null } });
    expect(out.kinds.permitting[0].preset).toBe('benchmarkPermits');
    expect(out.kinds.permitting[0].spans[0].what).toEqual({ tag: 'timing', set });
    // A label the user typed stays.
    expect(out.kinds.permitting[0].label).toBe('timing');
  });

  it('an off transit policy projects as off; a rule written back turns it on', () => {
    const r = ref('zoning', 'r-off');
    const p = project(richDoc, r);
    expect(p.rules).toEqual([]);
    const on = writeBack(richDoc, r, {
      ...p,
      rules: [{ id: 'r-off', kind: 'transit', stopTypes: ['regionalRail'], bands: [b2] }]
    });
    const q = on.kinds.zoning.find((x) => x.id === 'r-off')!;
    expect(q.on).toBe(true);
    expect(q.spans[0].what).toEqual({ tag: 'bands', bands: [b2] });
  });
});

describe('timing presets and labels', () => {
  const observedSet = structuredClone(OBSERVED_TIMING.current);
  const setOf = (preset: 'observed' | 'benchmarkPermits' | 'noDiscretionary'): TimingSet => ({
    ...structuredClone(observedSet),
    preset
  });
  const timingDoc = (sets: TimingSet[], label: string): SimPolicy4 => ({
    schema: 4,
    kinds: {
      zoning: [],
      permitting: [
        pol(
          't',
          { tag: 'routes' },
          sets.map((set) => ({ tag: 'timing' as const, set })),
          { preset: sets[0].preset, label }
        )
      ],
      money: []
    }
  });
  const withSet = (doc: SimPolicy4, r: SpanRef, set: TimingSet) => {
    const p = project(doc, r);
    return tryWriteBack(doc, r, { ...p, timing: { current: set, saved: null } });
  };

  it('a preset change on a one-span policy relabels a label that was the old preset’s name', () => {
    const doc = timingDoc([setOf('benchmarkPermits')], timingLabel(setOf('benchmarkPermits')));
    const out = withSet(doc, ref('permitting', 't'), setOf('observed'));
    expect(out.refused).toBeNull();
    expect(out.doc.kinds.permitting[0].preset).toBe('observed');
    expect(out.doc.kinds.permitting[0].label).toBe(timingLabel(setOf('observed')));
    expect(() => parsePolicy4(structuredClone(out.doc), { asOf: null })).not.toThrow();
  });

  it('a custom edit relabels "Custom timing" to the set’s own label', () => {
    const doc = timingDoc([setOf('observed')], CUSTOM_TIMING_LABEL);
    const edited: TimingSet = {
      ...setOf('observed'),
      routeShares: { discretionary: 10, streamlined: 80, permitOnly: 10 }
    };
    const out = withSet(doc, ref('permitting', 't'), edited);
    expect(out.doc.kinds.permitting[0].label).toBe(timingLabel(edited));
  });

  it('a preset change in one span of a multi-span policy is refused; the document still parses', () => {
    const doc = timingDoc([setOf('benchmarkPermits'), setOf('benchmarkPermits')], 'x');
    expect(() => parsePolicy4(structuredClone(doc), { asOf: null })).not.toThrow();
    const out = withSet(doc, ref('permitting', 't', 1), setOf('noDiscretionary'));
    expect(out.doc).toBe(doc);
    expect(out.refused).toBe(PRESET_PER_POLICY);
    // A change that keeps the preset is fine.
    const same: TimingSet = {
      ...setOf('benchmarkPermits'),
      routeShares: { discretionary: 10, streamlined: 80, permitOnly: 10 }
    };
    const ok = withSet(doc, ref('permitting', 't', 1), same);
    expect(ok.refused).toBeNull();
    expect(ok.doc.kinds.permitting[0].spans[1].what).toEqual({ tag: 'timing', set: same });
    expect(() => parsePolicy4(structuredClone(ok.doc), { asOf: null })).not.toThrow();
  });
});

describe('programmes through the lens', () => {
  const prog = (id: string, poolId = pool.id): Programme => ({
    ...grant,
    id,
    label: id,
    pool: poolId
  });
  const fundDoc = (spans: number, others: Programme[] = []): SimPolicy4 => ({
    schema: 4,
    kinds: {
      zoning: [],
      permitting: [],
      money: [
        pol(
          'fund-u-pool-1',
          { tag: 'fund', pool: pool.id },
          Array.from({ length: spans }, () => ({
            tag: 'fund' as const,
            pool,
            programmes: [prog('u-prog-1')]
          }))
        ),
        ...(others.length > 0
          ? [
              pol('fund-state', { tag: 'fund', pool: 'state' }, [
                { tag: 'fund', pool: null, programmes: others }
              ])
            ]
          : [])
      ]
    }
  });
  const addProg = (doc: SimPolicy4, r: SpanRef, g: Programme) => {
    const p = project(doc, r);
    return tryWriteBack(doc, r, {
      ...p,
      funding: { ...p.funding, programmes: [...p.funding.programmes, g] }
    });
  };
  const fundSpans = (doc: SimPolicy4) =>
    doc.kinds.money[0].spans.map((s) => (s.what.tag === 'fund' ? s.what.programmes : null));

  it('a programme added in one span of a two-span fund lands in every span', () => {
    const doc = fundDoc(2);
    const out = addProg(doc, ref('money', 'fund-u-pool-1', 1), prog('u-prog-2'));
    expect(out.refused).toBeNull();
    const [a, b] = fundSpans(out.doc);
    expect(a!.map((g) => g.id)).toEqual(['u-prog-1', 'u-prog-2']);
    expect(b).toEqual(a);
    expect(() => parsePolicy4(structuredClone(out.doc), { asOf: null })).not.toThrow();
  });

  it('a programme removed in one span leaves every span', () => {
    const doc = fundDoc(2);
    const r = ref('money', 'fund-u-pool-1', 0);
    const p = project(doc, r);
    const out = tryWriteBack(doc, r, { ...p, funding: { ...p.funding, programmes: [] } });
    expect(fundSpans(out.doc)).toEqual([[], []]);
    expect(() => parsePolicy4(structuredClone(out.doc), { asOf: null })).not.toThrow();
  });

  it('a new programme whose id another policy holds is renamed', () => {
    const doc = fundDoc(1, [prog('u-prog-2', 'state')]);
    // Today's editor picks the id from the projection alone: u-prog-2 is free there.
    const out = addProg(doc, ref('money', 'fund-u-pool-1'), prog('u-prog-2'));
    const ids = fundSpans(out.doc)[0]!.map((g) => g.id);
    expect(ids).toEqual(['u-prog-1', 'u-prog-3']);
    expect(() => parsePolicy4(structuredClone(out.doc), { asOf: null })).not.toThrow();
  });

  it('an edit past the programme limit is refused and the document is unchanged', () => {
    const others = Array.from({ length: FINANCE_LIMITS.programmes - 1 }, (_, i) =>
      prog(`u-s-${i}`, 'state')
    );
    const doc = fundDoc(1, others);
    expect(() => parsePolicy4(structuredClone(doc), { asOf: null })).not.toThrow();
    const out = addProg(doc, ref('money', 'fund-u-pool-1'), prog('u-prog-9'));
    expect(out.doc).toBe(doc);
    expect(out.refused).toBe(limitAlert('programmes'));
  });

  it('the lens reports a refusal and leaves the store as it was', () => {
    const others = Array.from({ length: FINANCE_LIMITS.programmes - 1 }, (_, i) =>
      prog(`u-s-${i}`, 'state')
    );
    const doc = fundDoc(1, others);
    const store = new DocStore(doc);
    const lens = spanLens(store, () => ref('money', 'fund-u-pool-1'));
    const ok = lens.apply(
      (p) => ({
        ...p,
        funding: { ...p.funding, programmes: [...p.funding.programmes, prog('n')] }
      }),
      'Added'
    );
    expect(ok).toBe(false);
    expect(lens.refused).toBe(limitAlert('programmes'));
    expect(store.policy).toBe(doc);
    expect(store.labels).toEqual([]);
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

  it('policy is the same object while the document and the ref are unchanged', () => {
    const store = new DocStore(twoSpanDoc);
    let r: SpanRef = { kind: 'zoning', id: 'r1', span: 0 };
    const lens = spanLens(store, () => ({ ...r }));
    const a = lens.policy;
    expect(lens.policy).toBe(a);
    r = { kind: 'zoning', id: 'r1', span: 1 };
    const b = lens.policy;
    expect(b).not.toBe(a);
    expect(lens.policy).toBe(b);
    lens.apply((p) => replaceRule(p, { ...p.rules[0], bands: [b2] }), 'Edited');
    expect(lens.policy).not.toBe(b);
    expect(lens.refused).toBeNull();
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
