import { describe, expect, it } from 'vitest';
import { NULL_CAP } from '$lib/data/policy-codec';
import { miniOptions } from '../world/fixtures/mini-options';
import { miniCity } from '../world/fixtures/mini-parcels';
import { MINI_HISTORIC_ID, MINI_SB79_ID, miniPolicy } from '../world/fixtures/mini-policy';
import { dayOf } from '../world/dates';
import { stockTable, type EnvelopeTable, type LayerCtx } from './layers';
import {
  capacityOf,
  leverCapacity,
  lotCapacity,
  netCapacity,
  protectedRows,
  resolveEnvelopes
} from './resolve';
import { DEFAULT_LEVERS, type SimLevers, type StoryEdit } from './types';

const FZP_LOT = '2999A001'; // 4 stories, uncapped, 1 home
const ASOF = dayOf(2025, 6, 1);

function ctx(): LayerCtx {
  const city = miniCity();
  return { parcels: city.parcels, policy: miniPolicy(city), options: miniOptions(city) };
}
const L = (patch: Partial<SimLevers> = {}): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  ...patch
});
const e = (lots: string[], stories: number): StoryEdit => ({ lots, stories });
function row(t: EnvelopeTable, i: number) {
  return { stories: t.stories[i], cap: t.cap[i], hostable: t.hostable[i] };
}
const at = (c: LayerCtx, id: string) => c.parcels.index.get(id)!;
/** Protections that cover exactly `ids` in `c`: the historic category, flagged on those lots only. */
function protecting(c: LayerCtx, ids: string[]) {
  c.policy.historicProtected.fill(0);
  for (const id of ids) c.policy.historicProtected[at(c, id)] = 1;
  return { ...DEFAULT_LEVERS.protect, historic: true };
}

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
  });

  it('a rule above FZP raises the lot uncapped, hosting where it is eligible', () => {
    const c = ctx();
    const id = c.parcels.id[CAPPED];
    const s = stockTable(c, 'fzp').stories[CAPPED];
    const r = resolveEnvelopes(c, L({ rules: [e([id], s + 3)] }), ASOF);
    expect(r.plan.table.stories[CAPPED]).toBe(s + 3);
    expect(r.plan.table.cap[CAPPED]).toBe(NULL_CAP);
    expect(r.plan.table.hostable[CAPPED]).toBe(c.parcels.eligible[CAPPED]);
  });

  it('a rule at or below FZP leaves the FZP row, cap included', () => {
    const c = ctx();
    const id = c.parcels.id[CAPPED];
    const s = stockTable(c, 'fzp').stories[CAPPED];
    for (const n of [s, s - 1]) {
      const r = resolveEnvelopes(c, L({ rules: [e([id], n)] }), ASOF);
      expect(row(r.plan.table, CAPPED)).toEqual(row(stockTable(c, 'fzp'), CAPPED));
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

  it('paint to 0 stories hosts nothing and holds nothing', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    const r = resolveEnvelopes(c, L({ paint: [e([FZP_LOT], 0)] }), ASOF);
    expect(row(r.plan.table, i)).toMatchObject({ stories: 0, hostable: 0 });
    expect(lotCapacity(c.options, i, 0, NULL_CAP, c.parcels.existingUnits[i])).toBe(0);
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

  it('unknown ids are counted once across rules and paint', () => {
    const r = resolveEnvelopes(
      ctx(),
      L({ rules: [e(['nope', 'gone'], 5)], paint: [e(['nope'], 5)] }),
      ASOF
    );
    expect(r.unknownLots).toBe(2);
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
        protect: protecting(c, [MINI_SB79_ID])
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
      const r = resolveEnvelopes(c, L({ ...patch, protect: protecting(c, [FZP_LOT]) }), ASOF);
      expect(row(r.plan.table, i)).toEqual({ ...row(fzp, i), hostable: 0 });
      expect(Array.from(r.protectedRows)).toEqual([i]);
    }
    const lowered = resolveEnvelopes(
      c,
      L({ paint: [e([FZP_LOT], 0)], protect: protecting(c, [FZP_LOT]) }),
      ASOF
    );
    const cap = leverCapacity(lowered, c);
    expect(cap.withoutProtections - cap.plan).toBe(0); // lowered to 0: nothing either way
  });

  it('categories: historic, rent control, newer-than', () => {
    const c = ctx();
    const none = DEFAULT_LEVERS.protect;
    const rows = (p: Partial<typeof none>) => Array.from(protectedRows(c, { ...none, ...p }, ASOF));
    expect(rows({ historic: true })).toContain(at(c, MINI_HISTORIC_ID));
    expect(rows({ rentControl: true })).toEqual(
      [...c.parcels.rentControlLikely].flatMap((v, i) => (v ? [i] : []))
    );
    const newer = rows({ newerThanYears: 60 }); // built 1965 or later
    expect(newer).toContain(at(c, '3512004'));
    expect(newer).not.toContain(at(c, '3600005')); // 1958
    expect(newer).not.toContain(at(c, '3600003')); // yearBuilt 0 = unknown
  });

  it('rows covered by several categories are listed once, ascending', () => {
    const c = ctx();
    const all = protectedRows(c, { rentControl: true, historic: true, newerThanYears: 200 }, ASOF);
    const xs = Array.from(all);
    expect(xs).toEqual([...new Set(xs)].sort((a, b) => a - b));
    expect(xs).toContain(at(c, MINI_HISTORIC_ID));
  });

  it('withoutProtections minus plan is the sum over protected rows', () => {
    const c = ctx();
    const r = resolveEnvelopes(
      c,
      L({
        rules: [e([MINI_SB79_ID], 8)],
        paint: [e([FZP_LOT], 0)],
        protect: protecting(c, [FZP_LOT, MINI_SB79_ID])
      }),
      ASOF
    );
    const cap = leverCapacity(r, c);
    let sum = 0;
    for (const i of r.protectedRows) {
      const one = (t: EnvelopeTable) =>
        t.hostable[i] === 1
          ? lotCapacity(c.options, i, t.stories[i], t.cap[i], c.parcels.existingUnits[i])
          : 0;
      sum += one(r.unprotected.table) - one(r.plan.table);
    }
    expect(cap.withoutProtections - cap.plan).toBe(sum);
    expect(cap.withoutProtections - cap.plan).toBeGreaterThan(0);
    expect(cap.protectedLots).toBe(2);
    expect(cap.plan).toBe(netCapacity(r.plan.table, c.parcels, c.options));
  });
});

describe('capacity by rule A', () => {
  /** Every lot at `stories`, uncapped, hostable where eligible. */
  function allAt(c: LayerCtx, stories: number): EnvelopeTable {
    const n = c.parcels.count;
    return {
      count: n,
      stories: new Uint8Array(n).fill(stories),
      cap: new Uint16Array(n).fill(NULL_CAP),
      hostable: Uint8Array.from(c.parcels.eligible)
    };
  }

  it('never lowers capacity when every cap rises', () => {
    const c = ctx();
    for (let s = 1; s < 40; s++) {
      expect(netCapacity(allAt(c, s + 1), c.parcels, c.options)).toBeGreaterThanOrEqual(
        netCapacity(allAt(c, s), c.parcels, c.options)
      );
    }
    expect(netCapacity(allAt(c, 13), c.parcels, c.options)).toBeGreaterThan(0);
  });

  it('is the most homes an allowed option holds after the cap, less the homes there', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    const t = c.options;
    const existing = c.parcels.existingUnits[i];
    for (const stories of [0, 1, 4, 8, 13]) {
      let most = 0;
      for (let j = t.offset[i]; j < t.offset[i + 1]; j++)
        if (t.stories[j] <= stories) most = Math.max(most, t.homes[j]);
      expect(lotCapacity(t, i, stories, NULL_CAP, existing)).toBe(Math.max(0, most - existing));
      expect(lotCapacity(t, i, stories, existing, existing)).toBe(0); // a cap at the homes there
    }
  });

  it('capacityOf reads a view as netCapacity reads its table', () => {
    const c = ctx();
    const t = stockTable(c, 'fzp');
    const parcels = { ...c.parcels, fzpCap: t.cap };
    expect(capacityOf({ parcels, pre: { choice: { t: c.options } } })).toBe(
      netCapacity(t, parcels, c.options)
    );
  });
});
