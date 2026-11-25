import { describe, expect, it } from 'vitest';
import type { CarData } from '../../../src/lib/data/cars-codec';
import {
  CAR_LEVELS,
  carShares,
  splitSystematic,
  typeCount,
  type CarModel
} from '../../../src/lib/sim/cars';
import type { ProjectHistory } from '../../../src/lib/timelapse/types';
import {
  HELD_OUT_THROUGH,
  chainXwalk,
  crosswalkRows,
  h044AsB25044,
  historyFlows,
  noCarShare,
  runBackcast,
  xwalkOf,
  type AcsRelease,
  type BackcastInput,
  type BackcastModel,
  type PumsRelease
} from '../../lib/cars/backcast';
import type { AcsRow } from '../../lib/cars/population';
import { backcastReportLines } from '../../lib/cars/report';

const BANDS = { size: [1], workers: [0], income: [0] };
const T = typeCount(BANDS); // 2: owner, renter
const ZONES = ['060750101001', '060750102001'];
const PER_ZONE = 20_000;
const PROV = { tier: 4 as const, label: 'test', sources: [], method: 'synthetic' };

// Equal move rates and a 50/50 refill keep the type mix at the start's 50/50.
function model(perMonth = [0.015, 0.015]): CarModel {
  return {
    schema: 1,
    bands: BANDS,
    choice: {
      asc: [0, -1, -2],
      household: [0, 0, 0, 0.5, 0.2, 0],
      location: { density: [0, 0, 0], access: [0, 0, 0] },
      terms: [],
      provenance: PROV
    },
    threePlusMean: 3.2,
    moves: {
      perMonth,
      provenance: PROV
    },
    newHomes: {
      mix: { market: [0.5, 0.5], veryLow: [0, 1], low: [0, 1], moderate: [0.5, 0.5] },
      affordableTiers: { veryLow: 0.4, low: 0.3, moderate: 0.3 },
      provenance: PROV
    },
    parking: { supplyOverUse: 1, costPerSpace: null, dollarsYear: null, provenance: [] },
    refreshMonths: 12
  };
}

/** Each zone's households half owner, half renter, each split over car levels by the table. */
function equilibrium(m: CarModel): { data: CarData; carless: number } {
  const Z = ZONES.length;
  const base: CarData = {
    zones: ZONES,
    pumas: ['07507'],
    zonePuma: new Int32Array(Z),
    lotZone: Int32Array.from([0, 1]),
    areaM2: Float64Array.from([1e6, 1e6]),
    occupied: Float64Array.from([1, 1]),
    access: new Float64Array(Z),
    constant: new Float64Array(Z * 3),
    types: T,
    households: new Int32Array(Z * T * CAR_LEVELS)
  };
  const shares = new Float64Array(CAR_LEVELS);
  const out = new Int32Array(CAR_LEVELS);
  let carless = 0;
  for (let z = 0; z < Z; z++)
    for (let t = 0; t < T; t++) {
      // Density is households per hectare: 20,000 on 100 ha.
      carShares(m, base, z, t, PER_ZONE / 100, shares);
      splitSystematic(PER_ZONE / T, shares, 0.5, out);
      base.households.set(out, (z * T + t) * CAR_LEVELS);
      carless += 0.5 * shares[0];
    }
  return { data: base, carless: carless / Z };
}

const rel = (year: number): AcsRelease => ({
  year,
  rows: ZONES.flatMap((geoid) => [
    { geoid, variable: 'B25044_001', estimate: 100 },
    { geoid, variable: 'B25044_003', estimate: 10 },
    { geoid, variable: 'B25044_010', estimate: 20 }
  ]),
  city: { households: 200, carless: 60 }
});
const RELEASES = [2009, 2010, 2013, 2019, 2024].map(rel);
const PUMS: PumsRelease[] = [
  { release: 2013, rows: [] },
  { release: 2024, rows: [] }
];

function input(over: Partial<BackcastInput> = {}): BackcastInput {
  const m = model();
  const { data } = equilibrium(m);
  return {
    seed: 7,
    start: { year: 2000, month: 4 },
    endYear: 2024,
    zones: ZONES,
    startObserved: 0.3,
    releases: RELEASES,
    pums: PUMS,
    fit: () => ({ model: m, data }),
    flows: [],
    access: [{ year: 2000, access: new Float64Array(2) }],
    ...over
  };
}

