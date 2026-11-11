import { describe, expect, it } from 'vitest';
import { resolveTerms } from '../finance';
import type { Calibration, Pool, Programme } from '$lib/timelapse/types';
import { dayOf } from './dates';
import { runEngine } from './engine';
import { PIPELINE_FUNDED, checkFinance, inflowArrivals } from './funding';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import type { SimInput } from './types';

type Finance = NonNullable<SimInput['finance']>;

const A = dayOf(2026, 1, 1);

describe('inflowArrivals', () => {
  const asOf = dayOf(2024, 1, 1);
  const horizon = dayOf(2028, 3, 1);
  it('once: on asOf, before asOf, after the horizon', () => {
    expect(inflowArrivals({ kind: 'once', day: asOf, dollars: 1 }, asOf, horizon)).toEqual([asOf]);
    expect(inflowArrivals({ kind: 'once', day: asOf - 1, dollars: 1 }, asOf, horizon)).toEqual([]);
    expect(inflowArrivals({ kind: 'once', day: horizon + 1, dollars: 1 }, asOf, horizon)).toEqual(
      []
    );
  });
  it('yearly from 29 February lands on 28 February in common years', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2024, 2, 29), to: null, dollarsPerYear: 1 },
      asOf,
      horizon
    );
    expect(got).toEqual([
      dayOf(2024, 2, 29),
      dayOf(2025, 2, 28),
      dayOf(2026, 2, 28),
      dayOf(2027, 2, 28),
      dayOf(2028, 2, 29)
    ]);
  });
  it('yearly from before asOf starts at the first anniversary on or after asOf', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2020, 7, 1), to: null, dollarsPerYear: 1 },
      dayOf(2022, 1, 1),
      dayOf(2023, 12, 31)
    );
    expect(got).toEqual([dayOf(2022, 7, 1), dayOf(2023, 7, 1)]);
  });
  it('to is inclusive', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2026, 7, 1), to: dayOf(2028, 7, 1), dollarsPerYear: 1 },
      asOf,
      dayOf(2040, 1, 1)
    );
    expect(got).toHaveLength(3);
  });
  it('a to before the next anniversary gives one arrival', () => {
    const got = inflowArrivals(
      { kind: 'yearly', from: dayOf(2026, 7, 1), to: dayOf(2027, 6, 30), dollarsPerYear: 1 },
      asOf,
      dayOf(2040, 1, 1)
    );
    expect(got).toEqual([dayOf(2026, 7, 1)]);
  });
});

describe('PIPELINE_FUNDED', () => {
  it('is the spec 4.13 statement', () => {
    expect(PIPELINE_FUNDED).toEqual({
      tier: 4,
      label: 'Projects already in the pipeline are taken as funded',
      sources: [],
      method:
        'The simulation’s funding pools pay only for projects that start after the data date. ' +
        'Projects already in the pipeline are assumed to have their funding already, outside the ' +
        'pools, so the pools start with nothing committed: money the City has already committed to ' +
        'them is not subtracted. This overstates what the pools can fund in the first years.'
    });
  });
});

function tinyFinanceValid(): Finance {
  const pools: Pool[] = [
    {
      id: 'p-a',
      kind: 'generalRevenue',
      label: 'A',
      inflows: [{ kind: 'yearly', from: A, to: null, dollarsPerYear: 1000 }],
      uncapped: false,
      debt: null,
      leverage: 1
    },
    {
      id: 'p-b',
      kind: 'state',
      label: 'B',
      inflows: [{ kind: 'once', day: A, dollars: 500 }],
      uncapped: false,
      debt: null,
      leverage: 1
    },
    {
      id: 'fed',
      kind: 'federal',
      label: 'Fed',
      inflows: [],
      uncapped: true,
      debt: null,
      leverage: 1
    }
  ];
  const grant = (id: string, pool: string): Programme => ({
    id,
    label: id,
    pool,
    reach: 'market',
    instrument: { kind: 'grant', share: 0.5 },
    from: A,
    to: null,
    minHomes: 1,
    tiers: null
  });
  return {
    pools,
    programmes: [grant('g-a', 'p-a'), grant('g-b', 'p-b'), grant('g-fed', 'fed')],
    off: [],
    slope: 3,
    terms: resolveTerms()
  };
}

