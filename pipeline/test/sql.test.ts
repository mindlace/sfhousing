import { beforeAll, describe, expect, it } from 'vitest';
import { runSql } from '../lib/sql';
import type { Duck } from '../lib/duck';
import { readFileSync } from 'node:fs';
import { KNOWN_LANDUSE, config } from '../config';
import { miniDuck } from './helpers';
import { openDuck } from '../lib/duck';

let db: Duck;
const counts = async () =>
  Object.fromEntries(
    (await db.all<{ key: string; value: number }>('SELECT key, value FROM report_counts')).map(
      (r) => [r.key, r.value]
    )
  );

describe('10_parcels', () => {
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db, '10_parcels.sql');
  });

  it('emits one record per distinct active non-null mapblklot', async () => {
    const rows = await db.all<{ id: string }>('SELECT id FROM parcels ORDER BY id');
    expect(rows).toHaveLength(17);
    expect(rows.map((r) => r.id)).toContain('3512002');
    expect(rows.map((r) => r.id)).not.toContain('3512099');
    const c = await counts();
    expect(c['parcels.null_id_dropped']).toBe(1);
    expect(c['parcels.condo_sublots']).toBe(3);
    expect(c['parcels.condo_geom_mismatch']).toBe(1);
    expect(c['parcels.distinct_active_ids']).toBe(17);
    expect(c['parcels.emitted']).toBe(17);
  });

  it('does not duplicate counts when re-run on the same DB', async () => {
    await runSql(db, '10_parcels.sql');
    const [r] = await db.all<{ n: number }>(
      `SELECT count(*) n FROM report_counts WHERE key = 'parcels.emitted'`
    );
    expect(r.n).toBe(1);
  });

  it('takes the condo geometry from the smallest blklot', async () => {
    const [r] = await db.all<{ eq: boolean }>(
      `SELECT ST_Equals(p.geom, ST_Transform(ST_MakeValid(s.geom), 'EPSG:4326', 'EPSG:7131', always_xy := true)) eq
       FROM parcels p JOIN src_parcels s ON s.blklot = '3512101' WHERE p.id = '3512002'`
    );
    expect(r.eq).toBe(true);
  });

  it('puts every label point strictly inside its polygon', async () => {
    const [r] = await db.all<{ bad: number }>(
      'SELECT count(*) bad FROM parcels WHERE NOT ST_Contains(geom, ST_Point(x0, y0))'
    );
    expect(r.bad).toBe(0);
  });

  it('labels a holed parcel outside its hole and counts multipart/holed', async () => {
    // Lot 6 spans x[50,60] y[0,30] with a hole x[53,57] y[10,20] (local metres from its xmin/ymin).
    const [r] = await db.all<{ dx: number; dy: number }>(
      `SELECT x0 - ST_XMin(geom) dx, y0 - ST_YMin(geom) dy FROM parcels WHERE id = '3512006'`
    );
    const inHole = r.dx > 3 && r.dx < 7 && r.dy > 10 && r.dy < 20;
    expect(inHole).toBe(false);
    const c = await counts();
    expect(c['parcels.multipart']).toBe(1);
    expect(c['parcels.holed']).toBe(1);
  });

  it('falls back to the containing neighborhood polygon', async () => {
    const [r] = await db.all<{ neighborhood: string; nb_fallback: boolean }>(
      `SELECT neighborhood, nb_fallback FROM parcels WHERE id = '3512009'`
    );
    expect(r).toEqual({ neighborhood: 'Noe Valley', nb_fallback: true });
    const c = await counts();
    expect(c['parcels.no_neighborhood']).toBe(0);
    expect(c['parcels.nb_spatial_fallback']).toBe(1);
  });
});