describe('runBackcast', () => {
  it('keeps the share with no car at the model equilibrium with no completions and fixed access', () => {
    const m = model();
    const { carless } = equilibrium(m);
    const r = runBackcast(input());
    expect(r.start).toBe(2000);
    expect(r.years.map((y) => y.year)).toEqual([2000, 2009, 2010, 2013, 2019, 2024]);
    for (const y of r.years) expect(Math.abs(y.predicted - carless)).toBeLessThan(0.002);
    for (const s of r.series) expect(s.households).toBe(2 * PER_ZONE);
    expect(r.unmatched).toBe(0);
    // The release's own observed share, citywide.
    expect(r.years[1].observed).toBeCloseTo(0.3, 12);
  });

  it('adds 100 households in the month 100 homes complete in zone 1 (year 2)', () => {
    const r = runBackcast(input({ flows: [{ month: 13, zone: 1, mix: 0, homes: 100 }] }));
    expect(r.series[13].households - r.series[12].households).toBe(100);
    expect(r.series[12].households).toBe(2 * PER_ZONE);
    expect(r.series.at(-1)!.households).toBe(2 * PER_ZONE + 100);
  });

  it('removes the households of homes lost at a construction start', () => {
    const r = runBackcast(input({ flows: [{ month: 5, zone: 0, mix: -1, homes: 40 }] }));
    expect(r.series[5].households - r.series[4].households).toBe(-40);
  });

  it('fits the held-out model on releases and PUMS through 2009-2013 only', () => {
    const calls: { acs: number[]; pums: number[] }[] = [];
    const base = input();
    const fit: BackcastInput['fit'] = (o) => {
      calls.push({ acs: o.acs.map((a) => a.year), pums: o.pums.map((p) => p.release) });
      return base.fit(o);
    };
    const r = runBackcast({ ...base, fit });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ acs: [2009, 2010, 2013, 2019, 2024], pums: [2013, 2024] });
    expect(calls[1]).toEqual({ acs: [2009, 2010, 2013], pums: [2013] });
    expect(Math.max(...calls[1].acs, ...calls[1].pums)).toBeLessThanOrEqual(HELD_OUT_THROUGH);
    expect(r.heldOut.fitThrough).toBe(2013);
    expect(r.heldOut.year).toBe(2024);
    expect(r.heldOut.observed).toBeCloseTo(0.3, 12);
    expect(r.heldOutYears).toHaveLength(RELEASES.length);
  });

  it('gives the same result for the same seed, and a different path for another', () => {
    const flows = [
      { month: 3, zone: 0, mix: 0, homes: 37 },
      { month: 30, zone: 1, mix: 1, homes: 55 },
      { month: 31, zone: 1, mix: -1, homes: 12 }
    ];
    const a = runBackcast(input({ flows }));
    const b = runBackcast(input({ flows }));
    expect(b).toEqual(a);
    const c = runBackcast(input({ flows, seed: 8 }));
    expect(c.series.map((s) => s.carless)).not.toEqual(a.series.map((s) => s.carless));
  });

  it('reads access by year: a car-repelling access from 2010 lowers the later shares', () => {
    const m = model();
    m.choice.location.access = [-0.5, -0.5, -0.5];
    const { data } = equilibrium(m);
    const fit = (): BackcastModel => ({ model: m, data });
    const two = Float64Array.from([2, 2]);
    const r = runBackcast(
      input({
        fit,
        access: [
          { year: 2000, access: new Float64Array(2) },
          { year: 2010, access: two }
        ]
      })
    );
    const y2009 = r.years.find((y) => y.year === 2009)!;
    const y2024 = r.years.find((y) => y.year === 2024)!;
    expect(y2024.predicted).toBeGreaterThan(y2009.predicted + 0.05);
  });

  it('compares tracts of the latest release and zone subsets', () => {
    const r = runBackcast(input({ subsets: [{ name: 'zone 0', zones: Uint8Array.from([1, 0]) }] }));
    expect(r.tracts.map((t) => t.tract)).toEqual(['06075010100', '06075010200']);
    expect(r.tracts[0].observed).toBeCloseTo(0.3, 12);
    expect(r.tracts[0].households).toBe(100);
    expect(r.subsets[0].name).toBe('zone 0');
    expect(r.subsets[0].years).toHaveLength(RELEASES.length);
    expect(r.subsets[0].years[0].observed).toBeCloseTo(0.3, 12);
  });
});

