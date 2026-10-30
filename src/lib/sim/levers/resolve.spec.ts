import { describe, expect, it } from 'vitest';
import { NULL_CAP } from '$lib/data/policy-codec';
import type { EnvelopeRow } from '$lib/data/envelope-row';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { MINI_HISTORIC_ID, MINI_SB79_ID, miniPolicy } from '../scenario/fixtures/mini-policy';
import { dayOf } from '../scenario/dates';
import { currentLawTable, stockTable, type EnvelopeTable, type LayerCtx } from './layers';
import {
  allNeeds,
  fillNeeds,
  leverCapacity,
  needKey,
  netCapacity,
  protectedRows,
  resolveEnvelopes
} from './resolve';
import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS, type SimLevers, type UserEdit } from './types';

const F = 5;
const FZP_LOT = '2999A001'; // 4 stories, uncapped, 1 home
const ASOF = dayOf(2025, 6, 1);
const SWITCH = dayOf(2032, 1, 31);
const HORIZON = dayOf(2035, 1, 1);
const WINDOW = { asOf: ASOF, horizon: HORIZON, switchDay: SWITCH };

function ctx(): LayerCtx {
  const city = miniCity();
  return { parcels: city.parcels, policy: miniPolicy(city) };
}
function levers(patch: Partial<SimLevers> = {}): SimLevers {
  return { ...structuredClone(FZP_COMPAT_LEVERS), compare: 'currentLaw', ...patch };
}
const edit = (lots: string[], mode: UserEdit['mode'], stories: number, densityLimits = false) =>
  ({ lots, mode, stories, densityLimits }) satisfies UserEdit;
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

describe('user edits', () => {
  it('raise, lower and set on a 4-story lot', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    const run = (e: UserEdit) => resolveEnvelopes(c, levers({ user: [e] }), WINDOW);
    expect(run(edit([FZP_LOT], 'raise', 6)).before.table.stories[i]).toBe(6);
    const same = run(edit([FZP_LOT], 'raise', 3));
    expect(same.before.table.stories[i]).toBe(4);
    expect(same.before.needs).toEqual([]);
    expect(run(edit([FZP_LOT], 'lower', 2)).before.table.stories[i]).toBe(2);
    const zero = run(edit([FZP_LOT], 'set', 0));
    expect(row(zero.before.table, i)).toMatchObject({
      stories: 0,
      yield: [0, 0, 0, 0, 0],
      hostable: 0
    });
    expect(zero.before.needs).toEqual([]);
  });

  it('a later edit wins; densityLimits picks current-law cap or none', () => {
    const c = ctx();
    const i = at(c, '3512007'); // current-law cap 4
    const r = resolveEnvelopes(
      c,
      levers({ user: [edit(['3512007'], 'set', 9), edit(['3512007'], 'set', 7, true)] }),
      WINDOW
    );
    expect(r.before.table.stories[i]).toBe(7);
    expect(r.before.table.cap[i]).toBe(4);
    expect(r.before.needs).toEqual([{ row: i, stories: 7, cap: 4 }]);
    const open = resolveEnvelopes(
      c,
      levers({ user: [edit(['3512007'], 'set', 7, false)] }),
      WINDOW
    );
    expect(open.before.table.cap[i]).toBe(NULL_CAP);
    expect(open.before.needs).toEqual([{ row: i, stories: 7, cap: null }]);
  });

  it('a raise to the lot SB 79 row needs nothing; 7 stories needs a row', () => {
    const c = ctx();
    const i = at(c, MINI_SB79_ID);
    const sb = resolveEnvelopes(c, levers({ user: [edit([MINI_SB79_ID], 'raise', 8)] }), WINDOW);
    expect(sb.before.needs).toEqual([]);
    expect(row(sb.before.table, i)).toEqual(row(stockTable(c, 'sb79'), i));
    const seven = resolveEnvelopes(c, levers({ user: [edit([MINI_SB79_ID], 'set', 7)] }), WINDOW);
    expect(seven.before.needs).toEqual([{ row: i, stories: 7, cap: null }]);
    expect(needKey(seven.before.needs[0])).toBe(`${i}:7:n`);
    expect(seven.before.table.hostable[i]).toBe(0);
  });

  it('does not write into the shared stock tables', () => {
    const c = ctx();
    const before = Array.from(stockTable(c, 'fzp').stories);
    resolveEnvelopes(
      c,
      levers({ user: [edit([FZP_LOT], 'set', 0)], protect: protectLots([MINI_SB79_ID]) }),
      WINDOW
    );
    expect(Array.from(stockTable(c, 'fzp').stories)).toEqual(before);
  });
});

