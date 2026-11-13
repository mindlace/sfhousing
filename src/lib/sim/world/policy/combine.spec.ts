import { describe, expect, it } from 'vitest';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { parseFinanceLevers } from '$lib/sim/levers/finance';
import { LeverFormatError, MIN_SCALE, type StoryEdit } from '$lib/sim/levers/types';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { monthFirstDay } from '../months';
import {
  inForceAt,
  moneyLeversOf,
  permittingOf,
  zoningKeyOf,
  zoningLevers,
  type ZoningLevers
} from './combine';
import {
  AS_OF,
  baselinePolicy,
  fundPolicy,
  lotsOf,
  miniDoc,
  miniLotIds,
  off,
  paintedPolicy,
  protectPolicy,
  termsPolicy,
  timingPolicy,
  timingSet,
  transitPolicy
} from './test/fixtures';

const DAY1 = monthFirstDay(AS_OF, 1);
const [X, Y, Z] = miniLotIds();

/** Today's levers for `doc` on day 1, the Local Program switch taken from its permitting. */
function zoningOn(doc: SimPolicy4, lots: Record<string, string[]>, day = DAY1): ZoningLevers {
  const f = inForceAt(doc, day);
  return zoningLevers(f, lots, permittingOf(f).localProgramStreamlined);
}

/** Lot to stories over `edits`, checking each lot is named once. */
function storiesOf(edits: StoryEdit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of edits)
    for (const l of e.lots) {
      expect(out[l], `lot ${l} named twice`).toBeUndefined();
      out[l] = e.stories;
    }
  return out;
}

const stroke = (radiusM: number) => ({ path: [[-122.4, 37.7] as [number, number]], radiusM });
const paint = (id: string, r: number, stories: number): CustomBrush => ({
  id,
  kind: 'paint',
  strokes: [stroke(r)],
  stories
});
const erase = (id: string, r: number): CustomBrush => ({ id, kind: 'erase', strokes: [stroke(r)] });
const keyOf = (b: CustomBrush) => queryKey(customQuery(b));

describe('inForceAt', () => {
  it('leaves out a policy that is off and one whose span starts later, keeping list order', () => {
    const a = protectPolicy('a', 'historic');
    const b = off(protectPolicy('b', 'rentControl'));
    const c = protectPolicy('c', 'rentControl', null, [[3, null]]);
    const d = protectPolicy('d', 'newerThan', 30, [[1, 2]]);
    const doc = miniDoc(a, b, c, d);
    expect(inForceAt(doc, DAY1).zoning.map((x) => [x.index, x.policy.id])).toEqual([
      [0, 'a'],
      [3, 'd']
    ]);
    expect(inForceAt(doc, monthFirstDay(AS_OF, 3)).zoning.map((x) => x.policy.id)).toEqual([
      'a',
      'c'
    ]);
    const f = inForceAt(doc, DAY1);
    expect(f.zoning[1].span).toBe(d.spans[0]);
    expect(f.permitting).toEqual([]);
    expect(f.money).toEqual([]);
  });
});

describe('rule 10: zoning rules take the highest that names a lot', () => {
  const p5 = transitPolicy('p5', ['metro'], [{ maxM: 402, stories: 5 }]);
  const p7 = transitPolicy('p7', ['frequentBus'], [{ maxM: 402, stories: 7 }]);
  const lots = lotsOf(
    [{ kind: 'transit', stopTypes: ['metro'], maxM: 402 }, [Y, X]],
    [{ kind: 'transit', stopTypes: ['frequentBus'], maxM: 402 }, [X]]
  );

  it('gives a lot named at 5 and 7 stories 7, in either list order', () => {
    const ab = zoningOn(miniDoc(p5, p7), lots);
    const ba = zoningOn(miniDoc(p7, p5), lots);
    expect(storiesOf(ab.rules)).toEqual({ [X]: 7, [Y]: 5 });
    expect(storiesOf(ba.rules)).toEqual({ [X]: 7, [Y]: 5 });
    for (const e of ab.rules) {
      expect(e.source).toBeUndefined();
      expect(e.lots).toEqual([...e.lots].sort());
    }
    expect(ab.paint).toEqual([]);
    expect(zoningKeyOf(ab)).toBe(zoningKeyOf(ba));
  });

  it('keys a different zoning state differently', () => {
    const only5 = zoningOn(miniDoc(p5), lots);
    const both = zoningOn(miniDoc(p5, p7), lots);
    expect(zoningKeyOf(only5)).not.toBe(zoningKeyOf(both));
  });
});

