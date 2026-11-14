import { describe, expect, it } from 'vitest';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { monthFirstDay } from '$lib/sim/world/months';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Pool } from '$lib/timelapse/types';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import { addChoices, addPolicy, type AddChoice } from './add';
import { CUSTOM_TIMING_LABEL } from './lens';
import { parsePolicy4 } from './parse4';
import { DEFAULT_POLICY4, type PolicyKind, type SimPolicy4 } from './policy4';
import { reconcilePolicy4 } from './reconcile4';
import { policyOf, type TimelineWindow } from './spans';

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
