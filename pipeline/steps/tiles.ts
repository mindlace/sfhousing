import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOXES } from '../boxes-config';
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

interface RenderExportRow extends ExportRow {
  src: string;
  ground_m: number | null;
  ground_min_m: number | null;
}

/** The buildings layer's attributes and tippecanoe types (`-y`, `-T`), in argument order. */
const TODAY_FIELDS: [string, string][] = [
  ['parcelId', 'string'],
  ['heightM', 'float'],
  ['baseM', 'float'],
  ['hs', 'int']
];
/** The z14+ render boxes' extra attributes. */
const SPLIT_FIELDS: [string, string][] = [
  ['src', 'string'],
  ['groundM', 'float'],
  ['groundMinM', 'float']
];

/** tippecanoe's tile-too-big reports: `tile z/x/y size is N …` or `tile z/x/y has N features, …`. */
const TILE_REPORT = /(?:^|\s)tile (\d+)\/\d+\/\d+ (?:size is \d+|has \d+ features)/;

/**
 * How many of tippecanoe's tile-too-big reports in `stderr` are at zoom `minZoom` or above. With
 * `--drop-smallest-as-needed` each such report means features of that tile were dropped to fit.
 */
export function tileDropReports(stderr: string, minZoom: number): number {
  let n = 0;
  for (const line of stderr.split(/[\r\n]/)) {
    const m = TILE_REPORT.exec(line);
    if (m && Number(m[1]) >= minZoom) n++;
  }
  return n;
}

/** tippecanoe's stored (gzip) tile limit for the buildings archive without the boxes artifact. */
const MAX_TILE_BYTES = 400_000;

/**
 * The limit of the z14+ render boxes run. The first live build (2026-11-14) put 13 of 52 z14
 * tiles over 400 KB (largest 680 KB, downtown; z15 at most 209 KB), so 400 KB dropped boxes there
 * (V37). z12 needs its own run at MAX_TILE_BYTES: main's z12 tiles already exceed 400 KB and drop
 * their smallest buildings, and at 1 MB the z12 bytes doubled (V11's first paint). A z14 tile over
 * this limit still fails V37: the next step is `BOXES.splitZoom` 15, not a higher limit.
 */
export const SPLIT_MAX_TILE_BYTES = 1_000_000;

/**
 * Write buildings.geojsonseq (workDir) and tile it to outDir/buildings.pmtiles, one `buildings`
 * layer at z12–15.
 * - Without `split` (no building-boxes artifact): buildings_export only, exactly as before the
 *   boxes work (same input bytes and tippecanoe arguments).
 * - With `split`: two tippecanoe runs joined by tile-join. buildings.geojsonseq holds
 *   buildings_export at z12–13 (tippecanoe minzoom/maxzoom per feature, today's four properties),
 *   tiled under MAX_TILE_BYTES as before; boxes.geojsonseq holds render_export at z14–15
 *   (`BOXES.splitZoom`), which adds `src`, `groundM` and `groundMinM` (each left out when null),
 *   tiled under `maxTileBytes` (default SPLIT_MAX_TILE_BYTES). Returns how many z14+ tiles the
 *   second run reported over its limit (it then drops their smallest features); 0 without split.
 */