describe('rule 11: painted policies', () => {
  const a1 = paint('a1', 10, 4);
  const a2 = erase('a2', 20);
  const a3 = paint('a3', 30, 6);
  const b1 = paint('b1', 40, 9);
  const lots = {
    [keyOf(a1)]: [X],
    [keyOf(a2)]: [X],
    [keyOf(a3)]: [Y],
    [keyOf(b1)]: [X]
  };
  const A = paintedPolicy('A', [a1, a2, a3]);
  const B = paintedPolicy('B', [b1]);

  it('A above B: x 9 from B, y 6 from A', () => {
    expect(storiesOf(zoningOn(miniDoc(A, B), lots).paint)).toEqual({ [X]: 9, [Y]: 6 });
  });

  it("B above A: x 9 still, since A's erase never reaches B", () => {
    expect(storiesOf(zoningOn(miniDoc(B, A), lots).paint)).toEqual({ [X]: 9, [Y]: 6 });
  });

  it('B above A with A painting x at 4 last: x 4', () => {
    const A2 = paintedPolicy('A', [a3, a1]);
    const z = zoningOn(miniDoc(B, A2), lots);
    expect(storiesOf(z.paint)).toEqual({ [X]: 4, [Y]: 6 });
    expect(z.paint.every((e) => e.source === undefined)).toBe(true);
    expect(z.rules).toEqual([]);
  });
});

describe('rule 12: protections', () => {
  it('turns on each protection any policy in force turns on', () => {
    const z = zoningOn(
      miniDoc(protectPolicy('h', 'historic'), protectPolicy('r', 'rentControl')),
      {}
    );
    expect(z.protect).toEqual({ rentControl: true, historic: true, newerThanYears: null });
  });

  it('takes the largest newerThan years', () => {
    const doc = miniDoc(
      protectPolicy('n20', 'newerThan', 20),
      protectPolicy('n40', 'newerThan', 40)
    );
    expect(zoningOn(doc, {}).protect).toEqual({
      rentControl: false,
      historic: false,
      newerThanYears: 40
    });
  });

  it('protects nothing with nothing in force', () => {
    expect(zoningOn(miniDoc(), {}).protect).toEqual({
      rentControl: false,
      historic: false,
      newerThanYears: null
    });
  });
});

describe('rule 13: permitting timers', () => {
  const allTimer = (scale: number) =>
    timingSet({
      edits: [{ pathway: 'discretionary', stage: 'permitFiled', scale, reach: 'all' }]
    });

  it('multiplies all timers into speed', () => {
    const doc = miniDoc(timingPolicy('t1', allTimer(0.5)), timingPolicy('t2', allTimer(0.5)));
    const p = permittingOf(inForceAt(doc, DAY1));
    expect(p.speed).toEqual({
      discretionary: { permitFiled: 0.25 },
      streamlined: {},
      permitOnly: {}
    });
    expect(p.speedNew).toEqual([]);
  });

  it('clamps an overall 0.04 to MIN_SCALE', () => {
    const doc = miniDoc(timingPolicy('t1', allTimer(0.2)), timingPolicy('t2', allTimer(0.2)));
    expect(permittingOf(inForceAt(doc, DAY1)).speed.discretionary.permitFiled).toBe(MIN_SCALE);
  });

  it('turns a new timer into a speedNew entry from its span start, with no all timer in it', () => {
    const set = timingSet({
      preset: 'sb423Clock',
      presetTimers: [{ pathway: 'streamlined', stage: 'filed', scale: 0.5, reach: 'new' }],
      edits: [{ pathway: 'streamlined', stage: 'permitFiled', scale: 0.5, reach: 'all' }]
    });
    const doc = miniDoc(timingPolicy('t', set, [[3, null]]));
    const d = monthFirstDay(AS_OF, 3);
    const p = permittingOf(inForceAt(doc, d));
    expect(p.speedNew).toEqual([
      { from: d, scale: { discretionary: {}, streamlined: { filed: 0.5 }, permitOnly: {} } }
    ]);
    expect(p.speed).toEqual({
      discretionary: {},
      streamlined: { permitFiled: 0.5 },
      permitOnly: {}
    });
  });

  it('orders speedNew by from, then list order, and skips identity sets', () => {
    const newSet = (scale: number) =>
      timingSet({
        presetTimers: [{ pathway: 'permitOnly', stage: 'permitFiled', scale, reach: 'new' }]
      });
    const doc = miniDoc(
      timingPolicy('late', newSet(0.5), [[2, null]]),
      timingPolicy('early', newSet(0.8)),
      timingPolicy('same', newSet(0.6), [[2, null]]),
      timingPolicy('identity', newSet(1))
    );
    const p = permittingOf(inForceAt(doc, monthFirstDay(AS_OF, 2)));
    expect(p.speedNew.map((e) => [e.from, e.scale.permitOnly.permitFiled])).toEqual([
      [DAY1, 0.8],
      [monthFirstDay(AS_OF, 2), 0.5],
      [monthFirstDay(AS_OF, 2), 0.6]
    ]);
  });

  it('keeps each set’s floors as it carries them (no re-resolve)', () => {
    const set = timingSet({
      preset: 'benchmarkPermits',
      presetTimers: [
        { pathway: 'discretionary', stage: 'permitFiled', scale: 0.4786, reach: 'all' }
      ]
    });
    const p = permittingOf(inForceAt(miniDoc(timingPolicy('b', set)), DAY1));
    expect(p.speed.discretionary.permitFiled).toBe(0.4786);
  });
});

