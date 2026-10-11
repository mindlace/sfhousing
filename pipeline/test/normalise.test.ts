import { describe, expect, it } from 'vitest';
import { miniDuck } from './helpers';

describe('normalise mini fixture', () => {
  it('loads every src_ table with the expected row counts and types', async () => {
    const db = await miniDuck();
    const counts = Object.fromEntries(
      (
        await db.all<{ t: string; n: number }>(
          `SELECT 'p' t, count(*) n FROM src_parcels UNION ALL SELECT 'l', count(*) FROM src_landuse
         UNION ALL SELECT 'f', count(*) FROM src_footprints UNION ALL SELECT 'n', count(*) FROM src_neighborhoods
         UNION ALL SELECT 'o', count(*) FROM src_overture`
        )
      ).map((r) => [r.t, r.n])
    );
    // parcels: 14 lots, lot 2 has 3 rows → 16, + 2 retired + 1 null-id = 19
    expect(counts).toEqual({ p: 19, l: 15, f: 3, n: 2, o: 12 });
    const [ids] = await db.all<{ ok: boolean }>(
      `SELECT bool_and(mapblklot IS NULL OR typeof(mapblklot) = 'VARCHAR') ok FROM src_parcels`
    );
    expect(ids.ok).toBe(true);
    const odd = await db.all<{ mapblklot: string }>(
      `SELECT mapblklot FROM src_parcels WHERE mapblklot IN ('0026T001A','8711023C') ORDER BY 1`
    );
    expect(odd.map((r) => r.mapblklot)).toEqual(['0026T001A', '8711023C']);
  });
});