describe('protections', () => {
  it('a protected lot equals its current-law row after a raise and after a lower', () => {
    const c = ctx();
    const i = at(c, FZP_LOT);
    for (const e of [edit([FZP_LOT], 'raise', 8), edit([FZP_LOT], 'lower', 0)]) {
      const r = resolveEnvelopes(c, levers({ user: [e], protect: protectLots([FZP_LOT]) }), WINDOW);
      expect(row(r.before.table, i)).toEqual(row(currentLawTable(c, 'before', false), i));
      expect(Array.from(r.protectedRows)).toEqual([i]);
    }
    const lowered = resolveEnvelopes(
      c,
      levers({ user: [edit([FZP_LOT], 'lower', 0)], protect: protectLots([FZP_LOT]) }),
      WINDOW
    );
    const cap = leverCapacity(lowered, c.parcels);
    expect(cap.withoutProtections - cap.plan).toBeLessThan(0);
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
    const r = resolveEnvelopes(c, levers({ protect: protectLots(lots) }), WINDOW);
    expect(r.unknownLots).toBe(1);
  });

  it('withoutProtections minus plan is the sum over protected rows', () => {
    const c = ctx();
    const r = resolveEnvelopes(
      c,
      levers({
        user: [edit([FZP_LOT], 'set', 0), edit([MINI_SB79_ID], 'raise', 8)],
        protect: protectLots([FZP_LOT, MINI_SB79_ID])
      }),
      WINDOW
    );
    expect(allNeeds(r)).toEqual([]);
    const cap = leverCapacity(r, c.parcels);
    let sum = 0;
    for (const i of r.protectedRows) {
      const one = (t: EnvelopeTable) =>
        t.hostable[i] === 1 ? Math.max(0, t.yield[i * F + F - 1] - c.parcels.existingUnits[i]) : 0;
      sum += one(r.unprotected.before.table) - one(r.before.table);
    }
    expect(cap.withoutProtections - cap.plan).toBe(sum);
    expect(cap.withoutProtections - cap.plan).not.toBe(0);
    expect(cap.protectedLots).toBe(2);
    expect(cap.plan).toBe(netCapacity(r.before.table, c.parcels));
  });
});

describe('periods', () => {
  const stock = () => levers({ stock: ['currentLaw'] });
  it('after is built when the switch falls inside the window', () => {
    const c = ctx();
    const r = resolveEnvelopes(c, stock(), WINDOW);
    expect(r.after?.day).toBe(SWITCH);
    expect(r.unprotected.after).not.toBeNull();
    const i = at(c, MINI_SB79_ID);
    expect(r.after!.period.table.stories[i]).toBe(8);
    expect(r.before.table.stories[i]).toBe(6);
    expect(leverCapacity(r, c.parcels).afterSwitch).not.toBeNull();
  });

  it('after is null: alternative plan kept, asOf at the switch, horizon before it, no current law', () => {
    const c = ctx();
    const kept = { ...stock(), assumeAlternativePlanKept: true };
    expect(resolveEnvelopes(c, kept, WINDOW).after).toBeNull();
    expect(resolveEnvelopes(c, stock(), { ...WINDOW, asOf: SWITCH }).after).toBeNull();
    expect(resolveEnvelopes(c, stock(), { ...WINDOW, horizon: SWITCH - 1 }).after).toBeNull();
    expect(resolveEnvelopes(c, levers(), WINDOW).after).toBeNull();
    const late = resolveEnvelopes(c, stock(), { ...WINDOW, asOf: SWITCH + 5 });
    expect(late.before.table.stories[at(c, MINI_SB79_ID)]).toBe(8); // already the after-switch law
    expect(leverCapacity(late, c.parcels).afterSwitch).toBeNull();
  });
});

describe('needs', () => {
  it('allNeeds dedupes and sorts; fillNeeds writes rows and throws on a missing one', () => {
    const c = ctx();
    const a = at(c, FZP_LOT);
    const r = resolveEnvelopes(
      c,
      levers({ stock: ['currentLaw'], user: [edit([MINI_SB79_ID, FZP_LOT], 'set', 7)] }),
      WINDOW
    );
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
    expect(row(filled.before.table, a).yield).toEqual([0, 1, 2, 3, 4]);
    expect(filled.before.table.hostable[a]).toBe(1);
    expect(filled.after!.period.table.hostable[a]).toBe(1);
    expect(r.before.table.hostable[a]).toBe(0); // input untouched
  });
});
