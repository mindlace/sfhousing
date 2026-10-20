import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import fs from 'node:fs';
import path from 'node:path';
import { createTableFromRows, type CellValue, type Duck } from '../lib/duck';
import { NodeFileSource } from '../lib/pmtiles-file';

export type LandLayer = 'earth' | 'pier';

export interface LandFeature {
  layer: LandLayer;
  z: number;
  x: number;
  y: number;
  /** Index of the feature within its tile layer. */
  fid: number;
  w: number;
  s: number;
  e: number;
  n: number;
  /** Feature geometry in EPSG:4326. */
  geojson: string;
}

/** The zoom at which land polygons are read: the basemap's most detailed level for SF. */
const LAND_Z = 15;

const lon = (z: number, x: number) => (x / 2 ** z) * 360 - 180;
const lat = (z: number, y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** Lon/lat bounds of a Web-Mercator tile. */
export function tileBounds(
  z: number,
  x: number,
  y: number
): [w: number, s: number, e: number, n: number] {
  return [lon(z, x), lat(z, y + 1), lon(z, x + 1), lat(z, y)];
}

/** Earth polygons and pier (landuse kind 'pier') polygons of one decoded tile. */
export function landFeaturesFromTile(
  tile: Pick<VectorTile, 'layers'>,
  z: number,
  x: number,
  y: number
): LandFeature[] {
  const [w, s, e, n] = tileBounds(z, x, y);
  const out: LandFeature[] = [];
  const take = (name: string, kind: string, layer: LandLayer) => {
    const l = tile.layers[name];
    if (!l) return;
    for (let fid = 0; fid < l.length; fid++) {
      const f = l.feature(fid);
      if (f.type !== 3 || f.properties.kind !== kind) continue;
      out.push({
        layer,
        z,
        x,
        y,
        fid,
        w,
        s,
        e,
        n,
        geojson: JSON.stringify(f.toGeoJSON(x, y, z).geometry)
      });
    }
  };
  take('earth', 'earth', 'earth');
  take('landuse', 'pier', 'pier');
  return out;
}

const COLUMNS: [string, string][] = [
  ['layer', 'VARCHAR'],
  ['z', 'INTEGER'],
  ['x', 'INTEGER'],
  ['y', 'INTEGER'],
  ['fid', 'INTEGER'],
  ['w', 'DOUBLE'],
  ['s', 'DOUBLE'],
  ['e', 'DOUBLE'],
  ['n', 'DOUBLE'],
  ['geojson', 'VARCHAR']
];

const tileX = (lonDeg: number) => Math.floor(((lonDeg + 180) / 360) * 2 ** LAND_Z);
const tileY = (latDeg: number) => {
  const r = (latDeg * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** LAND_Z);
};

/** Decode the basemap's land features at z15 over its header bounds into `src_land` + parquet. */
export async function normaliseLand(
  db: Duck,
  pmtilesPath: string,
  outParquet: string
): Promise<number> {
  const pm = new PMTiles(new NodeFileSource(pmtilesPath));
  const h = await pm.getHeader();
  const x0 = tileX(h.minLon);
  const x1 = tileX(h.maxLon);
  const y0 = tileY(h.maxLat);
  const y1 = tileY(h.minLat);
  const rows: CellValue[][] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const t = await pm.getZxy(LAND_Z, x, y);
      if (!t) continue;
      const tile = new VectorTile(new Pbf(new Uint8Array(t.data)));
      for (const f of landFeaturesFromTile(tile, LAND_Z, x, y)) {
        rows.push([f.layer, f.z, f.x, f.y, f.fid, f.w, f.s, f.e, f.n, f.geojson]);
      }
    }
  }
  await createTableFromRows(db, 'src_land', COLUMNS, rows);
  fs.mkdirSync(path.dirname(outParquet), { recursive: true });
  const out = outParquet.replaceAll("'", "''");
  await db.run(
    `COPY (SELECT * FROM src_land ORDER BY layer, z, x, y, fid) TO '${out}' (FORMAT parquet)`
  );
  return rows.length;
}
