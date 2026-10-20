import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDuck } from '../lib/duck';
import { ATTRS_CAST_BITS, ROLL_CAST_BITS, normalise } from '../sources/normalise';
import { miniDuck } from './helpers';

const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-norm-'));

describe('normalise mini fixture', () => {
  it('loads every src_ table with the expected row counts and types', async () => {
    const db = await miniDuck();
    const counts = Object.fromEntries(
      (
        await db.all<{ t: string; n: number }>(
          `SELECT 'p' t, count(*) n FROM src_parcels UNION ALL SELECT 'l', count(*) FROM src_landuse
         UNION ALL SELECT 'f', count(*) FROM src_footprints UNION ALL SELECT 'n', count(*) FROM src_neighborhoods
         UNION ALL SELECT 'o', count(*) FROM src_overture
         UNION ALL SELECT 'h', count(*) FROM src_height_bulk
         UNION ALL SELECT 'a', count(*) FROM src_parcel_attrs
         UNION ALL SELECT 'r', count(*) FROM src_roll`
        )
      ).map((r) => [r.t, r.n])
    );
    // parcels: 17 lots, lot 2 has 3 rows → 19, + 3 retired + 1 null-id = 23 (attrs likewise);
    // height: 7 districts; roll: 16 rows in 2025 + 17 in 2024 (lot 13 and 3512099 only in 2024,
    // lot 3 not in 2024) + 2 in 2023 (lots 3 and 4)
    expect(counts).toEqual({ p: 23, l: 18, f: 3, n: 3, o: 13, h: 7, a: 23, r: 35 });
    const [ids] = await db.all<{ ok: boolean }>(
      `SELECT bool_and(mapblklot IS NULL OR typeof(mapblklot) = 'VARCHAR') ok FROM src_parcels`
    );
    expect(ids.ok).toBe(true);
    const odd = await db.all<{ mapblklot: string }>(
      `SELECT mapblklot FROM src_parcels WHERE mapblklot IN ('0026T001A','8711023C') ORDER BY 1`
    );
    expect(odd.map((r) => r.mapblklot)).toEqual(['0026T001A', '8711023C']);
  });

  it('the three new tables have the documented column types', async () => {
    const db = await miniDuck();
    const types = async (t: string) =>
      (await db.all<{ column_name: string; column_type: string }>(`DESCRIBE ${t}`)).map(
        (r) => `${r.column_name} ${r.column_type}`
      );
    // ST_Read types geometry with its CRS (`GEOMETRY('EPSG:4326')`), like every other src_ table.
    const geom = (await types('src_neighborhoods')).find((c) => c.startsWith('geom '));
    expect(geom).toMatch(/^geom GEOMETRY/);
    expect(await types('src_height_bulk')).toEqual(['height VARCHAR', 'gen_hght VARCHAR', geom]);
    expect(await types('src_parcel_attrs')).toEqual([
      'mapblklot VARCHAR',
      'blklot VARCHAR',
      'active BOOLEAN',
      'zoning_code VARCHAR',
      'date_rec_add DATE',
      'date_rec_drop DATE',
      'centroid_latitude DOUBLE',
      'centroid_longitude DOUBLE',
      'cast_flags UTINYINT'
    ]);
    expect(await types('src_roll')).toEqual([
      'closed_roll_year INTEGER',
      'parcel_number VARCHAR',
      'use_code VARCHAR',
      'property_class_code VARCHAR',
      'year_property_built INTEGER',
      'number_of_stories INTEGER',
      'number_of_units INTEGER',
      'property_area DOUBLE',
      'assessed_land_value DOUBLE',
      'assessed_improvement_value DOUBLE',
      'status_code VARCHAR',
      'cast_flags UTINYINT'
    ]);
    const [h] = await db.all<{ height: string; gen_hght: string }>(
      `SELECT height, gen_hght FROM src_height_bulk WHERE gen_hght = '520'`
    );
    expect(h.height).toBe('120/400-R-2  //  140/520-R-2');
    const retired = await db.all<{ mapblklot: string; active: boolean; drop: string }>(
      `SELECT mapblklot, active, strftime(date_rec_drop, '%Y-%m-%d') AS drop
       FROM src_parcel_attrs WHERE NOT active ORDER BY 1`
    );
    expect(retired).toEqual([
      { mapblklot: '3512096', active: false, drop: '2024-06-30' },
      { mapblklot: '3512098', active: false, drop: '2019-03-01' },
      { mapblklot: '3512099', active: false, drop: '2024-06-30' }
    ]);
    const [condo] = await db.all<{ n: number; z: string }>(
      `SELECT count(*) n, min(zoning_code) z FROM src_parcel_attrs WHERE mapblklot = '3512002'`
    );
    expect(condo).toEqual({ n: 3, z: 'RH-2' });
  });

  it('"3.0" units cast to 3', async () => {
    const db = await miniDuck();
    const [r] = await db.all<{ u: number; s: number; a: number; land: number }>(
      `SELECT number_of_units u, number_of_stories s, property_area a, assessed_land_value land
       FROM src_roll WHERE parcel_number = '0026T001A' AND closed_roll_year = 2025`
    );
    expect(r).toEqual({ u: 3, s: 3, a: 3000, land: 300000 });
  });

  it('keeps year 0 and years outside [1850, roll year] unchanged (sd.roll.year-built-range)', async () => {
    // Spec §4.1: normalise rewrites no value; the range check is a registered T14 rule.
    const db = await miniDuck();
    const rows = await db.all<{ y: number; b: number | null }>(
      `SELECT closed_roll_year y, year_property_built b FROM src_roll
       WHERE parcel_number = '3512005' ORDER BY 1`
    );
    expect(rows).toEqual([
      { y: 2024, b: 0 },
      { y: 2025, b: 1950 }
    ]);
    const csv = join(tmp(), 'roll'); // extensionless, like a live raw file
    writeFileSync(
      csv,
      '"closed_roll_year","parcel_number","year_property_built","number_of_units"\n' +
        '"2024","3512001","2025","1.0"\n"2024","3512002","1849","2.0"\n' +
        '"2024","3512003","1850","3.0"\n"2024","3512004","2024.0",\n'
    );
    const own = await openDuck();
    try {
      const out = join(tmp(), 'roll.parquet');
      expect(await normalise(own, 'datasf-assessor-roll', [csv], out)).toBe(4);
      const got = await own.all<{ p: string; b: number | null; u: number | null; c: string }>(
        `SELECT parcel_number p, year_property_built b, number_of_units u, use_code c
         FROM read_parquet('${out}') ORDER BY p`
      );
      expect(got).toEqual([
        { p: '3512001', b: 2025, u: 1, c: null },
        { p: '3512002', b: 1849, u: 2, c: null },
        { p: '3512003', b: 1850, u: 3, c: null },
        { p: '3512004', b: 2024, u: null, c: null }
      ]);
    } finally {
      own.close();
    }
  });

  it('parcel_number is upper-cased and trimmed', async () => {
    const dir = tmp();
    const roll = join(dir, 'roll.page-000.csv');
    writeFileSync(
      roll,
      '"closed_roll_year","parcel_number","use_code","property_class_code","status_code"\n' +
        '"2025"," 0026t001a ","  MRES ","A "," NA"\n'
    );
    const attrs = join(dir, 'attrs');
    writeFileSync(
      attrs,
      '"mapblklot","blklot","active","zoning_code"\n" 8711023c","8711023c ","true"," NCT "\n'
    );
    const db = await openDuck();
    try {
      await normalise(db, 'datasf-assessor-roll', [roll], join(dir, 'r.parquet'));
      await normalise(db, 'datasf-parcel-attrs', [attrs], join(dir, 'a.parquet'));
      const [r] = await db.all(
        `SELECT parcel_number, use_code, property_class_code, status_code
         FROM read_parquet('${join(dir, 'r.parquet')}')`
      );
      expect(r).toEqual({
        parcel_number: '0026T001A',
        use_code: 'MRES',
        property_class_code: 'A',
        status_code: 'NA'
      });
      const [a] = await db.all(
        `SELECT mapblklot, blklot, active, zoning_code, date_rec_drop
         FROM read_parquet('${join(dir, 'a.parquet')}')`
      );
      expect(a).toEqual({
        mapblklot: '8711023C',
        blklot: '8711023C',
        active: true,
        zoning_code: 'NCT',
        date_rec_drop: null
      });
    } finally {
      db.close();
    }
  });
});

