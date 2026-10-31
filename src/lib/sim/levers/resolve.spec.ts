import { describe, expect, it } from 'vitest';
import { NULL_CAP } from '$lib/data/policy-codec';
import type { EnvelopeRow } from '$lib/data/envelope-row';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { MINI_HISTORIC_ID, MINI_SB79_ID, miniPolicy } from '../scenario/fixtures/mini-policy';
import { dayOf } from '../scenario/dates';
import { stockTable, type EnvelopeTable, type LayerCtx } from './layers';
import {
  allNeeds,
  fillNeeds,
  leverCapacity,
  needKey,
  netCapacity,
  protectedRows,
  resolveEnvelopes
} from './resolve';
import { DEFAULT_LEVERS, type SimLevers, type StoryEdit } from './types';

const F = 5;
const FZP_LOT = '2999A001'; // 4 stories, uncapped, 1 home
const ASOF = dayOf(2025, 6, 1);

function ctx(): LayerCtx {
  const city = miniCity();
  return { parcels: city.parcels, policy: miniPolicy(city) };
}
const L = (patch: Partial<SimLevers> = {}): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  ...patch
});
const e = (lots: string[], stories: number): StoryEdit => ({ lots, stories });
const protectLots = (lots: string[]) => ({ ...DEFAULT_LEVERS.protect, lots });
function row(t: EnvelopeTable, i: number) {
  return {
    stories: t.stories[i],
    cap: t.cap[i],
    yield: Array.from(t.yield.subarray(i * F, i * F + F)),
    hostable: t.hostable[i]
  };
}
const at = (c: LayerCtx, id: string) => c.parcels.index.get(id)!;

/** The first mini-city row with an FZP yield cap that hosts. */
const CAPPED = (() => {
  const c = ctx();
  for (let i = 0; i < c.parcels.count; i++)
    if (c.policy.fzpYieldCap[i] !== NULL_CAP && c.parcels.hostable[i] === 1) return i;
  throw new Error('the mini city has no capped hostable row');
})();

