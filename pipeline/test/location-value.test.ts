import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTableFromRows, openDuck, type Duck } from '../lib/duck';
import { LOCATION_VALUE, locationValueByLot } from '../lib/location-value';

let db: Duck;

/** [lot id, neighbourhood or null]. */
const lots: [string, string | null][] = [
  ...Array.from({ length: 30 }, (_, i): [string, string] => [`a${i}`, 'High']),
  ['b0', 'Empty'],
  ['b1', 'Empty'],
  ...Array.from({ length: 31 }, (_, i): [string, string] => [`c${i}`, 'Mid']),
  ...Array.from({ length: 40 }, (_, i): [string, null] => [`y${i}`, null]),
  ['z0', null]
];

describe('locationValueByLot', () => {
  beforeAll(async () => {
    db = await openDuck();
    await db.run('CREATE TABLE report_counts(key VARCHAR, value DOUBLE)');
    await createTableFromRows(
      db,
      'parcels',
      [
        ['id', 'VARCHAR'],
        ['neighborhood', 'VARCHAR']
      ],
      lots
    );
    // [id, roll_year, units, year_built, land, impr]: the 2018 roll's citywide median is 1e6 per
    // home (31 Mid buildings at 1e6, 30 High at 2e6, all first assessed in 2018).
    const roll: [string, number, number, number, number, number][] = [
      ...Array.from({ length: 30 }, (_, i): [string, number, number, number, number, number][] => [
        // The roll of the completion year assesses a part-built building: never the first roll.
        [`a${i}`, 2017, 10, 2017, 500_000, 500_000],
        [`a${i}`, 2018, 10, 2017, 8_000_000, 12_000_000],
        // A later roll is not the first one after completion.
        [`a${i}`, 2019, 10, 2017, 1_000_000, 1_000_000]
      ]).flat(),
      // Built before 2015: excluded, so Empty has no building.
      ['b0', 2013, 10, 2012, 50_000_000, 50_000_000],
      ...Array.from({ length: 31 }, (_, i): [string, number, number, number, number, number] => [
        `c${i}`,
        2018,
        4,
        2016,
        1_000_000,
        3_000_000
      ]),
      // First assessed in 2016 (no neighbourhood): their 2018 rows are not first rolls, so they
      // never enter the 2018 median.
      ...Array.from({ length: 40 }, (_, i): [string, number, number, number, number, number][] => [
        [`y${i}`, 2016, 1, 2015, 500_000, 500_000],
        [`y${i}`, 2018, 1, 2015, 5_000_000, 5_000_000]
      ]).flat()
    ];
    await createTableFromRows(
      db,
      'sc_roll_agg',
      [
        ['id', 'VARCHAR'],
        ['roll_year', 'INTEGER'],
        ['units', 'INTEGER'],
        ['year_built', 'INTEGER'],
        ['land', 'DOUBLE'],
        ['impr', 'DOUBLE'],
        ['hotel', 'BOOLEAN'],
        ['status_n', 'BOOLEAN']
      ],
      roll.map((r) => [...r, false, false])
    );
  });
  afterAll(() => db?.close());

  it('indexes new buildings by their first roll and shrinks each neighbourhood to 1', async () => {
    expect(LOCATION_VALUE).toEqual({ minYearBuilt: 2015, shrink: 10 });
    const lv = await locationValueByLot(db);
    expect(lv.byNeighborhood).toEqual([
      { nhood: 'Empty', n: 0, raw: 1, shrunk: 1 },
      { nhood: 'High', n: 30, raw: 2, shrunk: (2 * 30 + 10) / 40 },
      { nhood: 'Mid', n: 31, raw: 1, shrunk: 1 }
    ]);
    expect(lv.locationValue.size).toBe(lots.length);
    expect(lv.locationValue.get('a0')).toBeCloseTo(1.75, 12);
    expect(lv.locationValue.get('a29')).toBeCloseTo(1.75, 12);
    expect(lv.locationValue.get('b0')).toBe(1);
    expect(lv.locationValue.get('b1')).toBe(1);
    expect(lv.locationValue.get('c0')).toBe(1);
    // A lot with no neighbourhood takes the citywide figure.
    expect(lv.locationValue.get('z0')).toBe(1);
  });

  it('flags the shrinkage constant as invented and counts buildings and thin areas', async () => {
    const lv = await locationValueByLot(db);
    expect(lv.provenance.tier).toBe(2);
    expect(lv.provenance.n).toBe(101);
    expect(lv.provenance.label).toMatch(/invented/);
    expect(lv.provenance.sources.map((s) => s.url)).toEqual([
      'https://data.sf.gov/d/wv5m-vpq2',
      'https://data.sf.gov/d/j2bu-swwd'
    ]);
    const counts = await db.all<{ key: string; value: number }>(
      "SELECT key, value FROM report_counts WHERE key LIKE 'locationValue.%' ORDER BY key"
    );
    // Two runs in this file: each run replaces its own counts.
    expect(counts).toEqual([
      { key: 'locationValue.buildings', value: 101 },
      { key: 'locationValue.neighborhoods', value: 3 },
      { key: 'locationValue.thin', value: 1 }
    ]);
  });
});
