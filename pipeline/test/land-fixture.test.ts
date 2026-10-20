// The mini fixture's shoreline lots (mini README "Lots" 15–17) through the whole SQL chain:
// 45_land.sql clips them, 60_attributes.sql and 80_scenario.sql read the result.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Duck } from '../lib/duck';
import { createQualityTables } from '../lib/quality';
import { runSql } from '../lib/sql';
import { readParcelRecords } from '../steps/chunks';
import { runScenarioSql } from '../steps/scenario-sql';
import { miniDuck } from './helpers';

const SHORE = ['3512015', '3512016', '3512017'];

interface Lot {
  status: string;
  dry_m2: number;
  n_pieces: number;
  area_m2: number;
  eligible: boolean;
  underwater: boolean;
  same: boolean;
  label_inside: boolean;
  orig: string | null;
}

let db: Duck;
const lot = async (id: string) => {
  const [r] = await db.all<Lot>(
    `SELECT l.status, l.dry_m2, l.n_pieces, o.area_m2, o.eligible, o.underwater,
            hex(ST_AsWKB(p.geom)) = hex(ST_AsWKB(p.geom_orig)) AS same,
            ST_Contains(p.geom, ST_Point(p.x0, p.y0)) AS label_inside,
            o.geojson7131_orig AS orig
     FROM parcel_land l JOIN parcels p USING (id) JOIN parcel_out o USING (id)
     WHERE id = '${id}'`
  );
  return r;
};

describe('shoreline lots in the mini fixture', () => {
  beforeAll(async () => {
    db = await miniDuck();
    await createQualityTables(db);
    await runSql(db);
    await runScenarioSql(db, await readParcelRecords(db));
  });

  it('cuts the shoreline lot to its dry part', async () => {
    const r = await lot('3512015');
    expect(r.status).toBe('clipped');
    expect(Math.abs(r.dry_m2 - 960)).toBeLessThanOrEqual(2);
    expect(r.n_pieces).toBe(2);
    expect(Math.abs(r.area_m2 - 960)).toBeLessThanOrEqual(2);
    expect(r.label_inside).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.underwater).toBe(false);
    expect(JSON.parse(r.orig ?? 'null').type).toBe('Polygon');
  });

  it('flags the lot in the water and keeps its outline and area', async () => {
    const r = await lot('3512016');
    expect(r.status).toBe('underwater');
    expect(r.underwater).toBe(true);
    expect(r.eligible).toBe(false);
    expect(Math.abs(r.area_m2 - 600)).toBeLessThanOrEqual(0.5);
    expect(r.same).toBe(true);
    expect(r.orig).toBeNull();
  });

  it('keeps a lot that only grazes the shoreline', async () => {
    const r = await lot('3512017');
    expect(r.status).toBe('jitter');
    expect(r.same).toBe(true);
    expect(r.underwater).toBe(false);
    expect(r.orig).toBeNull();
  });

  it('leaves every inland lot unchanged', async () => {
    const rows = await db.all<{ id: string; status: string; same: boolean; orig: string | null }>(
      `SELECT l.id, l.status, hex(ST_AsWKB(p.geom)) = hex(ST_AsWKB(p.geom_orig)) AS same,
              o.geojson7131_orig AS orig
       FROM parcel_land l JOIN parcels p USING (id) JOIN parcel_out o USING (id)
       WHERE l.id NOT IN (${SHORE.map((id) => `'${id}'`).join(', ')})
       ORDER BY l.id`
    );
    expect(rows).toHaveLength(14);
    for (const r of rows)
      expect(r, r.id).toMatchObject({ status: 'unchanged', same: true, orig: null });
  });

  it('matches retired lineage on the original polygon', async () => {
    const rows = await db.all<{ current_mapblklot: string | null }>(
      `SELECT current_mapblklot FROM parcel_lineage WHERE blklot = '3512096'`
    );
    expect(rows).toEqual([{ current_mapblklot: '3512015' }]);
  });

  it('reports the clip counts', async () => {
    const c = Object.fromEntries(
      (
        await db.all<{ key: string; value: number }>(
          `SELECT key, value FROM report_counts WHERE key LIKE 'land.%'`
        )
      ).map((r) => [r.key, r.value])
    );
    expect(c).toMatchObject({
      'land.clipped': 1,
      'land.underwater': 1,
      'land.jitter_kept': 1,
      'land.outside_tiles': 3
    });
  });
});