describe('20_landuse', () => {
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db, '20_landuse.sql');
  });
  const lu = async (id: string) =>
    (
      await db.all<Record<string, unknown>>(
        `SELECT land_use, units, sqft, eligible, reassigned FROM parcel_landuse WHERE id = '${id}'`
      )
    )[0];

  it('follows the eligibility table', async () => {
    expect(await lu('3512007')).toMatchObject({ land_use: 'OPENSPACE', eligible: false });
    expect(await lu('3512009')).toMatchObject({ land_use: 'NONE', units: 0, eligible: false });
    expect(await lu('3512008')).toMatchObject({ land_use: 'UNKNOWN', units: 12, eligible: true });
    expect(await lu('3512001')).toMatchObject({ land_use: 'RESIDENT', eligible: true });
  });

  it('sums duplicate rows and takes the class of the largest row', async () => {
    expect(await lu('8711023C')).toMatchObject({ land_use: 'RETAIL/ENT', units: 4, sqft: 7500 });
  });

  it('reassigns an orphan onto a row-less parcel and drops a colliding one', async () => {
    expect(await lu('3512012')).toMatchObject({ land_use: 'RESIDENT', units: 7, reassigned: true });
    expect(await lu('3512001')).toMatchObject({ units: 2 });
    const c = await counts();
    expect(c['landuse.orphan_reassigned']).toBe(1);
    expect(c['landuse.orphan_dropped']).toBe(1);
    expect(c['landuse.orphan_dropped_units']).toBe(9);
    expect(c['landuse.orphan_reassigned_units']).toBe(7);
    expect(c['landuse.orphan_rows']).toBe(2);
    expect(c['landuse.rows']).toBe(18);
    expect(c['landuse.duplicate_ids']).toBe(1);
    expect(c['landuse.matched_parcels']).toBe(15);
    expect(c['landuse.no_row_parcels']).toBe(2);
    expect(c['landuse.unknown_values']).toBe(0);
    expect(c['landuse.class.NONE']).toBe(1);
    expect(c['landuse.class.UNKNOWN']).toBe(1);
    expect(c['landuse.class.RESIDENT']).toBe(8);
  });

  it('has exactly one row per parcel and no unknown classes', async () => {
    const [r] = await db.all<{ n: number; d: number }>(
      'SELECT count(*) n, count(DISTINCT id) d FROM parcel_landuse'
    );
    expect(r).toEqual({ n: 17, d: 17 });
    expect(await db.all('SELECT * FROM landuse_unknown_values')).toEqual([]);
  });

  it('hard-codes the same known codes as config.ts', () => {
    const sql = readFileSync(new URL('../sql/20_landuse.sql', import.meta.url), 'utf8');
    for (const code of KNOWN_LANDUSE) expect(sql).toContain(`'${code}'`);
  });
});

