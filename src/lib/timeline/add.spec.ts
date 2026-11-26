import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_MEASURES, OPEN_LIMITS, within, type Limits } from '$lib/game/limits';
import { dateMeasure, fundingPresets } from '$lib/sim-page/funding-presets';
import { PRESETS } from '$lib/sim-page/timing';
import { limitsWith } from './test/limits';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { monthFirstDay } from '$lib/sim/world/months';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Pool } from '$lib/timelapse/types';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import { addChoices, addPolicy, fittedLayer, kindOpen, redateMoved, type AddChoice } from './add';
import { CUSTOM_TIMING_LABEL } from './lens';
import { parsePolicy4 } from './parse4';
import { DEFAULT_POLICY4, type Policy, type PolicyKind, type SimPolicy4 } from './policy4';
import { reconcilePolicy4 } from './reconcile4';
import { policyOf, type TimelineWindow } from './spans';

vi.mock('$lib/sim-page/funding-presets', async (orig) => ({
  ...(await orig<typeof import('$lib/sim-page/funding-presets')>()),
  dateMeasure: vi.fn((p: Policy) => p)
}));

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const calNoFunding: Calibration = { ...miniCal, market: undefined, baselineFunding: undefined };
const asOf = cal.asOf;
const w: TimelineWindow = { asOf, months: 480 };
const ctx = (month: number) => ({ w, month, cal });

const { id: _id, ...ownPool } = fundingOnly().pools[0];
const fundChoice: AddChoice = { kind: 'money', what: 'fund', pool: ownPool };

const KINDS: PolicyKind[] = ['zoning', 'permitting', 'money'];

/** Every policy, pool and programme id in the document, with repeats. */
function ids(doc: SimPolicy4): { policies: string[]; pools: string[]; programmes: string[] } {
  const all = KINDS.flatMap((k) => doc.kinds[k]);
  const pools: string[] = [];
  const programmes: string[] = [];
  for (const p of all) {
    // Every span of a policy names the same pool and programmes: count each policy once.
    const s = p.spans[0];
    if (s?.what.tag !== 'fund') continue;
    if (s.what.pool) pools.push(s.what.pool.id);
    programmes.push(...s.what.programmes.map((g) => g.id));
  }
  return { policies: all.map((p) => p.id), pools, programmes };
}

