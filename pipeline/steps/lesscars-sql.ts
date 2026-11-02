// /lesscars freed-land SQL stage: writes the removal inputs and runs 84_lesscars_sites.sql, which
// carves removed right-of-way into lc_site and lc_site_neighbour. Not part of SQL_FILES / runSql.
import path from 'node:path';
import type { LessCarsPlan } from '../../src/lib/data/lesscars/plan';
import { createTableFromRows, runSqlFile, type Duck } from '../lib/duck';
import { LC } from '../lesscars-config';

const SQL_DIR = path.resolve(import.meta.dirname, '../sql');

/** One removal or truncation: CNNs of src_streets and drawn lines in [lng, lat]. */
export interface FreedRemoval {
  projectId: string;
  cnns: string[];
  lines: [number, number][][];
  rowHalfWidthM: number;
}

/** The street removals and highway truncations of a plan, in plan order. */
export function removalsOf(plan: LessCarsPlan): FreedRemoval[] {
  const out: FreedRemoval[] = [];
  for (const p of plan.projects) {
    if (p.kind !== 'street-removal' && p.kind !== 'highway-truncation') continue;
    out.push({
      projectId: p.id,
      cnns: p.segments.flatMap((s) => ('cnn' in s ? s.cnn : [])),
      lines: p.segments.flatMap((s) => ('line' in s ? [s.line] : [])),
      rowHalfWidthM: p.rowHalfWidthM.value
    });
  }
  return out;
}

const wkt = (line: [number, number][]) =>
  `LINESTRING(${line.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;

/**
 * Carve the freed land of `removed` (earlier entries take precedence where bands overlap) into
 * lc_site(site_id, project_id, k, area_m2, x0, y0, lng, lat, geojson7131, geojson4326) and
 * lc_site_neighbour(site_id, parcel_id, dist_m), replacing any earlier run's. Needs runSql on
 * `db`. Throws on a duplicate project id, a non-positive half-width, a line of fewer than two
 * points, or a CNN src_streets lacks.
 */
export async function carveFreedLand(db: Duck, removed: FreedRemoval[]): Promise<void> {
  const ids = new Set<string>();
  for (const r of removed) {
    if (ids.has(r.projectId)) throw new Error(`lesscars: removal ${r.projectId} given twice`);
    ids.add(r.projectId);
    if (!(r.rowHalfWidthM > 0))
      throw new Error(`lesscars: removal ${r.projectId} has half-width ${r.rowHalfWidthM}`);
    for (const l of r.lines)
      if (l.length < 2) throw new Error(`lesscars: removal ${r.projectId} has a one-point line`);
  }
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
    ['lc_neighbour_m', LC.neighbourM]
  ];
  for (const [name, value] of vars)
    await db.run(`SET VARIABLE ${name} = CAST('${value}' AS DOUBLE)`);
  await runSqlFile(db, path.join(SQL_DIR, '84_lesscars_sites.sql'));
}
