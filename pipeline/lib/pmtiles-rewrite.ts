// Rewrite a vector PMTiles archive tile by tile: decode every tile, pass it through a transform,
// write an MBTiles database (node:sqlite) and let `pmtiles convert` build the new archive. Used by
// the tiles step to split the /lesscars removed freeways into their own source layer
// (pipeline/lib/lesscars/basemap-split.ts, docs/dev/lesscars.md "Basemap ids").
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { PMTiles, TileType } from 'pmtiles';
import { run } from './exec';
import { NodeFileSource } from './pmtiles-file';

const tileX = (lng: number, z: number) =>
  Math.min(2 ** z - 1, Math.max(0, Math.floor(((lng + 180) / 360) * 2 ** z)));
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  const t = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  return Math.min(2 ** z - 1, Math.max(0, t));
};

/** Metadata keys MBTiles carries in its own rows; the rest goes into the `json` row or as text. */
const OWN_ROWS = new Set(['format', 'bounds', 'center', 'minzoom', 'maxzoom', 'json']);

/**
 * Copy every tile of `input` (all zooms over its header bounds) through `transform` into
 * `output`: an MBTiles file written with node:sqlite in workDir, then `pmtiles convert`.
 * Metadata is carried over, `vector_layers` gaining `extraLayers`.
 */
export async function rewritePmtiles(a: {
  input: string;
  output: string;
  workDir: string;
  /** The decompressed MVT; returns the new tile, or null to keep it unchanged. */
  transform: (z: number, x: number, y: number, mvt: Uint8Array) => Uint8Array | null;
  extraLayers: { id: string; fields: Record<string, string> }[];
}): Promise<{ tiles: number; changed: number }> {
  const pm = new PMTiles(new NodeFileSource(a.input));
  const h = await pm.getHeader();
  if (h.tileType !== TileType.Mvt) throw new Error(`pmtiles-rewrite: ${a.input} is not MVT`);
  const md = ((await pm.getMetadata()) ?? {}) as Record<string, unknown>;

  mkdirSync(a.workDir, { recursive: true });
  const mbtiles = join(a.workDir, 'rewrite.mbtiles');
  rmSync(mbtiles, { force: true });
  const db = new DatabaseSync(mbtiles);
  let tiles = 0;
  let changed = 0;
  try {
    db.exec(
      'CREATE TABLE metadata (name TEXT, value TEXT);' +
        'CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, ' +
        'tile_data BLOB);' +
        'CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);'
    );
    const meta = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
    const json: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(md)) {
      if (OWN_ROWS.has(k)) continue;
      if (typeof v === 'string') meta.run(k, v);
      else json[k] = v;
    }
    const layers = Array.isArray(md.vector_layers) ? (md.vector_layers as { id: string }[]) : [];
    const have = new Set(layers.map((l) => l.id));
    json.vector_layers = [
      ...layers,
      ...a.extraLayers
        .filter((l) => !have.has(l.id))
        .map((l) => ({ id: l.id, fields: l.fields, minzoom: h.minZoom, maxzoom: h.maxZoom }))
    ];
    meta.run('format', 'pbf');
    meta.run('bounds', [h.minLon, h.minLat, h.maxLon, h.maxLat].join(','));
    meta.run('center', [h.centerLon, h.centerLat, h.centerZoom].join(','));
    meta.run('minzoom', String(h.minZoom));
    meta.run('maxzoom', String(h.maxZoom));
    meta.run('json', JSON.stringify(json));

    const put = db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)'
    );
    db.exec('BEGIN');
    for (let z = h.minZoom; z <= h.maxZoom; z++)
      for (let x = tileX(h.minLon, z); x <= tileX(h.maxLon, z); x++)
        for (let y = tileY(h.maxLat, z); y <= tileY(h.minLat, z); y++) {
          const t = await pm.getZxy(z, x, y);
          if (!t) continue;
          const raw = new Uint8Array(t.data);
          const out = a.transform(z, x, y, raw);
          tiles++;
          if (out !== null) changed++;
          // MBTiles rows are TMS (y up) and hold gzip MVT, as `pmtiles convert` expects.
          put.run(z, x, 2 ** z - 1 - y, gzipSync(out ?? raw, { level: 9 }));
        }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  rmSync(a.output, { force: true });
  const r = await run('pmtiles', ['convert', '--quiet', mbtiles, a.output]);
  if (r.code !== 0) throw new Error(`pmtiles convert failed (${r.code}): ${r.stderr}`);
  rmSync(mbtiles, { force: true });
  return { tiles, changed };
}