describe('rules and paint', () => {
  it('with no edits the plan is the FZP table row for row', () => {
    const c = ctx();
    const r = resolveEnvelopes(c, L(), ASOF);
    const fzp = stockTable(c, 'fzp');
    for (let i = 0; i < c.parcels.count; i++) expect(row(r.plan.table, i)).toEqual(row(fzp, i));
    expect(allNeeds(r)).toEqual([]);
  });

  it('a rule above FZP raises the lot uncapped', () => {
    const c = ctx();
    const id = c.parcels.id[CAPPED];
    const s = stockTable(c, 'fzp').stories[CAPPED];
    const r = resolveEnvelopes(c, L({ rules: [e([id], s + 3)] }), ASOF);
    expect(r.plan.table.stories[CAPPED]).toBe(s + 3);
    expect(r.plan.table.cap[CAPPED]).toBe(NULL_CAP);
    expect(r.plan.needs).toEqual([{ row: CAPPED, stories: s + 3, cap: null }]);
  });

  it('a rule at or below FZP leaves the FZP row, cap included', () => {
    const c = ctx();
    const id = c.parcels.id[CAPPED];
    const s = stockTable(c, 'fzp').stories[CAPPED];
    for (const n of [s, s - 1]) {
      const r = resolveEnvelopes(c, L({ rules: [e([id], n)] }), ASOF);
      expect(row(r.plan.table, CAPPED)).toEqual(row(stockTable(c, 'fzp'), CAPPED));
      expect(r.plan.needs).toEqual([]);
    }
  });

  it('rules: the highest applicable wins, in any order', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    for (const rules of [
      [e([FZP_LOT], 6), e([FZP_LOT], 9)],
      [e([FZP_LOT], 9), e([FZP_LOT], 6)]
    ])
      expect(resolveEnvelopes(c, L({ rules }), ASOF).plan.table.stories[i]).toBe(9);
  });

  it('paint sets N after the rules, can lower, and a later stroke wins', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    const one = resolveEnvelopes(
      c,
      L({ rules: [e([FZP_LOT], 9)], paint: [e([FZP_LOT], 2)] }),
      ASOF
    );
    expect(one.plan.table.stories[i]).toBe(2);
    expect(one.plan.table.cap[i]).toBe(NULL_CAP);
    const two = resolveEnvelopes(c, L({ paint: [e([FZP_LOT], 5), e([FZP_LOT], 7)] }), ASOF);
    expect(two.plan.table.stories[i]).toBe(7);
  });

  it('paint to 0 stories hosts nothing and needs nothing', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    const r = resolveEnvelopes(c, L({ paint: [e([FZP_LOT], 0)] }), ASOF);
    expect(row(r.plan.table, i)).toMatchObject({
      stories: 0,
      yield: [0, 0, 0, 0, 0],
      hostable: 0
    });
    expect(r.plan.needs).toEqual([]);
  });

  it('a protected lot keeps its FZP row, not hostable, whatever rules and paint say', () => {
    const c = ctx();
    const i = at(c, MINI_HISTORIC_ID);
    const r = resolveEnvelopes(
      c,
      L({
        rules: [e([MINI_HISTORIC_ID], 20)],
        paint: [e([MINI_HISTORIC_ID], 30)],
        protect: { ...DEFAULT_LEVERS.protect, historic: true }
      }),
      ASOF
    );
    const fzp = row(stockTable(c, 'fzp'), i);
    expect(row(r.plan.table, i)).toEqual({ ...fzp, hostable: 0 });
    expect(r.unprotected.table.stories[i]).toBe(30);
  });

  it('unknown ids are counted once across rules, paint and protect.lots', () => {
    const r = resolveEnvelopes(
      ctx(),
      L({ rules: [e(['nope', 'gone'], 5)], paint: [e(['nope'], 5)] }),
      ASOF
    );
    expect(r.unknownLots).toBe(2);
    const shared = resolveEnvelopes(
      ctx(),
      L({ rules: [e(['nope'], 5)], protect: protectLots(['nope', 'missing']) }),
      ASOF
    );
    expect(shared.unknownLots).toBe(2);
  });

  it('unprotected is the plan itself when no row is protected', () => {
    const r = resolveEnvelopes(ctx(), L({ rules: [e([FZP_LOT], 9)] }), ASOF);
    expect(r.unprotected).toBe(r.plan);
  });

  it('does not write into the shared stock tables', () => {
    const c = ctx();
    const stories = Array.from(stockTable(c, 'fzp').stories);
    const cap = Array.from(stockTable(c, 'fzp').cap);
    resolveEnvelopes(
      c,
      L({
        rules: [e([c.parcels.id[CAPPED]], 40)],
        paint: [e([FZP_LOT], 0)],
        protect: protectLots([MINI_SB79_ID])
      }),
      ASOF
    );
    expect(Array.from(stockTable(c, 'fzp').stories)).toEqual(stories);
    expect(Array.from(stockTable(c, 'fzp').cap)).toEqual(cap);
  });
});