describe('addPolicy', () => {
  it('a new policy starts on the playhead month with no end and is returned selected', () => {
    const { doc, ref } = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'transit' }, ctx(61));
    const p = policyOf(doc, 'zoning', ref.id)!;
    expect(ref).toEqual({ kind: 'zoning', id: p.id, span: 0 });
    expect(p.spans).toHaveLength(1);
    expect(p.spans[0]).toMatchObject({ from: monthFirstDay(asOf, 61), to: null });
    expect(p.where).toEqual({ tag: 'transit', stopTypes: ['regionalRail', 'metro'] });
    expect(reconcilePolicy4(doc, cal, asOf).doc).toBe(doc);
  });

  it('every offer, and a new fund, gives a document that parses and is reconciled', () => {
    const choices = [
      ...KINDS.flatMap((k) => addChoices(k, cal, DEFAULT_POLICY4).map((c) => c.choice)),
      fundChoice
    ];
    expect(choices.length).toBeGreaterThan(8);
    for (const choice of choices) {
      if (choice.kind === 'money' && choice.what === 'ownPool') continue;
      const { doc, ref } = addPolicy(DEFAULT_POLICY4, choice as AddChoice, ctx(13));
      const p = policyOf(doc, ref.kind, ref.id);
      expect(p, JSON.stringify(choice)).toBeDefined();
      expect(ref.kind).toBe(choice.kind);
      for (const q of doc.kinds[choice.kind])
        for (const s of q.spans)
          expect(s).toMatchObject({ from: monthFirstDay(asOf, 13), to: null });
      expect(
        () => parsePolicy4(structuredClone(doc), { asOf }),
        JSON.stringify(choice)
      ).not.toThrow();
      expect(reconcilePolicy4(doc, cal, asOf).doc, JSON.stringify(choice)).toBe(doc);
    }
  });

  it('appends to the kind, leaving the policies already there as they were', () => {
    const one = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'paint' }, ctx(5)).doc;
    const two = addPolicy(one, { kind: 'zoning', what: 'transit' }, ctx(9)).doc;
    expect(two.kinds.zoning).toHaveLength(2);
    expect(two.kinds.zoning[0]).toBe(one.kinds.zoning[0]);
  });

  it('ids stay unique across the document when adding the same preset twice', () => {
    const preset = addChoices('money', cal, DEFAULT_POLICY4).find(
      (c) => c.choice.kind === 'money' && c.choice.what === 'preset'
    )!.choice as AddChoice;
    let doc = DEFAULT_POLICY4;
    for (let i = 0; i < 2; i++) doc = addPolicy(doc, preset, ctx(13)).doc;
    for (let i = 0; i < 2; i++) doc = addPolicy(doc, fundChoice, ctx(13)).doc;
    for (const what of ['paint', 'transit'] as const)
      for (let i = 0; i < 2; i++) doc = addPolicy(doc, { kind: 'zoning', what }, ctx(13)).doc;
    for (let i = 0; i < 2; i++)
      doc = addPolicy(doc, { kind: 'permitting', what: 'custom' }, ctx(13)).doc;
    const all = ids(doc);
    expect(all.pools.length).toBeGreaterThanOrEqual(3);
    for (const list of [all.policies, all.pools, all.programmes])
      expect(new Set(list).size).toBe(list.length);
    expect(() => parsePolicy4(structuredClone(doc), { asOf })).not.toThrow();
    expect(reconcilePolicy4(doc, cal, asOf).doc).toBe(doc);
  });

  it('a new fund keeps the pool it is given, debt terms included, under a fresh id', () => {
    const pool: Omit<Pool, 'id'> = {
      ...ownPool,
      kind: 'goBond',
      debt: { rate: 0.06, termYears: 20 }
    };
    const a = addPolicy(DEFAULT_POLICY4, { kind: 'money', what: 'fund', pool }, ctx(13));
    const b = addPolicy(a.doc, { kind: 'money', what: 'fund', pool }, ctx(13));
    const pa = policyOf(b.doc, 'money', a.ref.id)!;
    const pb = policyOf(b.doc, 'money', b.ref.id)!;
    expect(pa.where).toEqual({ tag: 'fund', pool: 'u-pool-1' });
    expect(pb.where).toEqual({ tag: 'fund', pool: 'u-pool-2' });
    expect(pb.spans[0].what).toEqual({
      tag: 'fund',
      pool: { ...pool, id: 'u-pool-2' },
      programmes: []
    });
    expect(pb.label).toBe(pool.label);
  });

  it('baseline and terms are empty policies the parser accepts', () => {
    for (const what of ['baseline', 'terms'] as const) {
      const { doc, ref } = addPolicy(DEFAULT_POLICY4, { kind: 'money', what }, ctx(2));
      const p = policyOf(doc, 'money', ref.id)!;
      expect(p.spans[0].what).toEqual(
        what === 'baseline' ? { tag: 'scales', entries: [] } : { tag: 'terms', terms: {} }
      );
      expect(parsePolicy4(structuredClone(doc), { asOf })).toEqual(doc);
    }
  });

  it('a permitting preset carries its resolved set and preset id', () => {
    const { doc, ref } = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'permitting', what: 'preset', preset: 'benchmarkPermits' },
      ctx(7)
    );
    const p = policyOf(doc, 'permitting', ref.id)!;
    expect(p.preset).toBe('benchmarkPermits');
    expect(p.spans[0].what).toMatchObject({ tag: 'timing', set: { preset: 'benchmarkPermits' } });
  });

  it('protections are on, newer-than at 30 years', () => {
    const { doc, ref } = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'zoning', what: 'protect', category: 'newerThan' },
      ctx(3)
    );
    const p = policyOf(doc, 'zoning', ref.id)!;
    expect(p.on).toBe(true);
    expect(p.where).toEqual({ tag: 'category', category: 'newerThan' });
    expect(p.spans[0].what).toEqual({ tag: 'protect', years: 30 });
  });

  it('clamps the start month into the window', () => {
    const lo = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'paint' }, ctx(0));
    const hi = addPolicy(DEFAULT_POLICY4, { kind: 'zoning', what: 'paint' }, ctx(9999));
    expect(lo.doc.kinds.zoning[0].spans[0].from).toBe(monthFirstDay(asOf, 1));
    expect(hi.doc.kinds.zoning[0].spans[0].from).toBe(monthFirstDay(asOf, 480));
  });
});

