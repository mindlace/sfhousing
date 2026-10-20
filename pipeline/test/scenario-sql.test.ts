import { beforeAll, describe, expect, it } from 'vitest';
import type { Duck } from '../lib/duck';
import { createTableFromRows } from '../lib/duck';
import { createQualityTables, recordSqlQuality } from '../lib/quality';
import { runSql } from '../lib/sql';
import { readParcelRecords } from '../steps/chunks';
import { runScenarioSql } from '../steps/scenario-sql';
import { miniDuck } from './helpers';

/** Spec §4.6 T13 columns, minus the four Task 8 adds (base_yield and its derivations). */
const T13_COLUMNS = [
  'mapblklot',
  'roll_year',
  'existing_units',
  'existing_stories',
  'year_built',
  'land_value',
  'improvement_value',
  'use_code',
  'land_use_class',
  'zoning_code',
  'base_stories',
  'base_density_cap',
  'lien_day',
  'lot_area_m2',
  'improvement_share',
  'rent_control_likely',
  'imputed'
];

const counts = async (db: Duck) =>
  Object.fromEntries(
    (await db.all<{ key: string; value: number }>('SELECT key, value FROM report_counts')).map(
      (r) => [r.key, r.value]
    )
  );

interface District {
  district: string;
  kind: string;
  base_ft: number | null;
  lp_ft: number | null;
  r4: boolean;
  overlap_frac: number;
  split: boolean;
}

const district = async (db: Duck, id: string) => {
  const [r] = await db.all<District>(`SELECT * FROM sc_district WHERE id = '${id}'`);
  return r;
};

interface Agg {
  id: string;
  roll_year: number;
  units: number;
  stories: number;
  year_built: number | null;
  noncondo_units: number;
  hotel: boolean;
  status_n: boolean;
  land_use_class: number;
}

const agg = (db: Duck, id: string) =>
  db.all<Agg>(`SELECT * FROM sc_roll_agg WHERE id = '${id}' ORDER BY roll_year`);

interface Feature {
  mapblklot: string;
  roll_year: number;
  lien_day: number;
  year_built: number;
  improvement_share: number;
  imputed: number;
  land_use_class: number;
  base_density_cap: number | null;
  existing_units: number;
  rent_control_likely: boolean;
}

const feature = async (db: Duck, id: string, year: number) => {
  const [r] = await db.all<Feature>(
    `SELECT * FROM sc_features WHERE mapblklot = '${id}' AND roll_year = ${year}`
  );
  return r;
};

describe('createTableFromRows', () => {
  it('creates a typed table in row order, escaping quotes, across insert batches', async () => {
    const db = await miniDuck();
    const rows = Array.from({ length: 2503 }, (_, i) => [
      `id'${i}`,
      i,
      i % 2 === 0,
      i % 3 === 0 ? null : i / 4
    ]);
    await createTableFromRows(
      db,
      't_rows',
      [
        ['s', 'VARCHAR'],
        ['n', 'INTEGER'],
        ['b', 'BOOLEAN'],
        ['d', 'DOUBLE']
      ],
      rows
    );
    const got = await db.all<{ s: string; n: number; b: boolean; d: number | null }>(
      'SELECT * FROM t_rows'
    );
    expect(got.map((r) => [r.s, r.n, r.b, r.d])).toEqual(rows);
    await createTableFromRows(db, 't_empty', [['s', 'VARCHAR']], []);
    expect(await db.all('SELECT * FROM t_empty')).toEqual([]);
  });

  it('round-trips doubles exactly (no DECIMAL literal rounding)', async () => {
    const db = await miniDuck();
    // mulberry32, seeded: 1,000 doubles in [0, 1e6) plus a value a DECIMAL literal gets 1 ulp off.
    let a = 0x5eed;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const vals = [0.9678718104870807, -1.5e-300, 1.7976931348623157e308];
    for (let i = 0; i < 1000; i++) vals.push(next() * 1e6 * (next() < 0.5 ? -1 : 1) + next());
    await createTableFromRows(
      db,
      't_dbl',
      [
        ['i', 'INTEGER'],
        ['d', 'DOUBLE']
      ],
      vals.map((v, i) => [i, v])
    );
    const got = await db.all<{ d: number }>('SELECT d FROM t_dbl ORDER BY i');
    expect(got.map((r) => r.d)).toEqual(vals);
  });

  it('rejects a non-finite number', async () => {
    const db = await miniDuck();
    await expect(createTableFromRows(db, 't_bad', [['d', 'DOUBLE']], [[NaN]])).rejects.toThrow(
      /non-finite/
    );
  });
});

