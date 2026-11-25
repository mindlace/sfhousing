import { describe, expect, it } from 'vitest';
import { typeCount, typeIndex, type TypeBands } from '../../../src/lib/sim/cars';
import type { AmiFile } from '../../enrichment/ami-schema';
import type { CpiFile } from '../../enrichment/cpi-schema';
import type { ParkingFile, SfCost } from '../../enrichment/parking-schema';
import {
  MIN_CELL_RECORDS,
  builtFromCutoff,
  moveRates,
  newHomeMixes,
  parkingOf,
  type CostIndex,
  type MoverRow
} from '../../lib/cars/rates';

const BANDS: TypeBands = { size: [1, 2], workers: [0], income: [0, 100_000] };
const T = typeCount(BANDS);
const PUMAS = ['07507', '07508'];

function row(p: Partial<MoverRow>): MoverRow {
  return {
    puma: '07507',
    wgtp: 1,
    veh: 1,
    np: 1,
    workers: 0,
    hincp_adj: 50_000,
    ten: 3,
    mv: 4,
    ybl: 1990,
    ybl_src: 'YRBLT',
    ...p
  };
}
const many = (n: number, p: Partial<MoverRow>) => Array.from({ length: n }, () => row(p));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const monthly = (p: number) => 1 - Math.exp(Math.log(1 - p) / 12);

describe('moveRates', () => {
  // Owner, size 1, low income: 40 records, 10 movers of weight 3 and 30 stayers of weight 1.
  const ownA = typeIndex(BANDS, 1, 0, 50_000, true);
  // Renter, size 1, low income: 50 records, 25 movers; renter, size 2: 10 records, no mover.
  const rentA = typeIndex(BANDS, 1, 0, 50_000, false);
  const rentB = typeIndex(BANDS, 2, 0, 50_000, false);
  const rows = [
    ...many(10, { ten: 1, mv: 1, wgtp: 3 }),
    ...many(30, { ten: 2, mv: 5 }),
    ...many(25, { ten: 3, mv: 1, puma: '07508' }),
    ...many(25, { ten: 3, mv: 3 }),
    ...many(10, { ten: 3, mv: 2, np: 2 })
  ];
  const r = moveRates(rows, BANDS, PUMAS, ['2020-01-01', '2024-12-31']);

  it('turns the weighted share moved in within 12 months into a monthly rate', () => {
    expect(r.moves.perMonth).toHaveLength(T);
    expect(r.moves.perMonth[ownA]).toBeCloseTo(monthly(0.5), 12);
    expect(r.moves.perMonth[rentA]).toBeCloseTo(monthly(0.5), 12);
  });

  it('falls back to the tenure rate where a type has fewer than 30 records, and says so', () => {
    expect(MIN_CELL_RECORDS).toBe(30);
    expect(r.moves.perMonth[rentB]).toBeCloseTo(monthly(25 / 60), 12);
    expect(r.stats.tenure.renter.annual).toBeCloseTo(25 / 60, 12);
    expect(r.stats.tenure.owner.annual).toBeCloseTo(0.5, 12);
    // Every type but ownA and rentA takes its tenure's rate.
    expect(r.stats.fallback).toBe(T - 2);
    const ownB = typeIndex(BANDS, 2, 0, 50_000, true);
    expect(r.moves.perMonth[ownB]).toBeCloseTo(monthly(0.5), 12);
  });

  it('gives each PUMA its movers type mix, each row summing to 1', () => {
    expect(r.moves.inMix).toHaveLength(PUMAS.length);
    for (const m of r.moves.inMix) {
      expect(m).toHaveLength(T);
      expect(sum(m)).toBeCloseTo(1, 12);
    }
    // 07507: owner movers weight 30; 07508: renter movers weight 25.
    expect(r.moves.inMix[0][ownA]).toBeCloseTo(1, 12);
    expect(r.moves.inMix[1][rentA]).toBeCloseTo(1, 12);
    expect(r.moves.provenance.n).toBe(rows.length);
    expect(r.warnings).toEqual([]);
  });

  it('gives a PUMA with no mover the citywide movers mix, with a warning', () => {
    const x = moveRates(
      rows.filter((q) => q.puma === '07507'),
      BANDS,
      PUMAS,
      ['2020-01-01', '2024-12-31']
    );
    expect(x.moves.inMix[1]).toEqual(x.moves.inMix[0]);
    expect(x.stats.pumaFallback).toEqual(['07508']);
    expect(x.warnings.join(' ')).toMatch(/07508/);
  });
});

