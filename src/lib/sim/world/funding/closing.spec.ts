import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, Programme } from '$lib/timelapse/types';
import { emptyWorld } from '../columns';
import { monthFirstDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { staticsOf } from '../statics';
import { NO_DAY, type FundingSystem } from '../types';
import { withFunding } from '../world';
import { addShutRow, fundOf, initFunding, reopenPool } from './columns';
import { closedTimeline, lastArrivalOf } from './closing';
import { createFundingSystem } from './system';
import { fundedMini, oneMoneyTimeline, replanAt } from './test/fixtures';

const asOf = fundedMini().asOf;

const pool = (inflows: Inflow[]): Pool => ({
  id: 'p',
  kind: 'generalRevenue',
  label: 'p',
  inflows,
  debt: null,
  leverage: 1
});

describe('lastArrivalOf', () => {
  const y = (from: Day, to: Day | null, d = 1e6): Inflow => ({
    kind: 'yearly',
    from,
    to,
    dollarsPerYear: d
  });
  const once = (day: Day, d = 1e6): Inflow => ({ kind: 'once', day, dollars: d });
  it('reads each inflow kind', () => {
    expect(lastArrivalOf(pool([once(asOf + 100)]), asOf)).toBe(asOf + 100);
    expect(lastArrivalOf(pool([y(dayFromUtc(2027, 3, 15), dayFromUtc(2030, 6, 1))]), asOf)).toBe(
      dayFromUtc(2030, 3, 15)
    );
    expect(lastArrivalOf(pool([y(dayFromUtc(2027, 3, 15), dayFromUtc(2090, 1, 1))]), asOf)).toBe(
      dayFromUtc(2089, 3, 15)
    );
    expect(lastArrivalOf(pool([y(asOf, null)]), asOf)).toBeNull();
    expect(lastArrivalOf(pool([y(asOf, null, 0), once(asOf + 50)]), asOf)).toBe(asOf + 50);
    expect(lastArrivalOf(pool([y(dayFromUtc(2028, 2, 29), dayFromUtc(2031, 12, 31))]), asOf)).toBe(
      dayFromUtc(2031, 2, 28)
    );
    expect(lastArrivalOf(pool([once(asOf - 1)]), asOf)).toBe(NO_DAY);
    expect(lastArrivalOf(pool([]), asOf)).toBe(NO_DAY);
    expect(lastArrivalOf(pool([once(asOf + 10, 0)]), asOf)).toBe(NO_DAY);
    expect(
      lastArrivalOf(pool([once(asOf + 900), once(asOf + 300), y(asOf, asOf + 400)]), asOf)
    ).toBe(asOf + 900);
  });
  it('is memoised per pool and start', () => {
    const p = pool([once(asOf + 5)]);
    expect(lastArrivalOf(p, asOf)).toBe(asOf + 5);
    expect(lastArrivalOf(p, asOf + 10)).toBe(NO_DAY);
    expect(lastArrivalOf(p, asOf)).toBe(asOf + 5);
  });
});

describe('closedTimeline', () => {
  const prog = (id: string, poolId: string): Programme => ({
    ...miniFinance(asOf).programmes[0],
    id,
    pool: poolId
  });
  const input = fundedMini({
    ...miniFinance(asOf),
    pools: ['a', 'b'].map((id) => ({
      ...pool([{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 1e6 }]),
      id
    })),
    programmes: [prog('a-1', 'a'), prog('a-2', 'a'), prog('b-1', 'b')],
    off: []
  });
  const base = oneMoneyTimeline(input, input.finance!);
  const fundOf2 = (ids: string[]) => {
    const w = emptyWorld(0);
    initFunding(w, ids);
    return fundOf(w).pools;
  };
  const offeredIds = (f: PolicyFrame): string[] =>
    f.finance!.programmes.filter((_, i) => f.finance!.offered[i] === 1).map((g) => g.id);

  it('is the base itself with no closing', () => {
    expect(closedTimeline(base, fundOf2(['a', 'b']), asOf)).toBe(base);
  });
  it('drops the closed pool from month 5 and only it', () => {
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    const v = closedTimeline(base, pools, asOf);
    expect(v.frameAt(4)).toBe(base.frameAt(4));
    const f = v.frameAt(5);
    expect(f.id).not.toBe(base.frameAt(5).id);
    expect(offeredIds(f)).toEqual(['b-1']);
    expect(f.finance!.pools).toBe(base.frameAt(5).finance!.pools);
    expect(f.finance!.arrivals).toBe(base.frameAt(5).finance!.arrivals);
    expect(v.frameAt(6).id).toBe(f.id);
    expect(v.changes()).toEqual([...new Set([...base.changes(), 5])].sort((x, y) => x - y));
    expect(v.touched(5)).toEqual(new Int32Array(0));
    expect(closedTimeline(base, pools, asOf)).toBe(v);
  });
  it('holds the opening month in changes()', () => {
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    reopenPool(pools, 0, monthFirstDay(asOf, 9));
    const v = closedTimeline(base, pools, asOf);
    expect(v.frameAt(9)).toBe(base.frameAt(9));
    expect(v.changes()).toEqual(expect.arrayContaining([5, 9]));
  });
  it('a view is a snapshot', () => {
    const pools = fundOf2(['a', 'b']);
    addShutRow(pools, 0, monthFirstDay(asOf, 5));
    const v = closedTimeline(base, pools, asOf);
    const at7 = v.frameAt(7);
    addShutRow(pools, 1, monthFirstDay(asOf, 7));
    expect(v.frameAt(7)).toBe(at7);
    const w = closedTimeline(base, pools, asOf);
    expect(w).not.toBe(v);
    expect(offeredIds(w.frameAt(7))).toEqual([]);
  });
  it('two histories over one base', () => {
    const p1 = fundOf2(['a', 'b']);
    const p2 = fundOf2(['a', 'b']);
    addShutRow(p1, 0, monthFirstDay(asOf, 5));
    addShutRow(p2, 1, monthFirstDay(asOf, 5));
    const v1 = closedTimeline(base, p1, asOf);
    const v2 = closedTimeline(base, p2, asOf);
    expect(offeredIds(v1.frameAt(5))).toEqual(['b-1']);
    expect(offeredIds(v2.frameAt(5))).toEqual(['a-1', 'a-2']);
    expect(closedTimeline(base, p1, asOf)).toBe(v1);
    expect(closedTimeline(base, p2, asOf)).toBe(v2);
  });
  it('a closed pool the frame does not hold is skipped and not listed', () => {
    const p = fundOf2(['a', 'b', 'gone']);
    addShutRow(p, 2, monthFirstDay(asOf, 5));
    addShutRow(p, 0, monthFirstDay(asOf, 6));
    const v = closedTimeline(base, p, asOf);
    expect(v.frameAt(5)).toBe(base.frameAt(5));
    expect(offeredIds(v.frameAt(6))).toEqual(['b-1']);
    expect(v.changes()).toEqual([6]);
  });
  it('keeps only the last eight views of a base', () => {
    const first = fundOf2(['a', 'b']);
    addShutRow(first, 0, monthFirstDay(asOf, 2));
    const v0 = closedTimeline(base, first, asOf);
    for (let k = 3; k < 12; k++) {
      const p = fundOf2(['a', 'b']);
      addShutRow(p, 0, monthFirstDay(asOf, k));
      closedTimeline(base, p, asOf);
    }
    expect(closedTimeline(base, first, asOf)).not.toBe(v0);
  });
});

describe('withFunding and the closing hooks', () => {
  it('step runs under beforeStep and planDue under timelineOf', () => {
    const input = fundedMini();
    const statics = staticsOf(input);
    const base = oneMoneyTimeline(input, input.finance!);
    const other = replanAt(base, 3);
    const seen: PolicyTimeline[] = [];
    const asked: number[] = [];
    const sys: FundingSystem = {
      ...createFundingSystem(),
      beforeStep: (w, _s, t) => {
        expect(t).toBe(base);
        asked.push(w.month);
        return other;
      },
      timelineOf: (_w, _s, t) => {
        expect(t).toBe(base);
        return other;
      },
      serve: (ctx) => {
        seen.push(ctx.timeline);
      }
    };
    const core = withFunding(sys);
    const out = { event() {} };
    const w = core.createWorld(statics, base, 1, out);
    const due = core.planDue(w, statics, base, 1, 4);
    for (let m = 1; m <= 4; m++) core.step(w, due, statics, base, 1, out);
    expect(asked).toEqual([0, 1, 2, 3]);
    expect(seen).toEqual([other, other, other, other]);
  });
});