describe('addChoices', () => {
  it('offers money only with market and baseline funding', () => {
    expect(addChoices('money', calNoFunding, DEFAULT_POLICY4)).toEqual([]);
    expect(addChoices('money', { ...cal, market: undefined }, DEFAULT_POLICY4)).toEqual([]);
    const money = addChoices('money', cal, DEFAULT_POLICY4).map((c) => c.choice);
    expect(money).toContainEqual({ kind: 'money', what: 'ownPool' });
    expect(money).toContainEqual({ kind: 'money', what: 'baseline' });
    expect(money).toContainEqual({ kind: 'money', what: 'terms' });
    expect(money.some((c) => c.kind === 'money' && c.what === 'preset')).toBe(true);
  });

  it('zoning offers transit, paint and the protections not already in the document', () => {
    const all = addChoices('zoning', cal, DEFAULT_POLICY4).map((c) => c.choice);
    expect(all).toEqual([
      { kind: 'zoning', what: 'transit' },
      { kind: 'zoning', what: 'paint' },
      { kind: 'zoning', what: 'protect', category: 'rentControl' },
      { kind: 'zoning', what: 'protect', category: 'historic' },
      { kind: 'zoning', what: 'protect', category: 'newerThan' }
    ]);
    const doc = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'zoning', what: 'protect', category: 'historic' },
      ctx(3)
    ).doc;
    expect(addChoices('zoning', cal, doc).map((c) => c.choice)).not.toContainEqual({
      kind: 'zoning',
      what: 'protect',
      category: 'historic'
    });
  });

  it('permitting offers the available presets, then custom', () => {
    const list = addChoices('permitting', cal, DEFAULT_POLICY4);
    expect(list.at(-1)!.choice).toEqual({ kind: 'permitting', what: 'custom' });
    expect(list.every((c) => c.label.length > 0)).toBe(true);
    expect(list.map((c) => c.choice)).toContainEqual({
      kind: 'permitting',
      what: 'preset',
      preset: 'benchmarkPermits'
    });
    expect(list.map((c) => c.choice)).not.toContainEqual({
      kind: 'permitting',
      what: 'preset',
      preset: 'observed'
    });
  });
});

describe('addPolicy fixes', () => {
  it('custom timing starts from the observed set under the custom label', () => {
    const { doc, ref } = addPolicy(DEFAULT_POLICY4, { kind: 'permitting', what: 'custom' }, ctx(4));
    expect(policyOf(doc, 'permitting', ref.id)!.label).toBe(CUSTOM_TIMING_LABEL);
  });

  it('an own pool past the document’s pool limit throws RangeError, as a preset does', () => {
    let doc = DEFAULT_POLICY4;
    for (let i = 0; i < FINANCE_LIMITS.pools; i++) doc = addPolicy(doc, fundChoice, ctx(13)).doc;
    expect(() => parsePolicy4(structuredClone(doc), { asOf })).not.toThrow();
    expect(() => addPolicy(doc, fundChoice, ctx(13))).toThrow(RangeError);
  });
});

