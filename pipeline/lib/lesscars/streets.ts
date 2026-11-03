// The locked datasf-streets loader shared by `lesscars-cnns` and `lesscars-freeway-land`: the
// lock's raw files normalised to street segments (offline, never the network).
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDuck } from '../duck';
import { rawPath, readLock } from '../lock';
import { normalise } from '../../sources/normalise';
import type { StreetSeg } from './corridors';

export const STREETS_SOURCE_ID = 'datasf-streets';

type Geo =
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] };

const linesOf = (g: Geo): [number, number][][] =>
  g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];

/**
 * Every named street segment of the locked datasf-streets source, ordered by CNN, its lines in
 * `crs` (the build CRS EPSG:7131 as normalised, or [lng, lat] EPSG:4326), with the source's file
 * hashes as `sha256`. Throws an Error naming the problem: no lock, no entry, or a raw file missing.
 */
export async function loadLockedStreets(a: {
  lockPath: string;
  rawDir: string;
  byName?: boolean;
  crs: 'EPSG:7131' | 'EPSG:4326';
}): Promise<StreetSeg[] & { sha256: string[] }> {
  if (!existsSync(a.lockPath)) {
    throw new Error(`no ${a.lockPath}: run \`npm run pipeline -- fetch\` first`);
  }
  const entry = readLock(a.lockPath).sources.find((s) => s.id === STREETS_SOURCE_ID);
  if (!entry) {
    throw new Error(
      `${a.lockPath} has no ${STREETS_SOURCE_ID} entry: fetch it with --only ${STREETS_SOURCE_ID}`
    );
  }
  const files = entry.files.map((f) => rawPath(a.rawDir, f, a.byName));
  const missing = entry.files.filter((_, i) => !existsSync(files[i]));
  if (missing.length > 0) {
    throw new Error(
      missing
        .map((f) => `${STREETS_SOURCE_ID}: missing raw file ${f.name} (${f.sha256})`)
        .join('\n')
    );
  }
  const tmp = mkdtempSync(join(tmpdir(), 'sfh-lc-streets-'));
  const db = await openDuck();
  try {
    const parquet = join(tmp, `${STREETS_SOURCE_ID}.parquet`);
    await normalise(db, STREETS_SOURCE_ID, files, parquet);
    const geom =
      a.crs === 'EPSG:7131'
        ? 'geom'
        : "ST_Transform(geom, 'EPSG:7131', 'EPSG:4326', always_xy := true)";
    const rows = await db.all<{
      cnn: string;
      streetname: string | null;
      f_st: string | null;
      t_st: string | null;
      g: string;
    }>(
      `SELECT cnn, streetname, f_st, t_st, ST_AsGeoJSON(${geom}) g
       FROM read_parquet('${parquet.replaceAll("'", "''")}')
       WHERE cnn IS NOT NULL AND streetname IS NOT NULL AND geom IS NOT NULL ORDER BY cnn`
    );
    const segs = rows.map((r) => ({
      cnn: r.cnn,
      streetname: r.streetname!,
      fSt: r.f_st,
      tSt: r.t_st,
      lines: linesOf(JSON.parse(r.g) as Geo)
    }));
    return Object.assign(segs, { sha256: entry.files.map((f) => f.sha256) });
  } finally {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