describe('normalise flags every TRY_CAST rewrite (cast_flags; the sd.roll / sd.attrs cast rules)', () => {
  it('roll: non-numeric text becomes NULL and a fraction is rounded, each flagged by field', async () => {
    expect(ROLL_CAST_BITS).toEqual({
      closed_roll_year: 1,
      year_property_built: 2,
      number_of_stories: 4,
      number_of_units: 8,
      property_area: 16,
      assessed_land_value: 32,
      assessed_improvement_value: 64
    });
    const csv = join(tmp(), 'roll');
    writeFileSync(
      csv,
      '"closed_roll_year","parcel_number","year_property_built","number_of_stories",' +
        '"number_of_units","property_area","assessed_land_value","assessed_improvement_value"\n' +
        '"2024","3512001","1950.0","3","abc","1000","x1","5"\n' +
        '"2024","3512002","19x0","2.4","3.5","n/a","10","20"\n' +
        '"2024.0","3512003","1950","3","2.0","1000","10","20.5"\n' +
        '"2024.5","3512004","","","","","",""\n'
    );
    const own = await openDuck();
    try {
      const out = join(tmp(), 'roll.parquet');
      await normalise(own, 'datasf-assessor-roll', [csv], out);
      const got = await own.all(
        `SELECT parcel_number p, closed_roll_year y, year_property_built b, number_of_stories s,
                number_of_units u, property_area a, assessed_land_value l,
                assessed_improvement_value i, cast_flags f
         FROM read_parquet('${out}') ORDER BY p`
      );
      expect(got).toEqual([
        { p: '3512001', y: 2024, b: 1950, s: 3, u: null, a: 1000, l: null, i: 5, f: 8 | 32 },
        { p: '3512002', y: 2024, b: null, s: 2, u: 4, a: null, l: 10, i: 20, f: 2 | 4 | 8 | 16 },
        { p: '3512003', y: 2024, b: 1950, s: 3, u: 2, a: 1000, l: 10, i: 20.5, f: 0 },
        // Blank text is a source NULL, not a rewrite; DuckDB casts half to even, so "2024.5" is
        // 2024 (and "3.5" above is 4): either way a fraction is flagged.
        { p: '3512004', y: 2024, b: null, s: null, u: null, a: null, l: null, i: null, f: 1 }
      ]);
    } finally {
      own.close();
    }
  });

  it('attrs: casts flagged by field; an unrecognised active is NULL (sd.attrs.active-unknown)', async () => {
    expect(ATTRS_CAST_BITS).toEqual({
      centroid_latitude: 1,
      centroid_longitude: 2,
      date_rec_add: 4,
      date_rec_drop: 8
    });
    const csv = join(tmp(), 'attrs');
    writeFileSync(
      csv,
      '"mapblklot","blklot","active","date_rec_add","date_rec_drop","centroid_latitude",' +
        '"centroid_longitude"\n' +
        '"3512001","3512001","TRUE ","","","37.7","-122.4"\n' +
        '"3512002","3512002","maybe","not a date","2019-03-01T05:30:00.000","x","-122.4"\n' +
        '"3512003","3512003","0","2009-10-14T00:00:00.000","","37.7","west"\n' +
        '"3512004","3512004","","","","",""\n'
    );
    const own = await openDuck();
    try {
      const out = join(tmp(), 'attrs.parquet');
      await normalise(own, 'datasf-parcel-attrs', [csv], out);
      const got = await own.all<Record<string, unknown>>(
        `SELECT blklot b, active a, strftime(date_rec_add, '%Y-%m-%d') ad,
                strftime(date_rec_drop, '%Y-%m-%d') dd, centroid_latitude lat,
                centroid_longitude lon, cast_flags f
         FROM read_parquet('${out}') ORDER BY b`
      );
      expect(got).toEqual([
        { b: '3512001', a: true, ad: null, dd: null, lat: 37.7, lon: -122.4, f: 0 },
        { b: '3512002', a: null, ad: null, dd: '2019-03-01', lat: null, lon: -122.4, f: 1 | 4 | 8 },
        { b: '3512003', a: false, ad: '2009-10-14', dd: null, lat: 37.7, lon: null, f: 2 },
        { b: '3512004', a: null, ad: null, dd: null, lat: null, lon: null, f: 0 }
      ]);
    } finally {
      own.close();
    }
  });
});