describe('30–70 buildings, clipping, attributes', () => {
  beforeAll(async () => {
    db = await miniDuck();
    await runSql(db);
  });

  it('applies height rules 0–3 with the expected hs', async () => {
    const rows = await db.all<{ bid: string; height_m: number; hs: number }>(
      `SELECT bid, height_m, hs FROM buildings WHERE bid IN ('b01','b13','b04','b03') ORDER BY bid`
    );
    expect(rows).toEqual([
      { bid: 'b01', height_m: 12, hs: 0 },
      { bid: 'b03', height_m: 7, hs: 3 },
      { bid: 'b04', height_m: 12.4, hs: 2 },
      { bid: 'b13', height_m: 21.3, hs: 1 }
    ]);
  });

  it('drops underground and out-of-city buildings', async () => {
    const ids = (await db.all<{ bid: string }>('SELECT bid FROM buildings')).map((r) => r.bid);
    expect(ids).not.toContain('bunder');
    expect(ids).not.toContain('bmarin');
    const c = await counts();
    expect(c['buildings.input']).toBe(13);
    expect(c['buildings.underground_dropped']).toBe(1);
    expect(c['buildings.outside_nb_dropped']).toBe(1);
    expect(c['buildings.kept']).toBe(11);
  });

  it('clips a spanning building into 2 pieces and keeps the pier without parcelId', async () => {
    const b10 = await db.all<{ parcel_id: string }>(
      `SELECT parcel_id FROM pieces WHERE bid = 'b10' ORDER BY parcel_id`
    );
    expect(b10.map((r) => r.parcel_id)).toEqual(['3512010', '3512011']);
    const pier = await db.all<{ parcel_id: string | null }>(
      `SELECT parcel_id FROM pieces WHERE bid = 'bpier'`
    );
    expect(pier).toEqual([{ parcel_id: null }]);
    expect((await counts())['pieces.sliver_dropped']).toBeGreaterThanOrEqual(1);
  });

  it('computes floor area by rules 1–4', async () => {
    const fa = Object.fromEntries(
      (
        await db.all<{ id: string; floor_area_m2: number; fa_rule: number }>(
          `SELECT id, floor_area_m2, fa_rule FROM parcel_out WHERE id IN ('3512001','3512013','3512008','3512009')`
        )
      ).map((r) => [r.id, [r.floor_area_m2, r.fa_rule]])
    );
    expect(fa['3512001']).toEqual([Math.round(2000 * 0.09290304 * 10) / 10, 1]);
    expect(fa['3512013'][1]).toBe(2);
    expect(fa['3512013'][0]).toBeGreaterThan(0);
    expect(fa['3512008']).toEqual([960, 3]);
    expect(fa['3512009']).toEqual([0, 4]);
  });

  it('sets existing height to the tallest piece and orders the export', async () => {
    const [h] = await db.all<{ m: number }>(`SELECT max(height_m) m FROM parcel_out`);
    expect(h.m).toBe(60);
    const ex = await db.all<{ parcel_id: string | null }>('SELECT parcel_id FROM buildings_export');
    expect(ex[ex.length - 1].parcel_id).toBeNull();
    const nb = await db.all<{ name: string }>('SELECT name FROM neighborhoods_out');
    expect(nb.map((r) => r.name)).toEqual(['Bayview Hunters Point', 'Mission', 'Noe Valley']);
  });

  it('emits chunk-writer columns, ordered by id', async () => {
    const rows = await db.all<{
      id: string;
      geojson7131: string;
      xmin: number;
      xmax: number;
      ymin: number;
      ymax: number;
    }>('SELECT id, geojson7131, xmin, xmax, ymin, ymax FROM parcel_out');
    expect(rows).toHaveLength(17);
    expect(rows.map((r) => r.id)).toEqual(rows.map((r) => r.id).sort());
    expect(JSON.parse(rows[0].geojson7131).type).toMatch(/Polygon/);
    expect(rows[0].xmin).toBeLessThan(rows[0].xmax);
    expect(rows[0].ymin).toBeLessThan(rows[0].ymax);
    expect(rows[0].xmin).toBeLessThan(-122);
  });

  it('counts overture datasets and reports areas', async () => {
    const o = await db.all<{ dataset: string; n: number }>(
      'SELECT dataset, n FROM overture_contrib'
    );
    expect(o.length).toBeGreaterThan(0);
    expect(o.map((r) => r.dataset)).toEqual(o.map((r) => r.dataset).sort());
    const c = await counts();
    expect(c['height.max_m']).toBe(60);
    expect(c['pieces.outside_parcels']).toBeGreaterThanOrEqual(1);
    expect(c['pieces.area_with_parcel_m2']).toBeLessThan(c['pieces.area_total_m2']);
    expect(c['floor_area.rule4']).toBeGreaterThanOrEqual(1);
    const hs = c['buildings.hs0'] + c['buildings.hs1'] + c['buildings.hs2'] + c['buildings.hs3'];
    expect(hs).toBe(c['buildings.kept']);
  });

  it('ignores the right-of-way footprint and exports geojson', async () => {
    const [r] = await db.all<{ g: string }>(
      `SELECT geojson4326 g FROM buildings_export WHERE bid = 'b13'`
    );
    expect(JSON.parse(r.g).type).toMatch(/Polygon/);
  });

  it('refuses the unbuilt datasf fallback', async () => {
    config.renderSource = 'datasf';
    try {
      await expect(runSql(db)).rejects.toThrow("renderSource 'datasf' fallback not implemented");
    } finally {
      config.renderSource = 'overture';
    }
  });
});

