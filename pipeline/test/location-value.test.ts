import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTableFromRows, openDuck, type Duck } from '../lib/duck';
import { LOCATION_VALUE, locationValueByLot } from '../lib/location-value';

let db: Duck;

const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);

/** [lot id, neighbourhood or null]. */
const lots: [string, string | null][] = [
  ...ids('a', 30).map((id): [string, string] => [id, 'High']),
  ...['b0', 'b1', 'n0', ...ids('s', 15)].map((id): [string, string] => [id, 'Empty']),
  ...ids('c', 32).map((id): [string, string] => [id, 'Mid']),
  ['f0', 'Five'],
  ...ids('p', 3).map((id): [string, string] => [id, 'Pool']),
  ...[...ids('y', 40), ...ids('q', 10), ...ids('r', 10), 'z0'].map((id): [string, null] => [
    id,
    null
  ])
];

/** [id, roll_year, units, year_built, land + impr, floor_area_m2]. */
type Row = [string, number, number, number, number, number];

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
    // The 2018 roll: 32 Mid buildings at 10,000 per m² and 31 (High and Five) at 20,000, so its
    // median is 10,000 per m².
    const roll: Row[] = [
      ...ids('a', 30).flatMap((id): Row[] => [
        // The roll of the completion year assesses a part-built building: never the first roll.
        [id, 2017, 10, 2017, 1_000_000, 2000],
        // 20,000 per m² but 4e6 per home: 8 times Mid per home, twice per m².
        [id, 2018, 10, 2017, 40_000_000, 2000],
        // A later roll is not the first one after completion.
        [id, 2019, 10, 2017, 2_000_000, 2000]
      ]),
      // Built before 2015, under 5 homes, or with no floor area: left out, so Empty has none.
      ['b0', 2013, 10, 2012, 100_000_000, 1000],
      ...ids('s', 15).map((id): Row => [id, 2018, 4, 2016, 100_000_000, 400]),
      ['n0', 2018, 10, 2016, 10_000_000, 0],
      // 10,000 per m², 0.5e6 per home.
      ...ids('c', 32).map((id): Row => [id, 2018, 20, 2016, 10_000_000, 1000]),
      // Exactly 5 homes counts.
      ['f0', 2018, 5, 2016, 10_000_000, 500],
      // First assessed in 2016 (no neighbourhood): their 2018 rows never enter the 2018 median.
      ...ids('y', 40).flatMap((id): Row[] => [
        [id, 2016, 10, 2015, 1_000_000, 100],
        [id, 2018, 10, 2015, 10_000_000, 100]
      ]),
      // 2020 has 3 buildings (Pool, 30,000 per m²), under 10: its reference pools 2019 to 2021,
      // whose 20 buildings sit at 10,000 per m².
      ...ids('q', 10).map((id): Row => [id, 2019, 10, 2018, 10_000_000, 1000]),
      ...ids('p', 3).map((id): Row => [id, 2020, 10, 2019, 30_000_000, 1000]),
      ...ids('r', 10).map((id): Row => [id, 2021, 10, 2020, 10_000_000, 1000])
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
        ['floor_area_m2', 'DOUBLE'],
        ['hotel', 'BOOLEAN'],
        ['status_n', 'BOOLEAN']
      ],
      roll.map(([id, y, u, b, v, a]) => [id, y, u, b, v / 4, (v * 3) / 4, a, false, false])
    );
  });
  afterAll(() => db?.close());

  it('indexes value per m² of new multi-home buildings by year and shrinks to 1', async () => {
    expect(LOCATION_VALUE).toEqual({ minYearBuilt: 2015, minHomes: 5, poolMinN: 10, shrink: 10 });
    const lv = await locationValueByLot(db);
    expect(lv.byNeighborhood).toEqual([
      { nhood: 'Empty', n: 0, raw: 1, shrunk: 1 },
      { nhood: 'Five', n: 1, raw: 2, shrunk: (2 + 10) / 11 },
      { nhood: 'High', n: 30, raw: 2, shrunk: (2 * 30 + 10) / 40 },
      { nhood: 'Mid', n: 32, raw: 1, shrunk: 1 },
      { nhood: 'Pool', n: 3, raw: 3, shrunk: (3 * 3 + 10) / 13 }
    ]);
    expect(lv.locationValue.size).toBe(lots.length);
    expect(lv.locationValue.get('a0')).toBeCloseTo(1.75, 12);
    expect(lv.locationValue.get('p2')).toBeCloseTo(19 / 13, 12);
    expect(lv.locationValue.get('s0')).toBe(1);
    expect(lv.locationValue.get('c0')).toBe(1);
    // A lot with no neighbourhood takes the citywide figure.
    expect(lv.locationValue.get('z0')).toBe(1);
  });

  it('flags the shrinkage constant as invented and counts buildings and thin areas', async () => {
    const lv = await locationValueByLot(db);
    expect(lv.provenance.tier).toBe(2);
    expect(lv.provenance.n).toBe(126);
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
      { key: 'locationValue.buildings', value: 126 },
      { key: 'locationValue.neighborhoods', value: 5 },
      { key: 'locationValue.no_area', value: 1 },
      { key: 'locationValue.thin', value: 3 }
    ]);
  });
});
