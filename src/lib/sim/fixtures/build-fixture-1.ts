// Builds the host test dataset fixture-1 from plan-model's grid-20x20 (spec §6, R19).
// Run once: npx tsx src/lib/sim/fixtures/build-fixture-1.ts. The output is committed.
// Relative imports: tsx does not resolve $lib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeParcelChunk } from '../../data/parcel-chunk';
import { GRID_CHUNKS } from '../../plan/fixtures/grid-20x20';

const VERSION = 'fixture-1';
const BASE = `/data/${VERSION}`;
const PAD = 1e-6;
const CELL_OF: Record<string, string> = { q00: '0_0', q10: '1_0', q01: '0_1', q11: '1_1' };

const out = join(dirname(fileURLToPath(import.meta.url)), 'data', VERSION);
mkdirSync(join(out, 'parcels'), { recursive: true });

const chunks = GRID_CHUNKS.map(({ cellId: q, records }) => {
  const cellId = CELL_OF[q];
  const lngs = records.map((r) => r.labelPoint[0]);
  const lats = records.map((r) => r.labelPoint[1]);
  writeFileSync(
    join(out, 'parcels', `${cellId}.json`),
    encodeParcelChunk(VERSION, cellId, records) + '\n'
  );
  return {
    cellId,
    bbox: [
      Math.min(...lngs) - PAD,
      Math.min(...lats) - PAD,
      Math.max(...lngs) + PAD,
      Math.max(...lats) + PAD
    ],
    url: `${BASE}/parcels/${cellId}.json`,
    parcelCount: records.length
  };
});

const manifest = {
  datasetVersion: VERSION,
  builtAt: '2026-10-10T00:00:00.000Z',
  sources: [],
  chunks,
  buildingsTiles: `${BASE}/buildings/{z}/{x}/{y}.pbf`,
  basemapTiles: `${BASE}/basemap/{z}/{x}/{y}.pbf`,
  glyphs: `${BASE}/glyphs/{fontstack}/{range}.pbf`,
  neighborhoods: `${BASE}/neighborhoods.geojson`
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${out}`);