export async function writeBuildingsTiles(
  db: Duck,
  outDir: string,
  workDir: string,
  opts: { split?: boolean; maxTileBytes?: number } = {},
  deps: { run: typeof run } = { run }
): Promise<{ dropsAtSplit: number }> {
  const split = opts.split ?? false;
  const rows = await db.all<ExportRow>(
    'SELECT parcel_id, height_m, base_m, hs, geojson4326 FROM buildings_export ORDER BY parcel_id NULLS LAST, bid'
  );
  const lines = rows.map((r) => {
    const properties: Record<string, unknown> = {};
    if (r.parcel_id !== null) properties.parcelId = r.parcel_id;
    properties.heightM = r.height_m;
    properties.baseM = r.base_m;
    properties.hs = r.hs;
    const geometry = JSON.parse(r.geojson4326);
    return JSON.stringify(
      split
        ? {
            type: 'Feature',
            tippecanoe: { minzoom: 12, maxzoom: BOXES.splitZoom - 1 },
            properties,
            geometry
          }
        : { type: 'Feature', properties, geometry }
    );
  });
  const boxLines: string[] = [];
  if (split) {
    const boxes = await db.all<RenderExportRow>(
      `SELECT parcel_id, height_m, base_m, hs, src, ground_m, ground_min_m, geojson4326
       FROM render_export ORDER BY parcel_id NULLS LAST, bid, k`
    );
    for (const r of boxes) {
      const properties: Record<string, unknown> = {};
      if (r.parcel_id !== null) properties.parcelId = r.parcel_id;
      properties.heightM = r.height_m;
      properties.baseM = r.base_m;
      properties.hs = r.hs;
      properties.src = r.src;
      if (r.ground_m !== null) properties.groundM = r.ground_m;
      if (r.ground_min_m !== null) properties.groundMinM = r.ground_min_m;
      boxLines.push(
        JSON.stringify({
          type: 'Feature',
          tippecanoe: { minzoom: BOXES.splitZoom, maxzoom: 15 },
          properties,
          geometry: JSON.parse(r.geojson4326)
        })
      );
    }
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, 'buildings.geojsonseq'), lines.join('\n') + '\n');
  // tippecanoe records its output/input paths in the metadata (name, description,
  // generator_options): run it in workDir with relative names so the archive is reproducible.
  const fields = split ? [...TODAY_FIELDS, ...SPLIT_FIELDS] : TODAY_FIELDS;
  const tile = async (output: string, input: string, maxBytes: number) => {
    const r = await deps.run(
      'tippecanoe',
      [
        '-o',
        output,
        '-l',
        'buildings',
        '-Z',
        '12',
        '-z',
        '15',
        ...fields.flatMap(([name]) => ['-y', name]),
        ...fields.flatMap(([name, type]) => ['-T', `${name}:${type}`]),
        '--drop-smallest-as-needed',
        `--maximum-tile-bytes=${maxBytes}`,
        '--no-simplification-of-shared-nodes',
        '--force',
        input
      ],
      { cwd: workDir, input: '' }
    );
    if (r.code !== 0) throw new Error(`tippecanoe failed (${r.code}): ${r.stderr}`);
    return r;
  };
  let dropsAtSplit = 0;
  if (!split) {
    await tile('buildings.pmtiles', 'buildings.geojsonseq', opts.maxTileBytes ?? MAX_TILE_BYTES);
  } else {
    writeFileSync(join(workDir, 'boxes.geojsonseq'), boxLines.join('\n') + '\n');
    await tile('buildings-low.pmtiles', 'buildings.geojsonseq', MAX_TILE_BYTES);
    const high = await tile(
      'buildings-high.pmtiles',
      'boxes.geojsonseq',
      opts.maxTileBytes ?? SPLIT_MAX_TILE_BYTES
    );
    dropsAtSplit = tileDropReports(high.stderr, BOXES.splitZoom);
    // -pk: tile-join otherwise skips tiles over 500 KB.
    const j = await deps.run(
      'tile-join',
      ['-pk', '-f', '-o', 'buildings.pmtiles', 'buildings-low.pmtiles', 'buildings-high.pmtiles'],
      { cwd: workDir, input: '' }
    );
    if (j.code !== 0) throw new Error(`tile-join failed (${j.code}): ${j.stderr}`);
    for (const f of ['buildings-low.pmtiles', 'buildings-high.pmtiles'])
      rmSync(join(workDir, f), { force: true });
  }
  if (resolve(workDir) !== resolve(outDir)) {
    const built = join(workDir, 'buildings.pmtiles');
    copyFileSync(built, join(outDir, 'buildings.pmtiles'));
    rmSync(built);
  }
  return { dropsAtSplit };
}

/** outDir/basemap.pmtiles: the locked protomaps archive, copied byte for byte. */
export function writeBasemap(rawFile: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  copyFileSync(rawFile, join(outDir, 'basemap.pmtiles'));
}

/**
 * Copy <root>/<Stack Name>/*.pbf to outDir/fonts/<NoSpaceName>/ and <root>/OFL.txt to
 * outDir/fonts/OFL.txt (the OFL travels with the glyphs); returns the stack names written.
 */
export function installFonts(fontsRoot: string, outDir: string): string[] {
  const ofl = join(fontsRoot, 'OFL.txt');
  if (!existsSync(ofl)) throw new Error(`font licence missing: ${ofl}`);
  mkdirSync(join(outDir, 'fonts'), { recursive: true });
  copyFileSync(ofl, join(outDir, 'fonts', 'OFL.txt'));
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