describe('crosswalks', () => {
  it('chains 2000 to 2010 to 2020 and moves cells by the weights', () => {
    const a = xwalkOf([
      { from: 'A', to: 'x', weight: 0.75 },
      { from: 'A', to: 'y', weight: 0.25 }
    ]);
    const b = xwalkOf([
      { from: 'x', to: 'P', weight: 1 },
      { from: 'y', to: 'P', weight: 0.5 },
      { from: 'y', to: 'Q', weight: 0.5 }
    ]);
    const c = chainXwalk(a, b);
    expect(c.get('A')).toEqual([
      { to: 'P', weight: 0.875 },
      { to: 'Q', weight: 0.125 }
    ]);
    const rows: AcsRow[] = [{ geoid: 'A', variable: 'B25044_001', estimate: 800 }];
    expect(crosswalkRows(rows, c)).toEqual([
      { geoid: 'P', variable: 'B25044_001', estimate: 700 },
      { geoid: 'Q', variable: 'B25044_001', estimate: 100 }
    ]);
  });

  it('reads SF3 H044 as B25044 and counts households with no car', () => {
    const rows = h044AsB25044([
      { geoid: 'A', variable: 'H044001', value: 516 },
      { geoid: 'A', variable: 'H044003', value: 6 },
      { geoid: 'A', variable: 'H044010', value: 214 },
      { geoid: 'A', variable: 'P001001', value: 1 }
    ]);
    expect(rows.map((r) => r.variable)).toEqual(['B25044_001', 'B25044_003', 'B25044_010']);
    expect(noCarShare(rows, ['A'])).toEqual({ households: 516, carless: 220 });
  });
});

describe('historyFlows', () => {
  const day = (y: number, m: number, d = 15) => Date.UTC(y, m - 1, d) / 86_400_000;
  const h = (p: Partial<ProjectHistory>): ProjectHistory => ({
    id: 'BP:1',
    pathway: 'permitOnly',
    parcelIds: ['p1'],
    entered: {},
    end: { kind: 'complete', day: day(2002, 4) },
    unitsAt: { permitFiled: 10, complete: 12 },
    existingUnits: 0,
    storiesProposed: null,
    baseStoriesAtFiling: null,
    sources: [],
    quality: [],
    planningProposed: null,
    ...p
  });
  const lots = new Map([
    ['p1', 0],
    ['p2', 1]
  ]);
  const lotZone = Int32Array.from([1, -1]);
  const tiers = { veryLow: 0.5, low: 0.5, moderate: 0 };

  it('places completions and losses in their month at the first lot zone', () => {
    const { flows, stats } = historyFlows(
      [
        h({}),
        h({
          id: 'BP:2',
          entered: { construction: day(2001, 1) },
          existingUnits: 4,
          end: { kind: 'open', lastObserved: day(2003, 1) }
        }),
        h({ id: 'BP:3', end: { kind: 'complete', day: day(1999, 6) } }),
        h({ id: 'BP:4', parcelIds: ['p2'] }),
        h({ id: 'BP:5', planningProposed: { units: 12, affordable: 4 } })
      ],
      lots,
      lotZone,
      { year: 2000, month: 4 },
      2024,
      tiers
    );
    // April 2002 is month 25 after the April 2000 start; January 2001 month 10.
    expect(flows).toEqual([
      { month: 10, zone: 1, mix: -1, homes: 4 },
      { month: 25, zone: 1, mix: 0, homes: 12 },
      { month: 25, zone: 1, mix: 0, homes: 8 },
      { month: 25, zone: 1, mix: 1, homes: 2 },
      { month: 25, zone: 1, mix: 2, homes: 2 }
    ]);
    expect(stats).toEqual({
      completions: 3,
      homes: 36,
      affordableHomes: 4,
      lost: 4,
      unplacedHomes: 12,
      unplacedLost: 0
    });
  });
});

describe('backcastReportLines', () => {
  it('prints the table with the published readings, the held-out row and the gate note', () => {
    const r = runBackcast(input({ subsets: [{ name: 'nested', zones: Uint8Array.from([1, 0]) }] }));
    const lines = backcastReportLines(r, {
      start: { households: 40_000, bgs: 2 },
      nested: { bgs: 1, zones: 1, totalZones: 2 },
      flows: {
        completions: 0,
        homes: 0,
        affordableHomes: 0,
        lost: 0,
        unplacedHomes: 0,
        unplacedLost: 0
      },
      access: [
        { year: 2000, sourceYear: 2009, sources: { muni: 2009 } },
        { year: 2020, sourceYear: 2020, sources: { muni: 2020 } }
      ],
      heldOut: { pumsRecords: 10, pumsHouseholds: 100, acs: 2013 }
    });
    const md = lines.join('\n');
    expect(md).toContain('| 2000 (SF3) | 30.0% | 28.6% |');
    expect(md).toMatch(/\| 2005-2009 \| 30\.0% \| 29\.8% \| [0-9.]+% \|/);
    expect(md).toContain('for 2020-2024 against 30.0% observed');
    expect(md).toContain('2000 (2009)');
    expect(md).toContain('COVID');
    expect(md).toContain('build gate (like V28) is for the owner');
    expect(md).toContain('| Release | Nested: ACS |');
    expect(md).not.toMatch(/NaN|undefined|Infinity/);
  });
});