describe('addChoices under limits', () => {
  const early = limitsWith({ stops: new Set(['metro']), bands: 1, stories: 4, reachM: 402 });
  const P = PRESETS.find((p) => p.available && p.id !== 'observed')!.id;
  const presetName = (id: string) => PRESETS.find((p) => p.id === id)!.name;
  const M = fundingPresets(cal).find((p) => p.available)!.id;
  const fundingLabel = (id: string) => fundingPresets(cal).find((p) => p.id === id)!.label;
  const freeLabels = () =>
    fundingPresets(cal)
      .filter((p) => p.available && FREE_MEASURES.includes(p.id))
      .map((p) => p.label);
  const labels = (kind: PolicyKind, l: Limits = OPEN_LIMITS) =>
    addChoices(kind, cal, DEFAULT_POLICY4, l).map((c) => c.label);

  it('kindOpen', () => {
    for (const k of KINDS) expect(kindOpen(k, OPEN_LIMITS)).toBe(true);
    for (const k of KINDS) expect(kindOpen(k, limitsWith({}))).toBe(false);
    expect(kindOpen('zoning', early)).toBe(true);
    expect(kindOpen('permitting', limitsWith({ presets: new Set([P]) }))).toBe(true);
    expect(kindOpen('permitting', limitsWith({ custom: true }))).toBe(true);
    expect(kindOpen('money', limitsWith({ measures: new Set([M]) }))).toBe(true);
  });

  it('a closed kind offers nothing', () => {
    for (const k of KINDS) expect(labels(k, limitsWith({}))).toEqual([]);
  });

  it('under OPEN_LIMITS offers are today’s', () => {
    for (const kind of KINDS)
      expect(labels(kind, OPEN_LIMITS)).toEqual(
        addChoices(kind, cal, DEFAULT_POLICY4).map((c) => c.label)
      );
    expect(labels('zoning')).toContain('Painted area');
    expect(labels('money')).toContain('Your own pool');
  });

  it('zoning: a fitted transit rule and the protections, never a painted area', () => {
    expect(labels('zoning', early)).toEqual([
      'Transit rule',
      'Protect rent-controlled buildings',
      'Protect historic buildings',
      'Protect buildings newer than 30 years'
    ]);
    expect(labels('zoning', { ...early, bands: 0 })).not.toContain('Transit rule');
    expect(labels('zoning', { ...early, stories: 0 })).not.toContain('Transit rule');
    expect(labels('zoning', { ...early, reachM: 0 })).not.toContain('Transit rule');
    expect(labels('zoning', { ...early, bands: 0 })).toContain('Protect historic buildings');
    expect(labels('zoning', limitsWith({}))).toEqual([]);
  });

  it('permitting: bought presets, custom only while custom', () => {
    const l = limitsWith({ presets: new Set([P, 'observed']) });
    expect(labels('permitting', l)).toEqual([presetName(P)]);
    expect(labels('permitting', { ...l, custom: true })).toEqual([
      presetName(P),
      CUSTOM_TIMING_LABEL
    ]);
  });

  it('money: bought measures, then the two free ones; never own pool, scale or terms', () => {
    const got = labels('money', limitsWith({ measures: new Set([M]) }));
    expect(got[0]).toBe(fundingLabel(M));
    expect(got).toEqual(expect.arrayContaining(freeLabels()));
    expect(new Set(got).size).toBe(got.length);
    for (const no of ['Your own pool', 'City funding scale', 'Market terms'])
      expect(got).not.toContain(no);
  });

  it('fittedLayer fits the limits and the policy it adds runs', () => {
    const l = limitsWith({
      stops: new Set(['metro', 'regionalRail']),
      bands: 1,
      stories: 4,
      reachM: 402
    });
    const r = fittedLayer(l);
    expect(r).toMatchObject({
      kind: 'transit',
      stopTypes: ['regionalRail', 'metro'],
      bands: [{ maxM: 402, stories: 4 }]
    });
    const { doc, ref } = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'zoning', what: 'transit' },
      { w, month: 1, cal, limits: l }
    );
    expect(within('zoning', policyOf(doc, 'zoning', ref.id)!, l)).toBe(true);
  });
});

