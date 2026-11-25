import { describe, expect, it } from 'vitest';
import { CAR_LEVELS, typeCount, typeIndex } from '../../../src/lib/sim/cars';
import { MARGINS, typeBandsOf } from '../../lib/cars/config';
import {
  acsMargins,
  occupiedShares,
  pumsSeed,
  startPopulation,
  zoneHomes,
  type PumsRow
} from '../../lib/cars/population';

const row = (o: Partial<PumsRow>): PumsRow => ({
  puma: '07507',
  wgtp: 10,
  veh: 1,
  np: 2,
  workers: 1,
  hincp_adj: 80_000,
  ten: 3,
  ...o
});

/** A small PUMS sample over two PUMAs, varied on every margin. */
const ROWS: PumsRow[] = [
  row({ veh: 0, np: 1, workers: 0, hincp_adj: 9_000, ten: 3, wgtp: 12 }),
  row({ veh: 1, np: 1, workers: 1, hincp_adj: 70_000, ten: 3, wgtp: 20 }),
  row({ veh: 2, np: 3, workers: 2, hincp_adj: 210_000, ten: 1, wgtp: 9 }),
  row({ veh: 4, np: 5, workers: 2, hincp_adj: 400_000, ten: 2, wgtp: 4 }),
  row({ veh: 1, np: 2, workers: 1, hincp_adj: 130_000, ten: 1, wgtp: 15 }),
  row({ veh: 0, np: 2, workers: 0, hincp_adj: -500, ten: 4, wgtp: 7 }),
  row({ puma: '07508', veh: 1, np: 2, workers: 2, hincp_adj: 160_000, ten: 3, wgtp: 30 }),
  row({ puma: '07508', veh: 3, np: 4, workers: 2, hincp_adj: 260_000, ten: 1, wgtp: 11 })
];
const PUMAS = ['07507', '07508'];

/** ACS rows for one block group: B25044, B25009, B19001 and B25002 cells. */
function acs(geoid: string, cells: Record<string, number>) {
  return Object.entries(cells).map(([variable, estimate]) => ({ geoid, variable, estimate }));
}