describe('runScenarioSql on the mini fixture', () => {
  let db: Duck;
  let parseFailures: string[];
  beforeAll(async () => {
    db = await miniDuck();
    await createQualityTables(db);
    await runSql(db);
    const records = await readParcelRecords(db);
    ({ parseFailures } = await runScenarioSql(db, records));
  });

  it('readParcelRecords returns every parcel sorted by id with its cell', async () => {
    const recs = await readParcelRecords(db);
    const ids = recs.map((r) => r.rec.id);
    expect(ids).toHaveLength(17);
    expect(ids).toEqual([...ids].sort());
    expect(recs.every((r) => /^-?\d+_-?\d+$/.test(r.cellId))).toBe(true);
  });

  it('parses every fixture height string', async () => {
    expect(parseFailures).toEqual([]);
    expect((await counts(db))['scenario.height.parse_fail']).toBe(0);
  });

  it('lot 5 takes 65-X by largest overlap (60%, so split per spec §4.3)', async () => {
    const d = await district(db, '3512005');
    expect(d.district).toBe('65-X');
    expect(d.kind).toBe('height');
    expect(d.overlap_frac).toBeCloseTo(0.6, 2);
    expect(d.split).toBe(true);
  });

  it('lot 10 takes 65-X with split 1 and overlap 0.7', async () => {
    const d = await district(db, '3512010');
    expect(d.district).toBe('65-X');
    expect(d.split).toBe(true);
    expect(d.overlap_frac).toBeCloseTo(0.7, 2);
  });

  it('lot 1 sits wholly in 40//65-R-4, not split', async () => {
    const d = await district(db, '3512001');
    expect(d).toMatchObject({ district: '40//65-R-4', base_ft: 40, lp_ft: 65, r4: true });
    expect(d.split).toBe(false);
    expect(d.overlap_frac).toBeCloseTo(1, 3);
  });

  it('lot 12 district is Special Height District, kind none', async () => {
    const d = await district(db, '3512012');
    expect(d.district).toBe('Special Height District');
    expect(d.kind).toBe('none');
    expect(d.base_ft).toBeNull();
  });

  it('lot 14 district is normalised 120/400//120/650-R-4', async () => {
    const d = await district(db, '3512014');
    expect(d).toMatchObject({
      district: '120/400//120/650-R-4',
      kind: 'height',
      base_ft: 400,
      lp_ft: 650,
      r4: true
    });
  });

  it('counts the SQL-side height report keys', async () => {
    const c = await counts(db);
    expect(c['scenario.height.none']).toBe(1);
    expect(c['scenario.height.no_district']).toBe(0);
    expect(c['scenario.height.split']).toBe(2);
    expect(c['scenario.height.dbl_non_r4']).toBe(1);
    expect(c['scenario.height.overlap_gt1']).toBe(0);
    const units = await db.all<{ u: number }>(
      `SELECT sum(units)::INTEGER u FROM parcel_out WHERE id IN ('3512005', '3512010')`
    );
    expect(c['scenario.height.split_units']).toBe(units[0].u);
  });

  it('gives every parcel a zoning code picked like 10_parcels', async () => {
    const z = await db.all<{ id: string; zoning_code: string }>(
      'SELECT id, zoning_code FROM sc_zoning ORDER BY id'
    );
    expect(z).toHaveLength(17);
    const by = Object.fromEntries(z.map((r) => [r.id, r.zoning_code]));
    expect(by['3512002']).toBe('RH-2');
    expect(by['8711023C']).toBe('NCT');
    expect(by['3512013']).toBe('C-3-O');
  });

  it('lineage maps retired 3512099 to 3512012, 3512098 to 3512001 and 3512096 to 3512015', async () => {
    const rows = await db.all<{
      blklot: string;
      retired_mapblklot: string;
      current_mapblklot: string | null;
      d: string;
    }>(
      `SELECT blklot, retired_mapblklot, current_mapblklot, strftime(date_rec_drop, '%Y-%m-%d') d
       FROM parcel_lineage ORDER BY blklot`
    );
    expect(rows).toEqual([
      {
        blklot: '3512096',
        retired_mapblklot: '3512096',
        current_mapblklot: '3512015',
        d: '2024-06-30'
      },
      {
        blklot: '3512098',
        retired_mapblklot: '3512098',
        current_mapblklot: '3512001',
        d: '2019-03-01'
      },
      {
        blklot: '3512099',
        retired_mapblklot: '3512099',
        current_mapblklot: '3512012',
        d: '2024-06-30'
      }
    ]);
  });

  it('lot 12 has a 2024 roll row with 7 units and no 2025 row', async () => {
    const rows = await agg(db, '3512012');
    expect(rows.map((r) => [r.roll_year, r.units, r.year_built])).toEqual([[2024, 7, 1910]]);
  });

  it('lot 2 aggregates three condos: 3 units, noncondo_units 0', async () => {
    const rows = await agg(db, '3512002');
    expect(rows.map((r) => [r.roll_year, r.units, r.noncondo_units, r.stories])).toEqual([
      [2024, 3, 0, 3],
      [2025, 3, 0, 3]
    ]);
  });

  it('lot 11 has 0 units and status_n', async () => {
    const rows = await agg(db, '3512011');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.units).toBe(0);
      expect(r.status_n).toBe(true);
      expect(r.land_use_class).toBe(5); // other (GOVT)
    }
  });

  it('lot 3 is a hotel and lot 4 has 3 non-condo units built 1925', async () => {
    const hotel = await agg(db, '8711023C');
    expect(hotel.map((r) => r.hotel)).toEqual([true, true]);
    expect(hotel[0].land_use_class).toBe(2); // commercial (COMH)
    const lot4 = await agg(db, '0026T001A');
    // sc_roll_agg is the aggregate before the units rules: lot 4's 2024 still reads 900.
    expect(lot4.map((r) => [r.roll_year, r.noncondo_units, r.year_built, r.hotel])).toEqual([
      [2023, 3, 1925, false],
      [2024, 900, 1925, false],
      [2025, 3, 1925, false]
    ]);
  });

  it('lots 3 and 4 carry the RA1 units cases (spec §4.11)', async () => {
    const units = async (id: string) =>
      (
        await db.all<Feature>(
          `SELECT * FROM sc_features WHERE mapblklot = '${id}' ORDER BY roll_year`
        )
      ).map((r) => [r.roll_year, r.existing_units, r.imputed & 40]);
    // Lot 3: 5,000 in 2023 and 2025 on 300 m² × 3 stories (capacity 90); no year passes and the
    // LUDB 4 does (bit 3). 2024 is carried from 2023 (bits 3 and 5).
    expect(await units('8711023C')).toEqual([
      [2023, 4, 8],
      [2024, 4, 40],
      [2025, 4, 8]
    ]);
    // Lot 4: 3, 900, 3. 2023 and 2025 tie; the earlier wins (bit 3). The spike rule never fires.
    expect(await units('0026T001A')).toEqual([
      [2023, 3, 0],
      [2024, 3, 8],
      [2025, 3, 0]
    ]);
    const [spike] = await db.all<{ fired: number }>(
      `SELECT fired FROM quality_tally WHERE rule_id = 'sd.roll.units-spike'`
    );
    expect(spike.fired).toBe(0);
  });

  it('counts the roll report keys', async () => {
    const c = await counts(db);
    expect(c['scenario.roll.years']).toBe(3);
    expect(c['scenario.roll.unmatched.2023']).toBe(0);
    expect(c['scenario.roll.latest']).toBe(2025);
    expect(c['scenario.roll.matched_parcels']).toBe(16);
    expect(c['scenario.roll.unmatched.2024']).toBe(0);
    expect(c['scenario.roll.unmatched.2025']).toBe(0);
    expect(c['scenario.roll.unmatched_units.2024']).toBe(0);
    expect(c['scenario.roll.lineage_retired']).toBe(1);
  });

  it('builds sc_parcel with the two base cap periods and the chunk record values', async () => {
    const [p] = await db.all<{
      lot_area_m2: number;
      base_stories: number;
      cap_pre2022: number | null;
      cap_prefzp: number | null;
      ludb_units: number;
      rec_floor_area_m2: number;
    }>(`SELECT * FROM sc_parcel WHERE id = '3512005'`);
    // Lot 5: two parts, 10 x 18 + 10 x 8 = 260 m²; 65-X -> 6 stories; RH-1: 1 per lot before
    // 2022-11-27, the fourplex rule after. Its chunk record has LUDB 1 unit and 80 m².
    expect(p).toMatchObject({
      lot_area_m2: 260,
      base_stories: 6,
      cap_pre2022: 1,
      cap_prefzp: 4,
      ludb_units: 1,
      rec_floor_area_m2: 80
    });
    // The base cap date is min(lien_day, 2026-01-11), so the panel path has no FZP period.
    const cols = (await db.all<{ column_name: string }>('DESCRIBE sc_parcel')).map(
      (r) => r.column_name
    );
    expect(cols).not.toContain('cap_fzp');
    const [nct] = await db.all<{ cap_prefzp: number | null }>(
      `SELECT cap_prefzp FROM sc_parcel WHERE id = '8711023C'`
    );
    expect(nct.cap_prefzp).toBeNull();
  });

  it('the features table has exactly roll years 2023 to 2025 and every T13 column', async () => {
    const years = await db.all<{ y: number }>(
      'SELECT DISTINCT roll_year y FROM sc_features ORDER BY y'
    );
    expect(years.map((r) => r.y)).toEqual([2023, 2024, 2025]);
    const cols = (await db.all<{ column_name: string }>('DESCRIBE sc_features')).map(
      (r) => r.column_name
    );
    for (const c of T13_COLUMNS) expect(cols, c).toContain(c);
    const [{ n }] = await db.all<{ n: number }>('SELECT count(*) n FROM sc_features');
    const [{ m }] = await db.all<{ m: number }>('SELECT count(*) m FROM sc_roll_agg');
    // The observed parcel-years plus lot 3's carried 2024 row (sd.roll.year-gap).
    expect(n).toBe(m + 1);
  });

  it('sets lien_day to 1 January of the roll year and the cap of that period', async () => {
    const f = await feature(db, '3512005', 2025);
    expect(f.lien_day).toBe(Date.UTC(2025, 0, 1) / 86400000);
    expect(f.base_density_cap).toBe(4);
  });

  it('lot 5 2024 year_built is imputed with bit 0', async () => {
    const f = await feature(db, '3512005', 2024);
    // Median of the 2024 residential years: 1910 1912 1925 1930 1940 1960 1970 1975 2015.
    expect(f.year_built).toBe(1940);
    expect(f.imputed & 1).toBe(1);
    expect((await feature(db, '3512005', 2025)).imputed & 1).toBe(0);
  });

  it('lot 11 improvement_share is imputed with bit 2', async () => {
    const f = await feature(db, '3512011', 2025);
    expect(f.imputed & 4).toBe(4);
    const [m] = await db.all<{ improvement_share: number }>(
      'SELECT improvement_share FROM sc_medians WHERE roll_year = 2025 AND land_use_class = 5'
    );
    expect(f.improvement_share).toBe(m.improvement_share);
  });

  it('rounds improvement_share to 1/200 and sets rent_control_likely', async () => {
    const f = await feature(db, '3512001', 2025);
    // 300k / (400k + 300k) = 0.4286 -> 86 / 200.
    expect(f.improvement_share).toBeCloseTo(0.43, 6);
    expect(f.rent_control_likely).toBe(true);
    expect(f.imputed).toBe(0);
    expect((await feature(db, '3512014', 2025)).rent_control_likely).toBe(false);
  });

  it('lot 7 is vacant with year 0 and share 0; only bit 6 (no roll floor area)', async () => {
    const f = await feature(db, '3512007', 2025);
    // Vacant lots take 0 with no imputation (spec §4.5); the roll's property_area is 0, so the
    // floor area is the chunk record's (0 m²) under sd.roll.floor-area-missing, bit 6.
    expect(f).toMatchObject({
      land_use_class: 4,
      year_built: 0,
      improvement_share: 0,
      imputed: 64
    });
  });

  it('writes sc_medians for every roll year and class', async () => {
    const rows = await db.all<{ roll_year: number; land_use_class: number; year_built: number }>(
      'SELECT * FROM sc_medians ORDER BY roll_year, land_use_class'
    );
    expect(rows).toHaveLength(18);
    const r2024 = rows.find((r) => r.roll_year === 2024 && r.land_use_class === 0)!;
    expect(r2024.year_built).toBe(1940);
  });

  it('does not duplicate scenario counts or quality tallies when re-run on the same DB', async () => {
    const quality: Record<string, number> = {};
    await runScenarioSql(db, await readParcelRecords(db));
    // The scenario step reports the SQL tallies once, after T11 (writeScenario); here directly.
    await recordSqlQuality(db, 'scenario-data', quality);
    const [r] = await db.all<{ n: number }>(
      `SELECT count(*) n FROM report_counts WHERE key = 'scenario.height.split'`
    );
    expect(r.n).toBe(1);
    const [t] = await db.all<{ n: number; d: number }>(
      'SELECT count(*)::INTEGER n, count(DISTINCT rule_id)::INTEGER d FROM quality_tally'
    );
    expect(t.n).toBe(t.d);
    expect(quality['quality.sd.roll.units-capacity.of']).toBe(31);
  });
});