describe('builtFromCutoff', () => {
  it('takes the latest built-year code edge at or before release - 10', () => {
    // YRBLT (2020-2024 file): decades to 2010-2019, single years from 2020.
    expect(builtFromCutoff(2024, 'YRBLT')).toEqual({ code: 2010, year: 2010 });
    // YBL (2009-2013 file): 8 = 2000-2004, 9 = 2005, ..., 17 = 2013.
    expect(builtFromCutoff(2013, 'YBL')).toEqual({ code: 8, year: 2000 });
    expect(builtFromCutoff(2018, 'YBL')).toEqual({ code: 12, year: 2008 });
    expect(() => builtFromCutoff(2024, 'XYZ')).toThrow(/XYZ/);
  });
});

describe('newHomeMixes', () => {
  // AMI 2024: 1 person 100,000; 2 persons 120,000. 2013: 100,000 and 110,000.
  const ami: AmiFile = {
    years: [
      { year: 2013, bySize: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => 90_000 + 10_000 * i) },
      {
        year: 2024,
        bySize: [100_000, 120_000, 130_000, 140_000, 150_000, 160_000, 170_000, 180_000]
      }
    ],
    sources: [
      { label: 'AMI', url: 'https://example.invalid/ami', page: 'p. 1', accessed: '2026-11-24' }
    ]
  };
  const vl = typeIndex(BANDS, 1, 0, 40_000, false); // 40% AMI
  const lo = typeIndex(BANDS, 1, 0, 70_000, true); // 70% AMI
  const mo = typeIndex(BANDS, 2, 0, 100_000, false); // 83% AMI at size 2
  const hi = typeIndex(BANDS, 2, 0, 200_000, true);
  const rows = [
    row({ mv: 1, ybl: 2015, hincp_adj: 40_000, ten: 3 }),
    row({ mv: 1, ybl: 2021, hincp_adj: 70_000, ten: 1 }),
    row({ mv: 1, ybl: 2010, hincp_adj: 100_000, np: 2, ten: 3, wgtp: 2 }),
    row({ mv: 1, ybl: 2022, hincp_adj: 200_000, np: 2, ten: 1, wgtp: 4 }),
    // Not counted: a mover into an older home, a stayer in a new one.
    row({ mv: 1, ybl: 2000, hincp_adj: 40_000, wgtp: 50 }),
    row({ mv: 3, ybl: 2020, hincp_adj: 40_000, wgtp: 50 })
  ];
  const tiers = { veryLow: 2, low: 1, moderate: 1 };
  const r = newHomeMixes(rows, BANDS, ami, tiers, {
    release: 2024,
    window: ['2020-01-01', '2024-12-31']
  });

  it('mixes recent movers into homes built in the last decade the codes allow', () => {
    const m = r.newHomes.mix.market;
    expect(m).toHaveLength(T);
    expect(m[vl]).toBeCloseTo(1 / 8, 12);
    expect(m[lo]).toBeCloseTo(1 / 8, 12);
    expect(m[mo]).toBeCloseTo(2 / 8, 12);
    expect(m[hi]).toBeCloseTo(4 / 8, 12);
    expect(r.stats.builtFrom).toBe(2010);
    expect(r.stats.records.market).toBe(4);
  });

  it("restricts each tier's mix to incomes at or below its AMI bound for the size", () => {
    const { veryLow, low, moderate } = r.newHomes.mix;
    expect(veryLow[vl]).toBeCloseTo(1, 12);
    expect(low[vl]).toBeCloseTo(0.5, 12);
    expect(low[lo]).toBeCloseTo(0.5, 12);
    expect(moderate[vl]).toBeCloseTo(0.25, 12);
    expect(moderate[lo]).toBeCloseTo(0.25, 12);
    expect(moderate[mo]).toBeCloseTo(0.5, 12);
    for (const k of ['market', 'veryLow', 'low', 'moderate'] as const)
      expect(sum(r.newHomes.mix[k])).toBeCloseTo(1, 12);
    expect(r.stats.amiYear).toBe(2024);
  });

  it("renormalises the dataset's affordable completions by tier", () => {
    expect(r.newHomes.affordableTiers).toEqual({ veryLow: 0.5, low: 0.25, moderate: 0.25 });
    expect(r.stats.tiersFrom).toBe('projects');
    expect(r.warnings).toEqual([]);
  });

  it('splits the PUMS new-home movers at or below moderate by tier when completions sum to 0', () => {
    const z = newHomeMixes(
      rows,
      BANDS,
      ami,
      { veryLow: 0, low: 0, moderate: 0 },
      { release: 2024, window: ['2020-01-01', '2024-12-31'] }
    );
    // Weights: 40k (1) very low, 70k (1) low, 100k at size 2 (2) moderate.
    expect(z.newHomes.affordableTiers.veryLow).toBeCloseTo(0.25, 12);
    expect(z.newHomes.affordableTiers.low).toBeCloseTo(0.25, 12);
    expect(z.newHomes.affordableTiers.moderate).toBeCloseTo(0.5, 12);
    expect(z.stats.tiersFrom).toBe('pums');
    expect(z.warnings.join(' ')).toMatch(/sum to 0/);
  });

  it('drops the built-year limit, with a warning, for a tier with no new-home record', () => {
    const z = newHomeMixes(
      rows.filter((q) => q.hincp_adj !== 40_000 || q.ybl === 2000),
      BANDS,
      ami,
      tiers,
      { release: 2024, window: ['2020-01-01', '2024-12-31'] }
    );
    expect(z.newHomes.mix.veryLow[vl]).toBeCloseTo(1, 12);
    expect(z.stats.allHomes).toEqual(['veryLow']);
    expect(z.warnings.join(' ')).toMatch(/veryLow/);
  });

  it('reads YBL codes in an older file', () => {
    const old = [
      row({ mv: 1, ybl: 8, ybl_src: 'YBL', hincp_adj: 40_000 }),
      row({ mv: 1, ybl: 7, ybl_src: 'YBL', hincp_adj: 200_000, np: 2, ten: 1 })
    ];
    const z = newHomeMixes(old, BANDS, ami, tiers, {
      release: 2013,
      window: ['2009-01-01', '2013-12-31']
    });
    expect(z.newHomes.mix.market[vl]).toBeCloseTo(1, 12);
    expect(z.stats.builtFrom).toBe(2000);
    // The AMI year is the release's: with no year at or before it, the build stops.
    expect(() =>
      newHomeMixes(old, BANDS, { ...ami, years: ami.years.slice(1) }, tiers, {
        release: 2013,
        window: ['2009-01-01', '2013-12-31']
      })
    ).toThrow(/AMI/);
  });
});

