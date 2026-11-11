// finance-score: homes by income tier for one schedule (spec 4.1; section 6 tests 1-8).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSUMED_TENURE, INCLUSIONARY, fundBundle, projectDollars, prototypeFor } from '../finance';
import { MINI_AS_OF, MINI_HORIZON } from './fixtures/mini-projects';
import { tinyQueue, tinyStack } from './fixtures/tiny-queue';
import {
  AFFORDABLE_CASES as A,
  MARKET,
  PROJECTS,
  T,
  affordable,
  caseCtx,
  pipeline,
  schedule
} from './fixtures/finance-score-cases';
import type { TierUnits } from '$lib/timelapse/types';
import { dayOf } from './dates';
import {
  TIER_SOURCES,
  allocatePhases,
  splitByShares,
  tierBaselineLabel,
  tierContext,
  tierSeries,
  tiersOf
} from './finance-score';
import { monthIndexer, monthsOf, shownSeries } from './score';
import { simulate } from './simulate';
import type { Schedule, SimInput } from './types';

vi.mock('../finance', async (orig) => {
  const m = await orig<typeof import('../finance')>();
  return { ...m, fundBundle: vi.fn(m.fundBundle) };
});

const spy = vi.mocked(fundBundle);

beforeEach(() => {
  spy.mockClear();
});

const sum = (t: Record<string, number>) => Object.values(t).reduce((s, x) => s + x, 0);

