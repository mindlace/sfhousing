import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_STACKS, type BBOX } from '../config';
import type { Duck } from '../lib/duck';
import { run } from '../lib/exec';

interface ExportRow {
  parcel_id: string | null;
  height_m: number;
  base_m: number;
  hs: number;
  geojson4326: string;
}

/** Write buildings.geojsonseq (workDir) from buildings_export and tile it to outDir/buildings.pmtiles. */
export async function writeBuildingsTiles(
  db: Duck,
  outDir: string,
  workDir: string
): Promise<void> {
  const rows = await db.all<ExportRow>(
    'SELECT parcel_id, height_m, base_m, hs, geojson4326 FROM buildings_export ORDER BY parcel_id NULLS LAST, bid'
  );
  const lines = rows.map((r) => {
    const properties: Record<string, unknown> = {};
    if (r.parcel_id !== null) properties.parcelId = r.parcel_id;
    properties.heightM = r.height_m;
    properties.baseM = r.base_m;
    properties.hs = r.hs;
    return JSON.stringify({ type: 'Feature', properties, geometry: JSON.parse(r.geojson4326) });
  });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const seqFile = join(workDir, 'buildings.geojsonseq');
  writeFileSync(seqFile, lines.join('\n') + '\n');
  const out = join(outDir, 'buildings.pmtiles');
  const r = await run(
    'tippecanoe',
    [
      '-o',
      out,
      '-l',
      'buildings',
      '-Z',
      '12',
      '-z',
      '15',
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
      seqFile
    ],
    { input: '' }
  );
  if (r.code !== 0) throw new Error(`tippecanoe failed (${r.code}): ${r.stderr}`);
}

export function copyBasemap(rawFile: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  copyFileSync(rawFile, join(outDir, 'basemap.pmtiles'));
}

/** Copy <root>/<Stack Name>/*.pbf to outDir/fonts/<NoSpaceName>/; returns the stack names written. */
export function installFonts(fontsRoot: string, outDir: string): string[] {
  const written: string[] = [];
  for (const [src, dst] of Object.entries(FONT_STACKS)) {
    const srcDir = join(fontsRoot, src);
    if (!existsSync(srcDir)) throw new Error(`font stack missing: ${srcDir}`);
    const dstDir = join(outDir, 'fonts', dst);
    mkdirSync(dstDir, { recursive: true });
    for (const f of readdirSync(srcDir).filter((n) => n.endsWith('.pbf'))) {
      copyFileSync(join(srcDir, f), join(dstDir, f));
    }
    written.push(dst);
  }
  return written;
}

function tileBytes(file: string, z: number, x: number, y: number): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      'pmtiles',
      ['tile', file, String(z), String(x), String(y)],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        // An absent tile exits 0 with empty stdout; a real failure rejects.
        if (err) reject(new Error(`pmtiles tile ${z}/${x}/${y} failed: ${err.message}`));
        else resolve(stdout.length);
      }
    );
  });
}

/** Σ stored (gzip) tile bytes at z12 over the tiles covering bbox (spec §4.9 V11). Absent tiles count 0. */
export async function z12TileBytes(pmtilesFile: string, bbox: typeof BBOX): Promise<number> {
  const z = 12;
  const n = 2 ** z;
  const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const [x0, x1, y0, y1] = [tx(bbox.w), tx(bbox.e), ty(bbox.n), ty(bbox.s)];
  let total = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) total += await tileBytes(pmtilesFile, z, x, y);
  }
  return total;
}
