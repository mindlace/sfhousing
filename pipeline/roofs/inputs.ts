import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Duck } from '../lib/duck';
import { rawPath, verifyRaw, type Lock } from '../lib/lock';
import { run } from '../lib/exec';
import type { RoofJob, RoofInputBuilding } from './job';

const ROOT = resolve(import.meta.dirname, '../..');
export async function prepareRoofJob(
  db: Duck,
  lock: Lock,
  opts: {
    rawDir: string;
    rawByName: boolean;
    datasetVersion: string;
    workDir: string;
  }
): Promise<RoofJob> {
  const entries = lock.sources.filter((s) => s.id === 'roof-lidar' || s.id === 'roof-aerial');
  const errors = await verifyRaw({ sources: entries }, opts.rawDir, { byName: opts.rawByName });
  if (errors.length) throw new Error(errors.join('\n'));
  const sources: RoofJob['sources'] = [],
    sourceStatus: RoofJob['sourceStatus'] = [];
  for (const entry of entries) {
    if (!entry.spatial) throw new Error(`missing spatial metadata: ${entry.id}`);
    sourceStatus.push({ sourceId: entry.id, spatial: entry.spatial });
    if (
      entry.id === 'roof-aerial' &&
      entry.files.length &&
      entry.spatial.permission !== 'confirmed'
    ) {
      throw new Error('aerial derivation permission is unconfirmed');
    }
    for (const f of entry.files) {
      if (!f.name.endsWith('.laz') && !f.name.endsWith('.png')) continue;
      sources.push({
        ...entry.spatial,
        kind: entry.id === 'roof-lidar' ? 'lidar' : 'aerial',
        sourceId: entry.id,
        name: f.name,
        path: resolve(rawPath(opts.rawDir, f, opts.rawByName)),
        sha256: f.sha256,
        url: f.url
      });
    }
  }
  const rows = await db.all<{
    buildingId: string;
    geometry: string;
    heightM: number;
    baseM: number;
    hs: number;
    bbox: [number, number, number, number];
    neighborhood: string | null;
  }>(`
    SELECT b.bid AS buildingId, ST_AsGeoJSON(b.geom) AS geometry,
      b.height_m AS heightM, b.base_m AS baseM, b.hs,
      [ST_XMin(b.geom),ST_YMin(b.geom),ST_XMax(b.geom),ST_YMax(b.geom)] AS bbox,
      (SELECT n.nhood FROM nb7131 n WHERE ST_Intersects(b.geom,n.geom)
        ORDER BY ST_Area(ST_Intersection(b.geom,n.geom)) DESC,n.nhood LIMIT 1) AS neighborhood
    FROM buildings b ORDER BY b.bid`);
  const canonical = await run(
    join(ROOT, 'pipeline/.venv/bin/python'),
    [join(ROOT, 'pipeline/roofs/geometry.py')],
    {
      input: JSON.stringify(rows.map((r) => JSON.parse(r.geometry)))
    }
  );
  if (canonical.code !== 0)
    throw new Error(`roof geometry failed (run pipeline setup-roofs): ${canonical.stderr}`);
  const shapes = JSON.parse(canonical.stdout) as Pick<
    RoofInputBuilding,
    'footprint' | 'footprintHash'
  >[];
  const spatial = entries.find((e) => e.id === 'roof-lidar')?.spatial;
  const buildings: RoofInputBuilding[] = rows.map(({ geometry: _, ...b }, i) => ({
    ...b,
    ...shapes[i],
    horizontalCrs: 'EPSG:7131',
    sourceDates: {
      acquisitionStart: spatial?.acquisitionStart ?? null,
      acquisitionEnd: spatial?.acquisitionEnd ?? null
    }
  }));
  const toolchainHash = createHash('sha256')
    .update(readFileSync(join(ROOT, 'pipeline/roofs/toolchain.json')))
    .digest('hex');
  mkdirSync(opts.workDir, { recursive: true });
  const job: RoofJob = {
    schemaVersion: 1,
    datasetVersion: opts.datasetVersion,
    buildings,
    sources,
    sourceStatus,
    configPath: join(ROOT, 'pipeline/roofs/config.json'),
    toolchainHash,
    workDir: resolve(opts.workDir)
  };
  writeFileSync(join(opts.workDir, 'job.json'), JSON.stringify(job) + '\n');
  return job;
}