describe('runScenarioSql on a copy with a far-away parcel and a bad height string', () => {
  let db: Duck;
  let parseFailures: string[];
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db);
    await db.run(`ATTACH ':memory:' AS syn`);
    for (const t of ['parcels', 'parcel_out', 'src_height_bulk', 'src_parcel_attrs', 'src_roll']) {
      await db.run(`CREATE TABLE syn.${t} AS SELECT * FROM memory.${t}`);
    }
    await db.run('CREATE TABLE syn.report_counts AS SELECT * FROM memory.report_counts');
    await db.run('CREATE TABLE syn.quality_tally AS SELECT * FROM memory.quality_tally LIMIT 0');
    await db.run('CREATE TABLE syn.quality_sample AS SELECT * FROM memory.quality_sample LIMIT 0');
    // Lot 1 moved 5 km east (outside every district), as a new id.
    await db.run(
      `INSERT INTO syn.parcels SELECT * REPLACE ('9999001' AS id,
         ST_Translate(geom, 5000, 0) AS geom, x0 + 5000 AS x0)
       FROM memory.parcels WHERE id = '3512001'`
    );
    await db.run(
      `INSERT INTO syn.parcel_out SELECT * REPLACE ('9999001' AS id,
         ST_Translate(geom, 5000, 0) AS geom, x0 + 5000 AS x0,
         ST_AsGeoJSON(ST_Translate(geom, 5000, 0)) AS geojson7131)
       FROM memory.parcel_out WHERE id = '3512001'`
    );
    // A copy of the 65-X polygon 0.1° (about 9 km) east, under an unparseable string (two `//`).
    await db.run(
      `INSERT INTO syn.src_height_bulk SELECT * REPLACE ('40//65//85' AS height,
         ST_Translate(geom, 0.1, 0) AS geom)
       FROM memory.src_height_bulk WHERE height = '65-X'`
    );
    // An exact duplicate of the 85//120-R-4 polygon: lot 11's raw same-string sum is 2.
    await db.run(
      `INSERT INTO syn.src_height_bulk SELECT * FROM memory.src_height_bulk
       WHERE height = '85//120-R-4'`
    );
    await db.run('USE syn');
    try {
      const records = await readParcelRecords(db);
      ({ parseFailures } = await runScenarioSql(db, records));
    } finally {
      await db.run('USE memory');
    }
  });

  it("a parcel outside every height polygon gets district '' and kind none", async () => {
    const [d] = await db.all<District>(`SELECT * FROM syn.sc_district WHERE id = '9999001'`);
    expect(d).toMatchObject({ district: '', kind: 'none', split: false, overlap_frac: 0 });
    const [p] = await db.all<{ base_stories: number }>(
      `SELECT base_stories FROM syn.sc_parcel WHERE id = '9999001'`
    );
    expect(p.base_stories).toBe(0);
    const c = Object.fromEntries(
      (
        await db.all<{ key: string; value: number }>('SELECT key, value FROM syn.report_counts')
      ).map((r) => [r.key, r.value])
    );
    expect(c['scenario.height.no_district']).toBe(1);
  });

  it('clamps overlap_frac to 1 and counts a raw same-string sum above 1', async () => {
    const [d] = await db.all<District>(`SELECT * FROM syn.sc_district WHERE id = '3512011'`);
    expect(d).toMatchObject({ district: '85//120-R-4', overlap_frac: 1, split: false });
    const [c] = await db.all<{ value: number }>(
      `SELECT value FROM syn.report_counts WHERE key = 'scenario.height.overlap_gt1'`
    );
    expect(c.value).toBe(1);
  });

  it('records a parse failure as kind none and returns it', async () => {
    expect(parseFailures).toEqual(['40//65//85']);
    const [h] = await db.all<{ kind: string }>(
      `SELECT kind FROM syn.sc_height_parse WHERE height = '40//65//85'`
    );
    expect(h.kind).toBe('none');
    const [c] = await db.all<{ value: number }>(
      `SELECT value FROM syn.report_counts WHERE key = 'scenario.height.parse_fail'`
    );
    expect(c.value).toBe(1);
  });
});