describe('rule 14: route shares and the Local Program', () => {
  const S1 = { discretionary: 10, streamlined: 60, permitOnly: 30 };
  const S2 = { discretionary: 0, streamlined: 70, permitOnly: 30 };

  it('takes route shares from the lowest policy in force that sets them', () => {
    const doc = miniDoc(
      timingPolicy('a', timingSet({ routeShares: S1 })),
      timingPolicy('b', timingSet({ presetRouteShares: S2 })),
      timingPolicy('c', timingSet())
    );
    expect(permittingOf(inForceAt(doc, DAY1)).routeShares).toEqual(S2);
  });

  it('gives null with no shares set', () => {
    const doc = miniDoc(timingPolicy('a', timingSet()));
    expect(permittingOf(inForceAt(doc, DAY1)).routeShares).toBeNull();
    expect(permittingOf(inForceAt(miniDoc(), DAY1)).routeShares).toBeNull();
  });

  it('is not streamlined when one policy in force says so', () => {
    const doc = miniDoc(
      timingPolicy('a', timingSet()),
      timingPolicy('b', timingSet({ localProgramStreamlined: false }))
    );
    const f = inForceAt(doc, DAY1);
    expect(permittingOf(f).localProgramStreamlined).toBe(false);
    expect(zoningOn(doc, {}).localProgramStreamlined).toBe(false);
  });

  it('is streamlined with nothing in force', () => {
    expect(permittingOf(inForceAt(miniDoc(), DAY1)).localProgramStreamlined).toBe(true);
    expect(zoningOn(miniDoc(), {}).localProgramStreamlined).toBe(true);
  });
});

describe('rule 15: money', () => {
  it('same pool and day, lower wins, entries sorted by pool then from', () => {
    const d1 = AS_OF + 10;
    const d2 = AS_OF + 400;
    const doc = miniDoc(
      baselinePolicy('a', [
        { pool: 'city-a', from: d1, scale: 0.5 },
        { pool: 'state', from: d2, scale: 2 }
      ]),
      baselinePolicy('b', [
        { pool: 'state', from: d2, scale: 3 },
        { pool: 'city-b', from: d1, scale: 0 }
      ])
    );
    const f = moneyLeversOf(inForceAt(doc, DAY1));
    expect(f.baselineScale).toEqual([
      { pool: 'city-a', from: d1, scale: 0.5 },
      { pool: 'city-b', from: d1, scale: 0 },
      { pool: 'state', from: d2, scale: 3 }
    ]);
    expect(() => parseFinanceLevers(f, 'finance')).not.toThrow();
  });

  it('merges terms, lower wins', () => {
    const doc = miniDoc(
      termsPolicy('a', { constructionRate: 0.07, lossOnExit: 0.5 }),
      termsPolicy('b', { constructionRate: 0.08 })
    );
    expect(moneyLeversOf(inForceAt(doc, DAY1)).terms).toEqual({
      constructionRate: 0.08,
      lossOnExit: 0.5
    });
  });

  it('lists added pools and programmes in document order', () => {
    const fo = fundingOnly();
    const onState = { ...structuredClone(fo.programmes[0]), id: 'u-prog-2', pool: 'state' };
    const doc = miniDoc(
      fundPolicy('fund-state', 'state', null, [onState]),
      fundPolicy('fund-u-pool-1', 'u-pool-1', fo.pools[0], fo.programmes),
      off(fundPolicy('fund-off', 'city-a', null, [{ ...onState, id: 'u-prog-3' }]))
    );
    const f = moneyLeversOf(inForceAt(doc, DAY1));
    expect(f.pools).toEqual(fo.pools);
    expect(f.programmes.map((g) => g.id)).toEqual(['u-prog-2', 'u-prog-1']);
    expect(f.baselineScale).toEqual([]);
    expect(f.terms).toEqual({});
    expect(() => parseFinanceLevers(f, 'finance')).not.toThrow();
  });

  it('is empty with nothing in force', () => {
    expect(moneyLeversOf(inForceAt(miniDoc(), DAY1))).toEqual({
      baselineScale: [],
      pools: [],
      programmes: [],
      terms: {}
    });
  });
});

describe('missing lots', () => {
  const b = paint('p', 10, 5);
  it('throws LeverFormatError naming the key for a painted policy in force', () => {
    const doc = miniDoc(paintedPolicy('painted', [b]));
    expect(() => zoningOn(doc, { other: [Z] })).toThrow(LeverFormatError);
    expect(() => zoningOn(doc, {})).toThrow(keyOf(b));
  });

  it('does not throw when that policy is off', () => {
    const doc = miniDoc(off(paintedPolicy('painted', [b])));
    expect(zoningOn(doc, {}).paint).toEqual([]);
  });
});