describe('given measures', () => {
  const spy = vi.mocked(dateMeasure);
  beforeEach(() => {
    spy.mockReset();
    spy.mockImplementation((p) => p);
  });
  const presets = fundingPresets(cal).filter((p) => p.available);
  const addedMoney = (choice: AddChoice, month = 13) =>
    addPolicy(DEFAULT_POLICY4, choice, ctx(month)).doc.kinds.money.slice(
      DEFAULT_POLICY4.kinds.money.length
    );
  const bond: AddChoice = { kind: 'money', what: 'preset', preset: 'housing-bond' };

  it('every policy a money preset makes carries the preset’s id and label', () => {
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) {
      const added = addedMoney({ kind: 'money', what: 'preset', preset: p.id });
      expect(added.length).toBeGreaterThan(0);
      for (const x of added)
        expect({ preset: x.preset, label: x.label }).toEqual({
          preset: p.id,
          label: p.label
        });
    }
    for (const c of [
      { kind: 'money', what: 'baseline' },
      { kind: 'money', what: 'terms' },
      fundChoice
    ] as AddChoice[])
      for (const x of addedMoney(c)) expect(x.preset).toBeNull();
  });

  it('addPolicy calls dateMeasure once per preset policy, after the spans are dated', () => {
    for (const p of presets) {
      spy.mockClear();
      const added = addedMoney({ kind: 'money', what: 'preset', preset: p.id }, 25);
      expect(spy.mock.calls.map((c) => c[0])).toEqual(added);
      for (const c of spy.mock.calls) {
        expect(c[0].spans[0].from).toBe(monthFirstDay(asOf, 25));
        expect(c[1]).toBe(cal);
      }
    }
    spy.mockClear();
    addPolicy(
      DEFAULT_POLICY4,
      { kind: 'permitting', what: 'preset', preset: 'benchmarkPermits' },
      ctx(3)
    );
    addPolicy(DEFAULT_POLICY4, { kind: 'money', what: 'baseline' }, ctx(3));
    expect(spy).not.toHaveBeenCalled();
  });

  describe('redateMoved', () => {
    const before = addPolicy(DEFAULT_POLICY4, bond, ctx(13)).doc;
    const own = addPolicy(before, fundChoice, ctx(13)).doc;
    const withMoney = (doc: SimPolicy4, money: Policy[]): SimPolicy4 => ({
      ...doc,
      kinds: { ...doc.kinds, money }
    });
    const moveFirst = (p: Policy, month: number): Policy => ({
      ...p,
      spans: [{ ...p.spans[0], from: monthFirstDay(asOf, month) }, ...p.spans.slice(1)]
    });

    it('a given measure whose first start moved is re-dated in place', () => {
      spy.mockClear();
      spy.mockImplementation((p) => ({ ...p, label: 'dated' }));
      const moved = moveFirst(before.kinds.money[0], 20);
      const after = withMoney(before, [moved, ...before.kinds.money.slice(1)]);
      const got = redateMoved(before, after, cal);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(moved);
      expect(spy.mock.calls[0][1]).toBe(cal);
      expect(got.kinds.money[0]).toEqual({ ...moved, label: 'dated' });
      expect(got.kinds.money.slice(1)).toEqual(before.kinds.money.slice(1));
    });

    it('a second span moved, an own pool moved, or a new policy: no call', () => {
      const p = before.kinds.money[0];
      const two: Policy = {
        ...p,
        spans: [
          { ...p.spans[0], to: monthFirstDay(asOf, 30) - 1 },
          { ...p.spans[0], from: monthFirstDay(asOf, 30) }
        ]
      };
      const b2 = withMoney(before, [two]);
      const a2 = withMoney(before, [
        { ...two, spans: [two.spans[0], { ...two.spans[1], from: monthFirstDay(asOf, 40) }] }
      ]);
      const ownIdx = own.kinds.money.findIndex((x) => x.preset === null);
      expect(ownIdx).toBeGreaterThanOrEqual(0);
      const ownMoved = withMoney(
        own,
        own.kinds.money.map((x, i) => (i === ownIdx ? moveFirst(x, 30) : x))
      );
      spy.mockClear();
      redateMoved(b2, a2, cal);
      redateMoved(own, ownMoved, cal);
      redateMoved(DEFAULT_POLICY4, before, cal);
      expect(spy).not.toHaveBeenCalled();
    });

    it('nothing moved returns after itself', () => {
      const after = withMoney(before, [...before.kinds.money]);
      expect(redateMoved(before, after, cal)).toBe(after);
      const moved = withMoney(before, [moveFirst(before.kinds.money[0], 20)]);
      expect(redateMoved(before, moved, cal)).toBe(moved);
    });
  });
});
