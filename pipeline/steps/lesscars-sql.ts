// /lesscars freed-land SQL stage: writes the removal inputs and runs 84_lesscars_sites.sql, which
// carves removed right-of-way into lc_site and lc_site_neighbour. Not part of SQL_FILES / runSql.
import path from 'node:path';
import type { LessCarsPlan } from '../../src/lib/data/lesscars/plan';
import type { ParcelId } from '../../src/lib/data/parcel';
import { createTableFromRows, runSqlFile, type Duck } from '../lib/duck';
import { freewayLandSet, type FreewayLandFile } from '../lib/lesscars/freeway-land';
import { LC } from '../lesscars-config';

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

/** One removal or truncation: CNNs of src_streets and drawn lines in [lng, lat]. */
export interface FreedRemoval {
  projectId: string;
  cnns: string[];
  lines: [number, number][][];
  rowHalfWidthM: number;
  /** freewayLand parcels; heldBy is the garage standing on it, else null. */
  parcels: { id: ParcelId; heldBy: string | null }[];
}

/**
 * The street removals and highway truncations of a plan, in plan order, each truncation with its
 * freewayLand parcels; a parcel an `edge-garage` `{ parcel }` stands on is held by that garage.
 */
export function removalsOf(plan: LessCarsPlan): FreedRemoval[] {
  const garageOn = new Map<ParcelId, string>();
  for (const p of plan.projects)
    if (p.kind === 'edge-garage' && 'parcel' in p.site) garageOn.set(p.site.parcel, p.id);
  const out: FreedRemoval[] = [];
  for (const p of plan.projects) {
    if (p.kind !== 'street-removal' && p.kind !== 'highway-truncation') continue;
    out.push({
      projectId: p.id,
      cnns: p.segments.flatMap((s) => ('cnn' in s ? s.cnn : [])),
      lines: p.segments.flatMap((s) => ('line' in s ? [s.line] : [])),
      rowHalfWidthM: p.rowHalfWidthM.value,
      parcels: (p.freewayLand?.parcels ?? []).map((id) => ({
        id,
        heldBy: garageOn.get(id) ?? null
      }))
    });
  }
  return out;
}

/** Parcels no freed site takes as its zoning neighbour: every catalog parcel and freed parcel. */
export function notNeighboursOf(
  catalog: FreewayLandFile | null,
  removed: readonly FreedRemoval[]
): Set<ParcelId> {
  return new Set([
    ...freewayLandSet(catalog),
    ...removed.flatMap((r) => r.parcels.map((p) => p.id))
  ]);
}

/** A ROW piece this close to a freed parcel's part merges into it (projection noise). */
const MERGE_M = 0.05;
/** A site lists a freed parcel it overlaps by more than this (projection noise). */
const OVERLAP_M2 = 1;