describe('tiersOf, private projects (spec 6 tests 1-2)', () => {
  it('splits one case per inclusionary band through inclusionaryUnits', () => {
    const ctx = caseCtx();
    expect(tiersOf(MARKET.m9, ctx)).toEqual(T(0, 0, 0, 9, 0));
    expect(tiersOf(MARKET.m10, ctx)).toEqual(T(0, 2, 0, 8, 0));
    expect(tiersOf(MARKET.m25, ctx)).toEqual(T(0, 4, 1, 20, 0));
    expect(tiersOf(MARKET.m130, ctx)).toEqual(T(0, 18, 5, 107, 0));
  });

  it('reads the final revision (40 then 24 is the 10-24 band)', () => {
    expect(tiersOf(MARKET.revised, caseCtx())).toEqual(T(0, 4, 0, 20, 0));
  });

  it('splits a funded market project as any other simulated project', () => {
    expect(tiersOf(MARKET.funded, caseCtx())).toEqual(
      tiersOf(schedule({ units: [30] }), caseCtx())
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('tiersOf, funded affordable (spec 6 tests 3-5)', () => {
  it('weights the worked example 0.75 / 0.25', () => {
    expect(tiersOf(A.worked, caseCtx())).toEqual(T(50, 43, 8, 0, 0));
  });

  it('breaks a tie to the earlier tier', () => {
    expect(tiersOf(A.tie, caseCtx())).toEqual(T(2, 1, 0, 0, 0));
  });

  it('gives one paying programme its tiers without calling fundBundle', () => {
    expect(tiersOf(A.one, caseCtx())).toEqual(T(48, 43, 8, 1, 0));
    expect(spy).not.toHaveBeenCalled();
  });

  it('weights two loans that save nothing equally', () => {
    expect(tiersOf(A.loans, caseCtx())).toEqual(T(2, 2, 0, 0, 0));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends a null-tiers programme’s weight to unrecorded', () => {
    expect(tiersOf(A.nullTiers, caseCtx())).toEqual(T(45, 30, 0, 0, 25));
  });

  it('counts every home unrecorded without funding or with no paying programme', () => {
    const ctx = caseCtx();
    expect(tiersOf(A.noFunding, ctx)).toEqual(T(0, 0, 0, 0, 12));
    expect(tiersOf(A.emptyProgrammes, ctx)).toEqual(T(0, 0, 0, 0, 12));
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws on a programme id the context does not know', () => {
    expect(() => tiersOf(A.unknown, caseCtx())).toThrow('tiersOf: unknown programme zz');
  });

  it('memoises the weights by the sorted ids', () => {
    const ctx = caseCtx();
    const ba = tiersOf(affordable(['b', 'a'], 101), ctx);
    const ab = tiersOf(affordable(['a', 'b'], 101), ctx);
    expect([ba, ab]).toEqual([T(50, 43, 8, 0, 0), T(50, 43, 8, 0, 0)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...ctx.weights.keys()]).toEqual(['a,b']);
  });

  it('does not depend on the prototype (start stories 4 and 20)', () => {
    const at4 = affordable(['a', 'b'], 30, 4);
    const at20 = affordable(['a', 'b'], 30, 20);
    expect(prototypeFor(4, 30).id).not.toBe(prototypeFor(20, 30).id);
    expect(tiersOf(at4, caseCtx())).toEqual(T(15, 13, 2, 0, 0));
    expect(tiersOf(at20, caseCtx())).toEqual(tiersOf(at4, caseCtx()));
  });

  it('keeps a near-zero programme to at most one home (review focus 3)', () => {
    const r = tiersOf(affordable(['a', 'tiny'], 50), caseCtx());
    expect(sum(r)).toBe(50);
    expect(r.moderate).toBeLessThanOrEqual(1);
  });
});

describe('the re-pricing matches the award (spec 6 test 6)', () => {
  it('prices funding.programmes again to funding.granted within a dollar per item', () => {
    const input: SimInput = {
      ...tinyQueue({ logOdds: [0, 0, 0, 0, 0] }),
      finance: tinyStack({
        asOf: MINI_AS_OF,
        bond: {
          share: 0.5,
          from: MINI_AS_OF,
          inflows: [{ kind: 'once', day: MINI_AS_OF, dollars: 1e12 }]
        }
      })
    };
    const ctx = tierContext(input);
    let n = 0;
    let twoCity = 0;
    for (let seed = 1; seed <= 5; seed++) {
      for (const s of simulate(input, seed, MINI_HORIZON)) {
        if (s.kind !== 'affordable' || !s.funding) continue;
        n++;
        const ids = s.funding.programmes;
        if (ids.includes('t-city') && ids.includes('t-bond-grant')) twoCity++;
        const r0 = s.revisions[0];
        const b = fundBundle(
          ids.map((id) => ctx.programmes.get(id)!.item),
          'affordable',
          prototypeFor(r0.stories ?? 0, r0.units),
          input.finance!.terms
        );
        const granted = b.items.reduce((t, it) => t + projectDollars(it.granted, r0.units), 0);
        expect(Math.abs(granted - s.funding.granted)).toBeLessThanOrEqual(b.items.length);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(twoCity).toBeGreaterThan(0);
  });
});

describe('tiersOf, pipeline (spec 6 tests 7-8)', () => {
  const ctx = () => tierContext({ projects: PROJECTS });

  it('counts recorded affordable homes as unrecorded, capped at the final units', () => {
    const c = ctx();
    expect(tiersOf(pipeline('PRJ:null', [100]), c)).toEqual(T(0, 0, 0, 100, 0));
    expect(tiersOf(pipeline('PRJ:absent', [100]), c)).toEqual(T(0, 0, 0, 100, 0));
    expect(tiersOf(pipeline('PRJ:zero', [100]), c)).toEqual(T(0, 0, 0, 100, 0));
    expect(tiersOf(pipeline('PRJ:thirty', [100]), c)).toEqual(T(0, 0, 0, 70, 30));
    expect(tiersOf(pipeline('PRJ:over', [100]), c)).toEqual(T(0, 0, 0, 0, 100));
    expect(tiersOf(pipeline('PRJ:thirty', [100, 60]), c)).toEqual(T(0, 0, 0, 30, 30));
  });

  it('allocates a master’s count over its phases by largest remainder, ties to the lower', () => {
    expect(allocatePhases(50, [100, 100, 101])).toEqual([17, 16, 17]);
    expect(allocatePhases(0, [100, 100, 101])).toEqual([0, 0, 0]);
    expect(allocatePhases(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it('caps a phase at its final units and takes an unenriched master’s count whole', () => {
    const c = ctx();
    expect(tiersOf(pipeline('PRJ:master:phase:1', [100, 10]), c)).toEqual(T(0, 0, 0, 0, 10));
    expect(tiersOf(pipeline('PRJ:master:phase:2', [100]), c)).toEqual(T(0, 0, 0, 84, 16));
    expect(tiersOf(pipeline('PRJ:unenriched', [100]), c)).toEqual(T(0, 0, 0, 60, 40));
  });

  it('builds the phase counts from projects, never from schedules (review focus 4)', () => {
    const c = ctx();
    expect(c.affordable.get('PRJ:master:phase:1')).toBe(17);
    expect(c.affordable.get('PRJ:master:phase:2')).toBe(16);
    expect(c.affordable.get('PRJ:master:phase:3')).toBe(17);
    expect(c.affordable.has('PRJ:master')).toBe(false);
    expect(c.affordable.get('PRJ:unenriched')).toBe(40);
    expect(c.affordable.get('PRJ:thirty')).toBe(30);
    expect(c.affordable.get('PRJ:over')).toBe(120);
    expect(c.affordable.get('PRJ:null') ?? 0).toBe(0);
    expect(c.affordable.get('PRJ:absent') ?? 0).toBe(0);
  });
});

describe('tierContext', () => {
  it('maps programmes to their pool kind and tiers, and terms to the input’s', () => {
    const finance = tinyStack({
      asOf: MINI_AS_OF,
      bond: { share: 0.5, from: MINI_AS_OF, inflows: [] }
    });
    const c = tierContext({ projects: [], finance });
    expect([...c.programmes.keys()]).toEqual(['t-fed', 't-state', 't-city', 't-bond-grant']);
    expect([...c.programmes.values()].map((p) => p.item.poolKind)).toEqual([
      'federal',
      'state',
      'generalRevenue',
      'goBond'
    ]);
    expect(c.programmes.get('t-city')!.item.instrument).toBe(finance.programmes[2].instrument);
    expect(c.programmes.get('t-city')!.tiers).toBe(finance.programmes[2].tiers);
    expect(c.terms).toBe(finance.terms);
    expect(c.weights.size).toBe(0);
  });

  it('has no programmes and null terms without finance', () => {
    const c = tierContext({ projects: [] });
    expect([c.programmes.size, c.terms, c.weights.size]).toEqual([0, null, 0]);
  });
});

describe('splitByShares', () => {
  const s = (vl: number, lo: number, mo: number, am: number, un: number) => ({
    veryLow: vl,
    low: lo,
    moderate: mo,
    aboveModerate: am,
    unrecorded: un
  });

  it('gives all zeros for no homes', () => {
    expect(splitByShares(0, s(0.5, 0.425, 0.075, 0, 0))).toEqual(T(0, 0, 0, 0, 0));
  });

  it('guards float error (0.29 of 100 is 29)', () => {
    expect(splitByShares(100, s(0.29, 0.71, 0, 0, 0))).toEqual(T(29, 71, 0, 0, 0));
  });

  it('places unrecorded after above moderate in the tie order', () => {
    expect(splitByShares(1, s(0, 0, 0, 0.5, 0.5))).toEqual(T(0, 0, 0, 1, 0));
    expect(splitByShares(1, s(0.5, 0, 0, 0, 0.5))).toEqual(T(1, 0, 0, 0, 0));
  });
});

describe('tierSeries (spec 6 tests 10-11)', () => {
  const AS_OF = MINI_AS_OF;
  const months = monthsOf(AS_OF, MINI_HORIZON);
  const idx = monthIndexer(months, MINI_HORIZON);
  const at = (series: TierUnits[], d: number) => series[idx(d)];
  const run = (scs: Schedule[], ctx = caseCtx()) =>
    tierSeries(scs, ctx, AS_OF, MINI_HORIZON, months);
  const three = (over: Partial<Schedule> = {}) =>
    schedule({
      units: [25],
      existingUnits: 3,
      entered: { construction: AS_OF + 40 },
      end: { kind: 'complete', day: AS_OF + 400 },
      ...over
    });

  it('nets existing homes at construction and adds the split at completion (test 10)', () => {
    const s = run([three()]);
    expect(s).toHaveLength(months.length);
    expect(s[idx(AS_OF + 40) - 1]).toEqual(T(0, 0, 0, 0, 0));
    expect(at(s, AS_OF + 40)).toEqual(T(0, 0, 0, -3, 0));
    expect(s[idx(AS_OF + 400) - 1]).toEqual(T(0, 0, 0, -3, 0));
    expect(at(s, AS_OF + 400)).toEqual(T(0, 4, 1, 17, 0));
    expect(s[s.length - 1]).toEqual(T(0, 4, 1, 17, 0));
  });

  it('subtracts nothing for a construction on or before asOf (a pipeline row)', () => {
    const s = run([three({ entered: { construction: AS_OF - 10 } })]);
    expect(s[0]).toEqual(T(0, 0, 0, 0, 0));
    expect(s[s.length - 1]).toEqual(T(0, 4, 1, 17 + 3, 0));
  });

  it('keeps the netting to the horizon for an exit after construction', () => {
    const s = run([
      three({ end: { kind: 'exit', day: AS_OF + 100, stage: 'construction', reason: 'withdrawn' } })
    ]);
    expect(s[s.length - 1]).toEqual(T(0, 0, 0, -3, 0));
  });

  it('two demolitions before any completion give aboveModerate -7 (review focus 5)', () => {
    const a = three({
      existingUnits: 3,
      end: { kind: 'exit', day: AS_OF + 100, stage: 'construction', reason: 'withdrawn' }
    });
    const b = three({
      existingUnits: 4,
      end: { kind: 'exit', day: AS_OF + 100, stage: 'construction', reason: 'withdrawn' }
    });
    const s = run([a, b]);
    expect(s[s.length - 1]).toEqual(T(0, 0, 0, -7, 0));
  });

  it('agrees with completedNet every month on the hand schedules (test 11)', () => {
    const ctx = caseCtx([['PRJ:p', 4]]);
    const scs: Schedule[] = [
      ...Object.values(MARKET),
      ...Object.values(A).filter((s) => s !== A.unknown),
      pipeline('PRJ:p', [10, 7]),
      three(),
      three({ existingUnits: 9, entered: { construction: AS_OF + 5 } }),
      three({ entered: { construction: AS_OF - 10 } }),
      three({ end: { kind: 'exit', day: AS_OF + 100, stage: 'construction', reason: 'withdrawn' } })
    ];
    const tiers = run(scs, ctx);
    const shown = shownSeries({ schedules: scs, masters: [] }, AS_OF, MINI_HORIZON, months);
    tiers.forEach((t, i) => expect(sum(t)).toBe(shown[i].completedNet));
  });
});

describe('tierBaselineOf, tierBaselineLabel, TIER_SOURCES (spec 6 test 13)', () => {
  it('labels the baseline', () => {
    expect(tierBaselineLabel(19173)).toBe('completed since 30 June 2022 (net)');
    expect(tierBaselineLabel(dayOf(2023, 1, 5))).toBe('completed since 5 January 2023 (net)');
  });

  it('has the six sources in order', () => {
    expect(TIER_SOURCES.map((p) => p.tier)).toEqual([1, 2, 1, 0, 2, 0]);
    expect(TIER_SOURCES[0].sources[0].url).toContain('abag.ca.gov');
    expect(TIER_SOURCES[2].sources).toEqual([
      ...INCLUSIONARY.provenance.sources,
      ...ASSUMED_TENURE.provenance.sources
    ]);
    expect(TIER_SOURCES[2].method).toContain(INCLUSIONARY.provenance.method);
    expect(TIER_SOURCES[2].method).toContain(ASSUMED_TENURE.provenance.method);
    expect(TIER_SOURCES[1].method).toContain('tier 4 convention');
    expect(TIER_SOURCES[3].method).toContain('may mean');
  });
});
