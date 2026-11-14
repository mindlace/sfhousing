// Registration clusters (spec "Registration", step 1): footprints within regTouchM of each other
// whose main parcels share an assessor block fit as one rigid body. A street splits blocks, so a
// row of houses across the street is a separate cluster.
import { BOXES } from '../../boxes-config.js';
import { UnionFind } from '../../project-records/union-find.js';
import type { Duck } from '../duck.js';
import { SQL_BLOCK_OF } from '../road-lots.js';

/**
 * bid -> cluster id (its smallest member bid), for every row of `buildings`. A building's main
 * parcel is the parcel of its largest piece (ties by parcel id). A building with no parcel piece
 * has no block and is its own cluster. Reads `buildings` and `pieces` (read only).
 *
 * "Within regTouchM" is intersecting, or boundaries within regTouchM: DuckDB spatial's polygon
 * ST_Distance / ST_DWithin give 0 for disjoint polygons whose extents line up in x or y (two
 * 10 m squares 90 m apart in one column measure 0), so the polygon form would merge them.
 */
export async function clusterBuildings(db: Duck): Promise<Map<string, string>> {
  const bids = await db.all<{ bid: string }>('SELECT bid FROM buildings ORDER BY bid');
  const pairs = await db.all<{ a: string; b: string }>(`
    WITH main_parcel AS (
      SELECT bid, parcel_id FROM pieces
      WHERE parcel_id IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY bid ORDER BY area_m2 DESC, parcel_id) = 1
    ),
    blocked AS (
      SELECT b.bid, b.geom, nullif(${SQL_BLOCK_OF('m.parcel_id')}, '') AS block
      FROM buildings b JOIN main_parcel m USING (bid)
    )
    SELECT a.bid AS a, b.bid AS b
    FROM blocked a JOIN blocked b
      ON a.block = b.block AND a.bid < b.bid
     AND (ST_Intersects(a.geom, b.geom)
          OR ST_DWithin(ST_Boundary(a.geom), ST_Boundary(b.geom), ${BOXES.regTouchM}))
    ORDER BY a, b`);
  const uf = new UnionFind();
  for (const { bid } of bids) uf.add(bid);
  for (const { a, b } of pairs) uf.union(a, b);
  return new Map(bids.map(({ bid }) => [bid, uf.find(bid)]));
}
