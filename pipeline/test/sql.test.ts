import { beforeAll, describe, expect, it } from 'vitest';
import { runSql } from '../lib/sql';
import type { Duck } from '../lib/duck';
import { readFileSync } from 'node:fs';
import { KNOWN_LANDUSE } from '../config';
import { miniDuck } from './helpers';

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
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.id)).toContain('3512002');
    expect(rows.map((r) => r.id)).not.toContain('3512099');
    const c = await counts();
    expect(c['parcels.null_id_dropped']).toBe(1);
    expect(c['parcels.condo_sublots']).toBe(3);
    expect(c['parcels.condo_geom_mismatch']).toBe(1);
    expect(c['parcels.distinct_active_ids']).toBe(14);
    expect(c['parcels.emitted']).toBe(14);
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
    expect(c['landuse.rows']).toBe(15);
    expect(c['landuse.duplicate_ids']).toBe(1);
    expect(c['landuse.matched_parcels']).toBe(12);
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
    expect(r).toEqual({ n: 14, d: 14 });
    expect(await db.all('SELECT * FROM landuse_unknown_values')).toEqual([]);
  });

  it('hard-codes the same known codes as config.ts', () => {
    const sql = readFileSync(new URL('../sql/20_landuse.sql', import.meta.url), 'utf8');
    for (const code of KNOWN_LANDUSE) expect(sql).toContain(`'${code}'`);
  });
});