const wkt = (line: [number, number][]) =>
  `LINESTRING(${line.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;

/**
 * Carve the freed land of `removed` (earlier entries take precedence where bands overlap), with
 * each removal's freed parcels, into lc_site(site_id, project_id, k, area_m2, parcels, parcel_m2,
 * held_by, x0, y0, lng, lat, geojson7131, geojson4326) and lc_site_neighbour(site_id, parcel_id,
 * dist_m), replacing any earlier run's. No parcel of `notNeighbours` is a site's neighbour. Needs
 * runSql on `db`. Throws on a duplicate project id, a non-positive half-width, a line of fewer
 * than two points, a CNN src_streets lacks, a parcel freed twice, or a freed parcel `parcels`
 * lacks.
 */
export async function carveFreedLand(
  db: Duck,
  removed: FreedRemoval[],
  notNeighbours: ReadonlySet<ParcelId>
): Promise<void> {
  const ids = new Set<string>();
  const freed = new Set<ParcelId>();
  for (const r of removed) {
    if (ids.has(r.projectId)) throw new Error(`lesscars: removal ${r.projectId} given twice`);
    ids.add(r.projectId);
    if (!(r.rowHalfWidthM > 0))
      throw new Error(`lesscars: removal ${r.projectId} has half-width ${r.rowHalfWidthM}`);
    for (const l of r.lines)
      if (l.length < 2) throw new Error(`lesscars: removal ${r.projectId} has a one-point line`);
    for (const p of r.parcels) {
      if (freed.has(p.id)) throw new Error(`lesscars: parcel ${p.id} is freed twice`);
      freed.add(p.id);
    }
  }
  await createTableFromRows(
    db,
    'lc_in_parcel',
    [
      ['project_id', 'VARCHAR'],
      ['parcel_id', 'VARCHAR'],
      ['held_by', 'VARCHAR']
    ],
    removed.flatMap((r) => r.parcels.map((p) => [r.projectId, p.id, p.heldBy]))
  );
  await createTableFromRows(
    db,
    'lc_in_not_neighbour',
    [['parcel_id', 'VARCHAR']],
    [...new Set([...notNeighbours, ...freed])].sort().map((id) => [id])
  );
  const lost = await db.all<{ parcel_id: string }>(
    `SELECT parcel_id FROM lc_in_parcel WHERE parcel_id NOT IN (SELECT id FROM parcels)
     ORDER BY parcel_id`
  );
  if (lost.length > 0)
    throw new Error(`lesscars: freed parcels ${lost.map((x) => x.parcel_id).join(', ')} unknown`);
  await createTableFromRows(
    db,
    'lc_in',
    [
      ['project_id', 'VARCHAR'],
      ['ord', 'INTEGER'],
      ['row_half_m', 'DOUBLE']
    ],
    removed.map((r, i) => [r.projectId, i, r.rowHalfWidthM])
  );
  await createTableFromRows(
    db,
    'lc_in_cnn',
    [
      ['project_id', 'VARCHAR'],
      ['cnn', 'VARCHAR']
    ],
    removed.flatMap((r) => r.cnns.map((c) => [r.projectId, c]))
  );
  await createTableFromRows(
    db,
    'lc_in_line',
    [
      ['project_id', 'VARCHAR'],
      ['li', 'INTEGER'],
      ['wkt', 'VARCHAR']
    ],
    removed.flatMap((r) => r.lines.map((l, i) => [r.projectId, i, wkt(l)]))
  );
  const missing = await db.all<{ project_id: string; cnn: string }>(
    `SELECT project_id, cnn FROM lc_in_cnn
     WHERE cnn NOT IN (SELECT cnn FROM src_streets WHERE cnn IS NOT NULL)
     ORDER BY project_id, cnn`
  );
  if (missing.length > 0)
    throw new Error(
      `lesscars: unknown CNNs ${missing.map((m) => `${m.project_id}:${m.cnn}`).join(', ')}`
    );
  const vars: [string, number][] = [
    ['lc_keep_half_m', LC.keepHalfM],
    ['lc_access_m', LC.accessM],
    ['lc_lot_max_m', LC.lotMaxM],
    ['lc_min_piece_m2', LC.minPieceM2],
    ['lc_neighbour_m', LC.neighbourM],
    ['lc_merge_m', MERGE_M],
    ['lc_overlap_m2', OVERLAP_M2]
  ];
  for (const [name, value] of vars)
    await db.run(`SET VARIABLE ${name} = CAST('${value}' AS DOUBLE)`);
  await runSqlFile(db, path.join(SQL_DIR, '84_lesscars_sites.sql'));
}

/** One stop for 85_lesscars_reach.sql; `parcels` false means freed sites only. */
export interface ReachStop {
  id: string;
  tier: 1 | 2;
  lng: number;
  lat: number;
  parcels: boolean;
}

/**
 * Write lc_stops and run 85_lesscars_reach.sql, which writes lc_reach(id, stop_id, dist_m) for
 * parcels (against `parcels` stops) and lc_site pieces (against every stop) within ½ mile,
 * replacing any earlier run's. Needs runSql and carveFreedLand on `db`.
 */
export async function reachLessCars(db: Duck, stops: ReachStop[]): Promise<void> {
  await createTableFromRows(
    db,
    'lc_stops',
    [
      ['id', 'VARCHAR'],
      ['tier', 'INTEGER'],
      ['lng', 'DOUBLE'],
      ['lat', 'DOUBLE'],
      ['parcels', 'BOOLEAN']
    ],
    stops.map((s) => [s.id, s.tier, s.lng, s.lat, s.parcels])
  );
  await runSqlFile(db, path.join(SQL_DIR, '85_lesscars_reach.sql'));
}
