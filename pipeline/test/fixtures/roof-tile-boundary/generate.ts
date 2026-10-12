import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Feature, Polygon } from 'geojson';

type Building = Feature<Polygon, { pieceId: string; buildingId: string; parcelId: string }>;
type Tile = { features: { properties: { layer: string }; features: Building[] }[] };
const here = import.meta.dirname;
const canonical = resolve(here, '../../../../e2e/fixtures/data/fixture-0/buildings.pmtiles');
const destination = join(here, 'buildings.pmtiles');
const pieceIds = ['p-4f95dedf1e4cbf31e3e45491', 'p-7e33516c53ae4a9d6cd9d679'];
const edgeLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * 405351) / 2 ** 20))) * 180) / Math.PI;
const bounds = (f: Building) => {
  const latitudes = f.geometry.coordinates.flat().map((p) => p[1]);
  return [Math.min(...latitudes), Math.max(...latitudes)];
};
function decode(file: string, z: number, x: number, y: number): Building[] {
  const tile = JSON.parse(
    execFileSync('tippecanoe-decode', [file, `${z}`, `${x}`, `${y}`], {
      encoding: 'utf8'
    })
  ) as Tile;
  return tile.features.find((layer) => layer.properties.layer === 'buildings')!.features;
}
const source = decode(canonical, 15, 5241, 12667).filter((f) => f.properties.buildingId === 'b10');
assert.deepEqual(source.map((f) => f.properties.pieceId).sort(), pieceIds);
const work = mkdtempSync(join(tmpdir(), 'sfh-roof-boundary-'));
try {
  writeFileSync(
    join(work, 'buildings.geojsonseq'),
    source.map((f) => JSON.stringify(f)).join('\n') + '\n'
  );
  // Same clipping/property options as the production tiler, except this test-only z20 range.
  // Retain tippecanoe's normal tile buffer: the test must distinguish clipped fragments,
  // not merely duplicate uncut geometry in neighboring buffered tiles.
  execFileSync(
    'tippecanoe',
    [
      '-o',
      'buildings.pmtiles',
      '-l',
      'buildings',
      '-Z',
      '20',
      '-z',
      '20',
      '-y',
      'pieceId',
      '-y',
      'buildingId',
      '-T',
      'pieceId:string',
      '-T',
      'buildingId:string',
      '-y',
      'parcelId',
      '-y',
      'heightM',
      '-y',
      'baseM',
      '-y',
      'hs',
      '-T',
      'parcelId:string',
      '-T',
      'heightM:float',
      '-T',
      'baseM:float',
      '-T',
      'hs:int',
      '--drop-smallest-as-needed',
      '--maximum-tile-bytes=400000',
      '--no-simplification-of-shared-nodes',
      '--force',
      'buildings.geojsonseq'
    ],
    { cwd: work, stdio: 'pipe' }
  );
  const generated = join(work, 'buildings.pmtiles');
  const north = decode(generated, 20, 167718, 405350);
  const south = decode(generated, 20, 167718, 405351);
  for (const original of source) {
    const id = original.properties.pieceId;
    const n = north.filter((f) => f.properties.pieceId === id);
    const s = south.filter((f) => f.properties.pieceId === id);
    assert.equal(n.length, 1);
    assert.equal(s.length, 1);
    assert.deepEqual(n[0].properties, original.properties);
    assert.deepEqual(s[0].properties, original.properties);
    const [lo, hi] = bounds(original),
      [nlo, nhi] = bounds(n[0]),
      [slo, shi] = bounds(s[0]);
    assert(lo < edgeLat && hi > edgeLat, 'canonical piece must cross the actual tile edge');
    assert(nlo > lo && shi < hi, 'both tile geometries must be clipped, not full duplicates');
    assert(nlo < edgeLat && shi > edgeLat, 'normal tile buffers must overlap the edge');
    assert(nhi > shi && nlo > slo, 'north and south fragments must have distinct extents');
    console.log(
      `${id}: north 20/167718/405350 [${nlo},${nhi}], south 20/167718/405351 [${slo},${shi}], edge ${edgeLat}`
    );
  }
  const bytes = readFileSync(generated);
  if (process.argv.includes('--check')) assert.deepEqual(readFileSync(destination), bytes);
  else writeFileSync(destination, bytes);
  console.log(
    `${process.argv.includes('--check') ? 'Verified deterministic' : 'Generated'} ${bytes.length}-byte tile-boundary fixture`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