const withFinance = (finance: Finance): SimInput => ({ ...goldenInput(), finance });
const mutated = (f: (x: Finance) => void): SimInput => {
  const fin = tinyFinanceValid();
  f(fin);
  return withFinance(fin);
};
const bad = (input: SimInput, text: string) =>
  expect(() => checkFinance(input)).toThrow(new RangeError(text));

describe('checkFinance', () => {
  it('accepts a valid finance', () => {
    expect(() => checkFinance(withFinance(tinyFinanceValid()))).not.toThrow();
  });
  it('slope', () => {
    bad(
      mutated((f) => (f.slope = -1)),
      'finance.slope must be a finite number of 0 or more; got -1'
    );
    bad(
      mutated((f) => (f.slope = NaN)),
      'finance.slope must be a finite number of 0 or more; got NaN'
    );
  });
  it('repeated pool id', () => {
    bad(
      mutated((f) => (f.pools[1].id = 'p-a')),
      'finance.pools[1].id p-a is repeated'
    );
  });
  it('repeated programme id', () => {
    bad(
      mutated((f) => (f.programmes[1].id = 'g-a')),
      'finance.programmes[1].id g-a is repeated'
    );
  });
  it('programme names no pool', () => {
    bad(
      mutated((f) => (f.programmes[0].pool = 'nope')),
      'finance.programmes[0].pool nope names no pool'
    );
  });
  it('uncapped pool with inflows', () => {
    bad(
      mutated((f) => (f.pools[2].inflows = [{ kind: 'once', day: A, dollars: 1 }])),
      'finance.pools[2] (fed): an uncapped pool has no inflows'
    );
  });
  it('leverage', () => {
    bad(
      mutated((f) => (f.pools[0].leverage = 0)),
      'finance.pools[0] (p-a): leverage must be a finite number above 0; got 0'
    );
  });
  it('inflow dollars', () => {
    bad(
      mutated((f) => (f.pools[0].inflows = [{ kind: 'once', day: A, dollars: 1.5 }])),
      'finance.pools[0].inflows[0]: dollars must be a whole number of 0 or more'
    );
    bad(
      mutated(
        (f) => (f.pools[0].inflows = [{ kind: 'yearly', from: A, to: null, dollarsPerYear: -1 }])
      ),
      'finance.pools[0].inflows[0]: dollars must be a whole number of 0 or more'
    );
  });
  it('yearly inflow to before from', () => {
    bad(
      mutated(
        (f) => (f.pools[0].inflows = [{ kind: 'yearly', from: A, to: A - 1, dollarsPerYear: 1 }])
      ),
      'finance.pools[0].inflows[0]: to is before from'
    );
  });
  it('programme to before from', () => {
    bad(
      mutated((f) => {
        f.programmes[0].from = dayOf(2026, 1, 2);
        f.programmes[0].to = dayOf(2026, 1, 1);
      }),
      'finance.programmes[0] (g-a): to 2026-01-01 is before from 2026-01-02'
    );
  });
  it('debt required and forbidden', () => {
    bad(
      mutated((f) => (f.pools[0].kind = 'goBond')),
      'finance.pools[0] (p-a): debt is required for a goBond or cop pool'
    );
    bad(
      mutated((f) => (f.pools[0].debt = { rate: 0.05, termYears: 20 })),
      'finance.pools[0] (p-a): debt must be null for a generalRevenue pool'
    );
  });
  it('debt rate and term', () => {
    bad(
      mutated((f) => {
        f.pools[0].kind = 'cop';
        f.pools[0].debt = { rate: 0.3, termYears: 20 };
      }),
      'finance.pools[0] (p-a): debt.rate must be above 0 and at most 0.25; got 0.3'
    );
    bad(
      mutated((f) => {
        f.pools[0].kind = 'goBond';
        f.pools[0].debt = { rate: 0.05, termYears: 41 };
      }),
      'finance.pools[0] (p-a): debt.termYears must be a whole number from 1 to 40; got 41'
    );
  });
  it('minHomes', () => {
    const text = 'finance.programmes[0] (g-a): minHomes must be a whole number from 0 to 10000';
    bad(
      mutated((f) => (f.programmes[0].minHomes = 10001)),
      text
    );
    bad(
      mutated((f) => (f.programmes[0].minHomes = 2.5)),
      text
    );
  });
  it('invalid instrument', () => {
    bad(
      mutated((f) => (f.programmes[0].instrument = { kind: 'grant', share: 0 })),
      'finance.programmes[0] (g-a): A grant pays more than 0% and at most 100% of the uncovered cost.'
    );
  });
  it('missing term', () => {
    bad(
      mutated(
        (f) => (f.programmes[0].instrument = { kind: 'guarantee', costShare: 0.5, reserve: 0.2 })
      ),
      'finance.programmes[0] (g-a): guarantee needs guaranteeRateCut, which is not sourced'
    );
  });
  it('lossOnExit', () => {
    bad(
      mutated((f) => (f.terms = { ...f.terms, lossOnExit: null })),
      'finance.terms.lossOnExit must be between 0 and 1; got null'
    );
    bad(
      mutated((f) => (f.terms = { ...f.terms, lossOnExit: 1.5 })),
      'finance.terms.lossOnExit must be between 0 and 1; got 1.5'
    );
  });
  it('off names no pool, and off to before from', () => {
    bad(
      mutated((f) => (f.off = [{ pool: 'nope', from: A, to: null }])),
      'finance.off[0].pool nope names no pool'
    );
    bad(
      mutated((f) => (f.off = [{ pool: 'p-a', from: dayOf(2026, 1, 2), to: dayOf(2026, 1, 1) }])),
      'finance.off[0] (p-a): to 2026-01-01 is before from 2026-01-02'
    );
  });
  describe('affordable reach needs routes', () => {
    const text =
      'finance: the calibration has no affordableRoutes, but programme g-a reaches affordable projects';
    const affordable = (f: Finance) => {
      f.programmes[0].reach = 'affordable';
      f.programmes[0].tiers = { veryLow: 1, low: 0, moderate: 0, aboveModerate: 0 };
    };
    const routes = {
      discretionary: 0.3,
      streamlined: 0.6,
      permitOnly: 0.1,
      provenance: PIPELINE_FUNDED
    } as unknown as NonNullable<Calibration['affordableRoutes']>;
    it('throws on the calibration', () => {
      bad(mutated(affordable), text);
    });
    it('passes when the calibration has routes', () => {
      const input = mutated(affordable);
      input.calibration = { ...input.calibration, affordableRoutes: routes };
      expect(() => checkFinance(input)).not.toThrow();
    });
    it('checks newProjects.calibration when present', () => {
      const input = mutated(affordable);
      const cal = { ...input.calibration, affordableRoutes: routes };
      input.calibration = cal;
      input.newProjects = {
        calibration: { ...cal, affordableRoutes: undefined },
        scale: input.newProjects?.scale ?? ({} as never)
      };
      bad(input, text);
    });
  });
  it('the finance checks run once per finance object; the routes check every call', () => {
    const fin = tinyFinanceValid();
    let reads = 0;
    let slope = fin.slope;
    Object.defineProperty(fin, 'slope', {
      get() {
        reads++;
        return slope;
      },
      set(v: number) {
        slope = v;
      }
    });
    const input = withFinance(fin);
    checkFinance(input);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    checkFinance(input);
    expect(reads).toBe(afterFirst);
    fin.programmes[0].reach = 'affordable';
    expect(() => checkFinance(input)).toThrow(/no affordableRoutes/);
  });
});

describe('engine wiring', () => {
  it('throws before any sink call', () => {
    const calls: string[] = [];
    const input = mutated((f) => (f.slope = -1));
    expect(() =>
      runEngine(input, 1, GOLDEN_HORIZON, {
        schedule: () => void calls.push('schedule'),
        master: () => void calls.push('master'),
        ledger: () => void calls.push('ledger')
      } as never)
    ).toThrow(new RangeError('finance.slope must be a finite number of 0 or more; got -1'));
    expect(calls).toEqual([]);
  });
});