describe('40/50 edge cases on synthetic sources', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    `ST_GeomFromText('POLYGON((${x0} ${y0},${x1} ${y0},${x1} ${y1},${x0} ${y1},${x0} ${y0}))')`;
  const X0 = -122.42;
  const Y0 = 37.76;
  async function synth(
    buildingX1: number,
    footprints: [string, string, number][],
    minHeight: number | null = null
  ): Promise<Duck> {
    const d = await openDuck();
    await d.run(`
      CREATE TABLE src_parcels(mapblklot VARCHAR, blklot VARCHAR, active BOOLEAN, analysis_neighborhood VARCHAR, geom GEOMETRY);
      CREATE TABLE src_landuse(mapblklot VARCHAR, landuse VARCHAR, resunits INTEGER, res DOUBLE, totalcomm DOUBLE, geom GEOMETRY);
      CREATE TABLE src_footprints(mblr VARCHAR, sf16_bldgid VARCHAR, hgt_median_m DOUBLE, geom GEOMETRY);
      CREATE TABLE src_neighborhoods(nhood VARCHAR, geom GEOMETRY);
      CREATE TABLE src_overture(id VARCHAR, height DOUBLE, num_floors INTEGER, min_height DOUBLE, is_underground BOOLEAN, datasets VARCHAR[], geom GEOMETRY);
      CREATE TABLE src_land(layer VARCHAR, z INTEGER, x INTEGER, y INTEGER, fid INTEGER, w DOUBLE, s DOUBLE, e DOUBLE, n DOUBLE, geojson VARCHAR);
      INSERT INTO src_parcels VALUES ('P1', 'P1', TRUE, 'N', ${rect(X0, Y0, X0 + 1e-4, Y0 + 1e-4)});
      INSERT INTO src_neighborhoods VALUES ('N', ${rect(X0 - 1e-3, Y0 - 1e-3, X0 + 1e-3, Y0 + 1e-3)});
      INSERT INTO src_overture VALUES ('bx', NULL, NULL, ${minHeight}, FALSE, ['osm'], ${rect(X0, Y0, buildingX1, Y0 + 1e-4)});
    `);
    for (const [mblr, id, h] of footprints) {
      await d.run(
        `INSERT INTO src_footprints VALUES ('${mblr}', '${id}', ${h}, ${rect(X0, Y0, buildingX1, Y0 + 1e-4)})`
      );
    }
    return d;
  }

  it('breaks an IoU tie with the smaller sf16_bldgid', async () => {
    const d = await synth(X0 + 1e-4, [
      ['SFP1', '201006.0000002', 30],
      ['SFP1', '201006.0000001', 20]
    ]);
    await runSql(d);
    expect(await d.all(`SELECT height_m, hs FROM buildings`)).toEqual([{ height_m: 20, hs: 1 }]);
  });

  it('ignores a footprint whose hgt_median_m is not positive (falls through to rule 3)', async () => {
    const d = await synth(X0 + 1e-4, [
      ['SFP1', '201006.0000001', 0],
      ['SFP1', '201006.0000002', -1]
    ]);
    await runSql(d);
    expect(await d.all(`SELECT height_m, hs FROM buildings`)).toEqual([{ height_m: 7, hs: 3 }]);
  });

  it('rounds base_m to 0.1', async () => {
    const d = await synth(X0 + 1e-4, [], 3.14159);
    await runSql(d);
    expect(await d.all(`SELECT base_m FROM buildings`)).toEqual([{ base_m: 3.1 }]);
  });

  it('counts a remainder under 2 m² and emits no NULL-parcel piece', async () => {
    const d = await synth(X0 + 1e-4 + 1e-6, []);
    await runSql(d);
    const c = Object.fromEntries(
      (await d.all<{ key: string; value: number }>('SELECT key, value FROM report_counts')).map(
        (r) => [r.key, r.value]
      )
    );
    expect(c['pieces.remainder_sliver_dropped']).toBe(1);
    expect(c['pieces.sliver_dropped']).toBe(1);
    expect(await d.all(`SELECT parcel_id FROM pieces`)).toEqual([{ parcel_id: 'P1' }]);
  });
});
