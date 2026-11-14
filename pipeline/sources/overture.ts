import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BBOX } from '../config';
import type { Duck } from '../lib/duck';
import type { Http } from '../lib/http';
import type { Lock, LockEntry } from '../lib/lock';
import { storeFile } from '../lib/raw';

export const STAC_CATALOG = 'https://stac.overturemaps.org/catalog.json';

/** `latest` field of the Overture STAC root catalog (e.g. "2026-09-23.1"). */
export async function latestOvertureRelease(http: Http): Promise<string> {
  const res = await http.get(STAC_CATALOG);
  if (res.status !== 200) throw new Error(`GET ${STAC_CATALOG}: HTTP ${res.status}`);
  const { latest } = JSON.parse(new TextDecoder().decode(res.body)) as { latest?: string };
  if (!latest || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(latest)) {
    throw new Error(`Overture STAC catalog has no usable \`latest\` field (got ${String(latest)})`);
  }
  return latest;
}

/**
 * Spec §4.1: DuckDB reads the release's building parquet over S3 (anonymous), clips to the
 * bbox and writes one parquet ordered by id in the `src_overture` shape. `db` must have httpfs.
 */
export async function fetchOverture(
  release: string | undefined,
  rawDir: string,
  db: Duck,
  http: Http
): Promise<LockEntry> {
  const rel = release ?? (await latestOvertureRelease(http));
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(rel)) throw new Error(`bad Overture release: ${rel}`);
  const glob = `s3://overturemaps-us-west-2/release/${rel}/theme=buildings/type=building/*`;
  const dir = mkdtempSync(join(tmpdir(), 'sfh-overture-'));
  const out = join(dir, 'overture-buildings.parquet');
  try {
    await db.run("SET s3_region='us-west-2'");
    await db.run(`COPY (
      SELECT id, height, num_floors, min_height, is_underground,
             list_transform(sources, s -> s.dataset) AS datasets, geometry AS geom
      FROM read_parquet('${glob}', hive_partitioning=1)
      WHERE bbox.xmin >= ${BBOX.w} AND bbox.xmax <= ${BBOX.e}
        AND bbox.ymin >= ${BBOX.s} AND bbox.ymax <= ${BBOX.n}
      ORDER BY id
    ) TO '${out}' (FORMAT parquet)`);
    const [r] = await db.all<{ n: number }>(`SELECT count(*) AS n FROM read_parquet('${out}')`);
    const file = await storeFile(rawDir, 'overture-buildings.parquet', glob, out);
    return {
      id: 'overture-buildings',
      files: [file],
      retrievedAt: new Date().toISOString(),
      upstreamVersion: rel,
      rowCount: r.n,
      license: 'ODbL-1.0',
      label: 'Overture Maps Buildings',
      homepage: 'https://overturemaps.org'
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Building parts of the same release as `overture-buildings`: parts reference their building's id,
 * so a release mismatch would orphan them. Same bbox filter, ordered by id.
 */
export async function fetchOvertureParts(
  release: string,
  rawDir: string,
  db: Duck
): Promise<LockEntry> {
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release)) {
    throw new Error(`bad Overture release: ${release}`);
  }
  const glob = `s3://overturemaps-us-west-2/release/${release}/theme=buildings/type=building_part/*`;
  const dir = mkdtempSync(join(tmpdir(), 'sfh-overture-parts-'));
  const out = join(dir, 'overture-building-parts.parquet');
  try {
    await db.run("SET s3_region='us-west-2'");
    await db.run(`COPY (
      SELECT id, building_id, height, min_height, roof_shape, roof_height, num_floors, min_floor,
             list_transform(sources, s -> s.dataset) AS datasets, geometry AS geom
      FROM read_parquet('${glob}', hive_partitioning=1)
      WHERE bbox.xmin >= ${BBOX.w} AND bbox.xmax <= ${BBOX.e}
        AND bbox.ymin >= ${BBOX.s} AND bbox.ymax <= ${BBOX.n}
      ORDER BY id
    ) TO '${out}' (FORMAT parquet)`);
    const [r] = await db.all<{ n: number }>(`SELECT count(*) AS n FROM read_parquet('${out}')`);
    const file = await storeFile(rawDir, 'overture-building-parts.parquet', glob, out);
    return {
      id: 'overture-building-parts',
      files: [file],
      retrievedAt: new Date().toISOString(),
      upstreamVersion: release,
      rowCount: r.n,
      license: 'ODbL-1.0',
      label: 'Overture Maps Building Parts',
      homepage: 'https://overturemaps.org'
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** null when consistent or parts are absent; else the message naming both releases. */
export function overtureReleaseProblem(lock: Lock): string | null {
  const parts = lock.sources.find((s) => s.id === 'overture-building-parts');
  const buildings = lock.sources.find((s) => s.id === 'overture-buildings');
  if (!parts || !buildings || parts.upstreamVersion === buildings.upstreamVersion) return null;
  return `overture-building-parts release ${parts.upstreamVersion} differs from overture-buildings ${buildings.upstreamVersion}; refetch both with --release`;
}
