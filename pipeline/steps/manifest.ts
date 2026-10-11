import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import type { Lock } from '../lib/lock';
import type { ChunkOut } from './chunks';

/** Overture contributing datasets (spec §4.8, §4.12) -> SPDX licence. */
const OVERTURE_LICENSES: Record<string, string> = {
  OpenStreetMap: 'ODbL-1.0',
  'USGS Lidar': 'ODbL-1.0',
  'Microsoft ML Buildings': 'ODbL-1.0',
  'Esri Community Maps': 'CC-BY-4.0'
};
const OVERTURE_ATTRIBUTION = 'https://docs.overturemaps.org/attribution';
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** I12 manifest from the build outputs; validated with parseManifest before it is returned. */
export function buildManifest(a: {
  datasetVersion: string;
  builtAt: string;
  lock: Lock;
  chunks: ChunkOut[];
  overtureContrib: { dataset: string; n: number }[];
  warn?: (msg: string) => void;
}): Manifest {
  const v = a.datasetVersion;
  const base = `/data/${v}`;
  const lockSources = [...a.lock.sources].sort((x, y) => cmp(x.id, y.id));
  const overture = a.lock.sources.find((s) => s.id === 'overture-buildings');
  const sources: Manifest['sources'] = lockSources.map((s) => ({
    id: s.id,
    ...(s.label !== undefined ? { label: s.label } : {}),
    url: s.homepage,
    retrievedAt: s.retrievedAt,
    license: s.license
  }));
  for (const { dataset } of [...a.overtureContrib].sort((x, y) => cmp(x.dataset, y.dataset))) {
    let license = OVERTURE_LICENSES[dataset];
    if (license === undefined) {
      license = 'ODbL-1.0';
      a.warn?.(`unknown Overture dataset '${dataset}': licence assumed ODbL-1.0`);
    }
    if (!overture)
      throw new Error('overture_contrib present but the lock has no overture-buildings');
    sources.push({
      id: `overture:${dataset}`,
      label: `${dataset} via Overture Maps`,
      url: OVERTURE_ATTRIBUTION,
      retrievedAt: overture.retrievedAt,
      license
    });
  }
  return parseManifest({
    datasetVersion: v,
    builtAt: a.builtAt,
    sources,
    chunks: a.chunks.map((c) => ({
      cellId: c.cellId,
      bbox: c.bbox,
      url: `${base}/${c.path}`,
      parcelCount: c.parcelCount
    })),
    buildingsTiles: `${base}/buildings.pmtiles`,
    basemapTiles: `${base}/basemap.pmtiles`,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    neighborhoods: `${base}/neighborhoods.geojson`
  });
}

/** Write `<outDir>/manifest.json` with no whitespace; returns its size in bytes. */
export function writeManifest(outDir: string, m: Manifest): number {
  const buf = Buffer.from(JSON.stringify(m, null, 0));
  writeFileSync(join(outDir, 'manifest.json'), buf);
  return buf.length;
}