describe('parkingOf', () => {
  const cite = {
    label: 'SF source',
    url: 'https://example.invalid/sf.pdf',
    page: 'p. 1',
    accessed: '2026-11-24',
    sf: true as const
  };
  const cost = (value: number, dollarsYear: number): SfCost => ({
    value,
    dollarsYear,
    sources: [cite],
    method: 'as stated'
  });
  const supplyOverUse: ParkingFile['supplyOverUse'] = {
    value: 1.4,
    tier: 3,
    sources: [
      {
        label: 'King County',
        url: 'https://example.invalid/rsp.pdf',
        page: 'p. 7',
        accessed: '2026-11-24'
      }
    ],
    method: 'literature'
  };
  const index: CostIndex = {
    source: {
      label: 'Controller',
      url: 'https://example.invalid/oea.pdf',
      retrieved: '2026-11-09'
    },
    costIndex: { locator: 'slide 16', values: { '2012': 98.2, '2016': 100, '2023': 112.3 } }
  };
  // CPI-U annual averages; 2026 not yet published, so the prototypes' year takes 2025's.
  const cpi: CpiFile = {
    seriesId: 'CUURS49BSA0',
    annual: { '2012': 240, '2016': 266, '2023': 339, '2025': 356 },
    sources: [
      {
        label: 'BLS',
        url: 'https://data.bls.gov/timeseries/CUURS49BSA0',
        page: 'M13',
        accessed: '2026-11-25'
      }
    ],
    method: 'annual averages'
  };
  const P = 2026;
  const toP = (v: number, y: number, i: number) =>
    Math.round(((v * 112.3) / i) * (356 / cpi.annual[String(y)]));
  const file = (c: ParkingFile['costPerSpace']): ParkingFile => ({
    costPerSpace: c,
    supplyOverUse,
    searched: ['Controller 2026']
  });

  it('keeps the link off when the file has no cost', () => {
    const r = parkingOf(file(null), index, cpi, P);
    expect(r.parking.costPerSpace).toBeNull();
    expect(r.parking.dollarsYear).toBeNull();
    expect(r.parking.supplyOverUse).toBe(1.4);
    expect(r.parking.provenance[0].tier).toBe(3);
    expect(r.warnings).toEqual([]);
  });

  it("brings every cost to the prototypes' nominal dollars: real cost index, then CPI", () => {
    const r = parkingOf(
      file({
        surface: cost(10_000, 2023),
        podium: cost(28_700, 2012),
        belowGrade: cost(80_000, 2016)
      }),
      index,
      cpi,
      P
    );
    expect(r.parking.dollarsYear).toBe(P);
    expect(r.parking.costPerSpace).toEqual({
      surface: toP(10_000, 2023, 112.3),
      podium: toP(28_700, 2012, 98.2),
      belowGrade: toP(80_000, 2016, 100)
    });
    // The real index is held flat after 2023; CPI(2026) is not out, so 2025 stands in, stated.
    expect(r.stats.cpiYear).toBe(2025);
    expect(r.stats.costs?.find((c) => c.type === 'belowGrade')?.cpiFactor).toBeCloseTo(
      356 / 266,
      12
    );
    expect(r.parking.provenance).toHaveLength(4);
    expect(r.parking.provenance[2].method).toMatch(/CUURS49BSA0/);
    expect(r.warnings).toEqual([]);
  });

  it('uses P itself when its CPI annual average is published', () => {
    const r = parkingOf(
      file({ surface: null, podium: null, belowGrade: cost(80_000, 2016) }),
      index,
      { ...cpi, annual: { ...cpi.annual, '2026': 370 } },
      P
    );
    expect(r.stats.cpiYear).toBe(2026);
    expect(r.parking.costPerSpace?.belowGrade).toBe(
      Math.round(((80_000 * 112.3) / 100) * (370 / 266))
    );
  });

  it('prices only the types with a cost, and warns that the others get none', () => {
    const r = parkingOf(
      file({ surface: null, podium: cost(28_700, 2012), belowGrade: cost(80_000, 2016) }),
      index,
      cpi,
      P
    );
    expect(r.parking.costPerSpace?.surface).toBeNull();
    expect(r.parking.costPerSpace?.belowGrade).toBe(toP(80_000, 2016, 100));
    expect(r.warnings.join(' ')).toMatch(/surface/);
  });

  it('refuses a cost dated before the index or without a CPI year', () => {
    expect(() =>
      parkingOf(
        file({ surface: null, podium: cost(28_700, 2001), belowGrade: null }),
        index,
        cpi,
        P
      )
    ).toThrow(/2001/);
    const noCpi = { ...cpi, annual: { '2016': 266, '2025': 356 } };
    expect(() =>
      parkingOf(
        file({ surface: null, podium: cost(28_700, 2012), belowGrade: null }),
        index,
        noCpi,
        P
      )
    ).toThrow(/CPI/);
  });
});