describe('type bands and the PUMS seed', () => {
  it('cuts income at the weighted quartiles and gives 96 types', () => {
    const b = typeBandsOf(ROWS);
    expect(b.size).toEqual([1, 2, 3, 4]);
    expect(b.workers).toEqual([0, 1, 2]);
    expect(b.income).toHaveLength(4);
    expect(b.income[0]).toBe(0);
    for (let i = 1; i < 4; i++) expect(b.income[i]).toBeGreaterThan(b.income[i - 1]);
    expect(typeCount(b)).toBe(96);
  });

  it('classes each record on every margin, owners first', () => {
    const b = typeBandsOf(ROWS);
    const s = pumsSeed(ROWS, b, PUMAS);
    expect(Array.from(s.puma)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    expect(Array.from(s.level)).toEqual([0, 1, 2, 3, 1, 0, 1, 3]);
    expect(s.type[3]).toBe(typeIndex(b, 5, 2, 400_000, true));
    // Tenure by vehicles: owner 0-3, renter 4-7; tenure 4 (no rent paid) is a renter.
    expect(Array.from(s.classes[0])).toEqual([4, 5, 2, 3, 1, 4, 5, 3]);
    // Tenure by size (1, 2, 3, 4+).
    expect(Array.from(s.classes[1])).toEqual([4, 4, 2, 3, 1, 5, 5, 3]);
    // B19001 brackets: under 10k, 60-75k, 200k+, 200k+, 125-150k, under 10k, 150-200k, 200k+.
    expect(Array.from(s.classes[2])).toEqual([0, 10, 15, 15, 13, 0, 14, 15]);
    expect(MARGINS.map((m) => m.size)).toEqual([8, 8, 16]);
  });
});

describe('ACS margins and occupancy', () => {
  it('collapses ACS cells to the margin classes; a block group with no households has none', () => {
    const rows = [
      ...acs('A', {
        B25044_001: 10,
        B25044_003: 1,
        B25044_004: 2,
        B25044_006: 1,
        B25044_008: 1,
        B25044_010: 3,
        B25044_011: 2,
        B25009_001: 10,
        B25009_003: 5,
        B25009_009: 0,
        B25009_016: 5,
        B19001_001: 10,
        B19001_002: 4,
        B19001_017: 6,
        B25002_001: 12,
        B25002_002: 10
      }),
      ...acs('B', { B25044_001: 0, B25002_001: 4, B25002_002: 0 })
    ];
    const m = acsMargins(rows, ['A', 'B', 'C']);
    expect(Array.from(m[0][0]!)).toEqual([1, 2, 0, 2, 3, 2, 0, 0]);
    expect(Array.from(m[0][1]!)).toEqual([5, 0, 0, 0, 0, 0, 0, 5]);
    expect(m[0][2]![0]).toBe(4);
    expect(m[0][2]![15]).toBe(6);
    expect(m[1]).toEqual([null, null, null]);
    expect(m[2]).toEqual([null, null, null]);
    const occ = occupiedShares(rows, ['A', 'B', 'C']);
    expect(occ.occupied[0]).toBeCloseTo(10 / 12, 12);
    expect(occ.occupied[1]).toBe(0);
    // No B25002 total: the citywide share (10 / 16).
    expect(occ.occupied[2]).toBeCloseTo(10 / 16, 12);
    expect(occ.fallback).toBe(1);
  });
});

describe('startPopulation', () => {
  const bands = typeBandsOf(ROWS);
  const T = typeCount(bands);
  const seed = pumsSeed(ROWS, bands, PUMAS);
  // Lots: zone of each lot and its existing units; lot 4 is in no zone.
  const lotZone = Int32Array.from([0, 0, 1, 2, -1, 3]);
  const units = Uint16Array.from([12, 5, 40, 3, 100, 0]);
  const homes = zoneHomes(lotZone, units, 4);
  const occupied = Float64Array.from([0.9, 0.85, 1, 0.5]);
  const margins = [
    // Feasible on PUMA 0's records (weights 1, 2, 1, 1, 2, 2 meet both).
    [
      Float64Array.from([0, 2, 1, 1, 3, 2, 0, 0]),
      Float64Array.from([0, 2, 1, 1, 3, 2, 0, 0]),
      null
    ],
    [null, null, null],
    [Float64Array.from([0, 0, 0, 0, 1, 1, 0, 0]), null, null],
    [null, null, null]
  ];
  const zonePuma = Int32Array.from([0, 1, 0, 1]);
  const out = startPopulation({
    types: T,
    zonePuma,
    homes,
    occupied,
    seed,
    margins,
    ipf: { maxIter: 200, tol: 1e-9 }
  });

  it('sums each zone to round(occupied x homes), homes from existingUnits', () => {
    expect(Array.from(homes)).toEqual([17, 40, 3, 0]);
    for (let z = 0; z < 4; z++) {
      let sum = 0;
      for (let j = 0; j < T * CAR_LEVELS; j++) sum += out.households[z * T * CAR_LEVELS + j];
      expect(sum).toBe(Math.floor(occupied[z] * homes[z] + 0.5));
    }
  });

  it('gives non-negative integer counts of the right length', () => {
    expect(out.households).toHaveLength(4 * T * CAR_LEVELS);
    for (const h of out.households) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps households inside the classes the margins allow', () => {
    // Zone 2's tenure-by-vehicles margin is renters with 0 or 1 car only.
    const base = 2 * T * CAR_LEVELS;
    for (let t = 0; t < T; t++)
      for (let k = 0; k < CAR_LEVELS; k++) {
        const n = out.households[base + t * CAR_LEVELS + k];
        if (n === 0) continue;
        expect(t % 2).toBe(1); // renter
        expect(k).toBeLessThan(2);
      }
  });

  it('is deterministic', () => {
    const again = startPopulation({
      types: T,
      zonePuma,
      homes,
      occupied,
      seed,
      margins,
      ipf: { maxIter: 200, tol: 1e-9 }
    });
    expect(again.households).toEqual(out.households);
  });

  it('takes car-level targets in place of the B25044 tenure-by-vehicles margin', () => {
    // Zone 1 (PUMA 1: records at 1 and 3+ cars, weights 30 and 11) asked for 1 and 3+ in 1 : 3.
    const levels = [null, Float64Array.from([0, 1, 0, 3]), null, null];
    const r = startPopulation({
      types: T,
      zonePuma,
      homes,
      occupied,
      seed,
      margins: margins.map((m, z) =>
        z === 1 ? [Float64Array.from([0, 0, 0, 9, 0, 9, 0, 0]), null, null] : m
      ),
      levels,
      ipf: { maxIter: 200, tol: 1e-9 }
    });
    const lv = [0, 0, 0, 0];
    const base = T * CAR_LEVELS;
    for (let i = 0; i < T * CAR_LEVELS; i++) lv[i % CAR_LEVELS] += r.households[base + i];
    expect(lv).toEqual([0, 9, 0, 25]); // 34 households in 1 : 3, B25044's 1 : 1 replaced
    // The other zones are as without levels.
    expect(r.households.subarray(0, base)).toEqual(out.households.subarray(0, base));
  });

  it('reports the fit of each zone with margins', () => {
    expect(out.maxRelErr[0]).toBeLessThan(1e-6);
    expect(out.maxRelErr[1]).toBe(0);
    // Zone 1 has households but no margins; zone 3 has no homes.
    expect(out.seedOnly).toBe(1);
  });
});