describe('protections', () => {
  it('a protected lot is not hostable after a raise', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    const fzp = stockTable(c, 'fzp');
    for (const patch of [{ rules: [e([FZP_LOT], 8)] }, { paint: [e([FZP_LOT], 0)] }]) {
      const r = resolveEnvelopes(c, L({ ...patch, protect: protectLots([FZP_LOT]) }), ASOF);
      expect(row(r.plan.table, i)).toEqual({ ...row(fzp, i), hostable: 0 });
      expect(Array.from(r.protectedRows)).toEqual([i]);
      // The protected view makes no Need; the unprotected view may (a raise to 8 does).
      expect(r.plan.needs).toEqual([]);
      expect(allNeeds(r).map(needKey)).toEqual(r.unprotected.needs.map(needKey));
    }
    const lowered = resolveEnvelopes(
      c,
      L({ paint: [e([FZP_LOT], 0)], protect: protectLots([FZP_LOT]) }),
      ASOF
    );
    const cap = leverCapacity(lowered, c.parcels);
    expect(cap.withoutProtections - cap.plan).toBe(0); // lowered to 0: nothing either way
  });

  it('categories: historic, rent control, newer-than', () => {
    const c = ctx();
    const none = DEFAULT_LEVERS.protect;
    const rows = (p: Partial<typeof none>) =>
      Array.from(protectedRows(c, { ...none, ...p }, ASOF).rows);
    expect(rows({ historic: true })).toContain(at(c, MINI_HISTORIC_ID));
    expect(rows({ rentControl: true })).toEqual(
      [...c.parcels.rentControlLikely].flatMap((v, i) => (v ? [i] : []))
    );
    const newer = rows({ newerThanYears: 60 }); // built 1965 or later
    expect(newer).toContain(at(c, '3512004'));
    expect(newer).not.toContain(at(c, '3600005')); // 1958
    expect(newer).not.toContain(at(c, '3600003')); // yearBuilt 0 = unknown
  });

  it('unknown and duplicate lots', () => {
    const c = ctx();
    const lots = ['nope', FZP_LOT, FZP_LOT];
    const p = protectedRows(c, protectLots(lots), ASOF);
    expect(p.unknown).toBe(1);
    expect(Array.from(p.rows)).toEqual([at(c, FZP_LOT)]);
    const r = resolveEnvelopes(c, L({ protect: protectLots(lots) }), ASOF);
    expect(r.unknownLots).toBe(1);
  });

  it('withoutProtections minus plan is the sum over protected rows', () => {
    const c = ctx();
    const resolved = resolveEnvelopes(
      c,
      L({
        rules: [e([MINI_SB79_ID], 8)],
        paint: [e([FZP_LOT], 0)],
        protect: protectLots([FZP_LOT, MINI_SB79_ID])
      }),
      ASOF
    );
    // The raise is a Need of the unprotected view only.
    expect(resolved.plan.needs).toEqual([]);
    const r = fillNeeds(
      resolved,
      new Map<string, EnvelopeRow>(
        allNeeds(resolved).map((n) => [
          needKey(n),
          { stories: n.stories, cap: n.cap, yield: [0, 20, 40, 60, 80], hostable: true }
        ])
      )
    );
    const cap = leverCapacity(r, c.parcels);
    let sum = 0;
    for (const i of r.protectedRows) {
      const one = (t: EnvelopeTable) =>
        t.hostable[i] === 1 ? Math.max(0, t.yield[i * F + F - 1] - c.parcels.existingUnits[i]) : 0;
      sum += one(r.unprotected.table) - one(r.plan.table);
    }
    expect(cap.withoutProtections - cap.plan).toBe(sum);
    expect(cap.withoutProtections - cap.plan).toBeGreaterThan(0);
    expect(cap.protectedLots).toBe(2);
    expect(cap.plan).toBe(netCapacity(r.plan.table, c.parcels));
  });
});

describe('needs', () => {
  it('allNeeds dedupes and sorts; fillNeeds writes rows and throws on a missing one', () => {
    const c = ctx();
    const a = at(c, FZP_LOT);
    const r = resolveEnvelopes(c, L({ paint: [e([MINI_SB79_ID, FZP_LOT], 7)] }), ASOF);
    const needs = allNeeds(r);
    expect(needs.map((n) => n.row)).toEqual([a, at(c, MINI_SB79_ID)].sort((x, y) => x - y));
    expect(() => fillNeeds(r, new Map())).toThrow(/no envelope row/);
    const rows = new Map<string, EnvelopeRow>(
      needs.map((n) => [
        needKey(n),
        { stories: n.stories, cap: n.cap, yield: [0, 1, 2, 3, 4], hostable: true }
      ])
    );
    const filled = fillNeeds(r, rows);
    expect(row(filled.plan.table, a).yield).toEqual([0, 1, 2, 3, 4]);
    expect(filled.plan.table.hostable[a]).toBe(1);
    expect(filled.unprotected).toBe(filled.plan);
    expect(r.plan.table.hostable[a]).toBe(0); // input untouched
  });
});