describe('runScenarioSql units-spike rule on a copy (A12, sd.roll.units-spike)', () => {
  let db: Duck;
  const quality: Record<string, number> = {};
  const series = (id: string) =>
    db.all<{ roll_year: number; units: number; units_replaced: boolean }>(
      `SELECT roll_year, units, units_replaced FROM syn2.sc_roll_series
       WHERE id = '${id}' ORDER BY roll_year`
    );
  // A copy of a parcel's roll row in another year with another unit count.
  const yearRow = (id: string, from: number, year: number, units: number) =>
    db.run(
      `INSERT INTO syn2.src_roll SELECT * REPLACE (${year} AS closed_roll_year,
         ${units} AS number_of_units)
       FROM syn2.src_roll WHERE parcel_number = '${id}' AND closed_roll_year = ${from}`
    );
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db);
    await db.run(`ATTACH ':memory:' AS syn2`);
    for (const t of ['parcels', 'parcel_out', 'src_height_bulk', 'src_parcel_attrs', 'src_roll']) {
      await db.run(`CREATE TABLE syn2.${t} AS SELECT * FROM memory.${t}`);
    }
    await db.run('CREATE TABLE syn2.report_counts AS SELECT * FROM memory.report_counts');
    // Lot 1 (2 units in 2024 and 2025): 2, 50000, 50000, 2, 2 over 2021-2025, bracketed.
    await yearRow('3512001', 2024, 2021, 2);
    await yearRow('3512001', 2024, 2022, 50000);
    await yearRow('3512001', 2024, 2023, 50000);
    // Lot 8: 0, 0, 300, 300 over 2022-2025, a one-sided change that stays.
    await db.run(`UPDATE syn2.src_roll SET number_of_units = 300 WHERE parcel_number = '3512008'`);
    await yearRow('3512008', 2024, 2022, 0);
    await yearRow('3512008', 2024, 2023, 0);
    // Lot 10: 4000 in every year, constant.
    await db.run(`UPDATE syn2.src_roll SET number_of_units = 4000 WHERE parcel_number = '3512010'`);
    await yearRow('3512010', 2024, 2022, 4000);
    await yearRow('3512010', 2024, 2023, 4000);
    await db.run('USE syn2');
    try {
      await createQualityTables(db);
      // Lots of 1,000,000 m², so sd.roll.units-capacity (which runs first) passes every year:
      // 50,000 units on 2 stories need 250,000 m².
      const big = new Set(['3512001', '3512008', '3512010']);
      const records = (await readParcelRecords(db)).map(({ rec, cellId }) => ({
        rec: big.has(rec.id) ? { ...rec, areaM2: 1_000_000 } : rec,
        cellId
      }));
      await runScenarioSql(db, records);
      await recordSqlQuality(db, 'scenario-data', quality);
    } finally {
      await db.run('USE memory');
    }
  });

  it('replaces a bracketed implausible units run with the previous value, imputed bit 3', async () => {
    const rows = await series('3512001');
    expect(rows.map((r) => [r.roll_year, r.units, r.units_replaced])).toEqual([
      [2021, 2, false],
      [2022, 2, true],
      [2023, 2, true],
      [2024, 2, false],
      [2025, 2, false]
    ]);
    const f = await db.all<{ roll_year: number; existing_units: number; imputed: number }>(
      `SELECT roll_year, existing_units, imputed FROM syn2.sc_features
       WHERE mapblklot = '3512001' ORDER BY roll_year`
    );
    expect(f.map((r) => [r.roll_year, r.existing_units, r.imputed & 8])).toEqual([
      [2021, 2, 0],
      [2022, 2, 8],
      [2023, 2, 8],
      [2024, 2, 0],
      [2025, 2, 0]
    ]);
    expect(quality['quality.sd.roll.units-spike.fired']).toBe(2);
    expect(quality['quality.sd.roll.units-spike.units']).toBe(100000);
    // The capacity rule passes the big lots; it fires only on mini's own RA1 cases (lot 3 in 2023
    // and 2025, lot 4 in 2024; spec §4.11).
    expect(quality['quality.sd.roll.units-capacity.fired']).toBe(3);
  });

  it('leaves a one-sided change (0, 0, 300, 300) and a constant 4000 untouched', async () => {
    expect((await series('3512008')).map((r) => [r.units, r.units_replaced])).toEqual([
      [0, false],
      [0, false],
      [300, false],
      [300, false]
    ]);
    expect((await series('3512010')).map((r) => [r.units, r.units_replaced])).toEqual([
      [4000, false],
      [4000, false],
      [4000, false],
      [4000, false]
    ]);
  });
});
