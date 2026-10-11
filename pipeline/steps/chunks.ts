import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { encodeParcelChunk, ringsAreaM2 } from '../../src/lib/data/parcel-chunk';
import type { Duck } from '../lib/duck';
import type { Report } from '../lib/report';
import { cellIdFor, pointStrictlyInside, toLocalRings } from '../lib/rings';

export interface ChunkOut {
  cellId: string;
  bbox: [number, number, number, number];
  path: string;
  parcelCount: number;
  rawBytes: number;
  gzipBytes: number;
}

interface Row {
  id: string;
  label_lng: number;
  label_lat: number;
  x0: number;
  y0: number;
  units: number;
  floor_area_m2: number;
  height_m: number;
  land_use: string;
  eligible: boolean;
  neighborhood: string;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  geojson7131: string;
}

interface Cell {
  recs: ParcelRecord[];
  bbox: [number, number, number, number];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function writeChunks(
  db: Duck,
  outDir: string,
  datasetVersion: string,
  report: Report
): Promise<ChunkOut[]> {
  const rows = await db.all<Row>(
    `SELECT id, label_lng, label_lat, x0, y0, units, floor_area_m2, height_m, land_use,
            eligible, neighborhood, xmin, ymin, xmax, ymax, geojson7131
     FROM parcel_out ORDER BY id`
  );
  const cells = new Map<string, Cell>();
  let empty = 0;
  let outside = 0;
  for (const r of rows) {
    const polygon = toLocalRings(JSON.parse(r.geojson7131), r.x0, r.y0);
    if (polygon.length === 0) empty++;
    if (!pointStrictlyInside([0, 0], polygon)) outside++;
    const rec: ParcelRecord = {
      id: String(r.id),
      polygon,
      labelPoint: [r.label_lng, r.label_lat],
      areaM2: ringsAreaM2(polygon),
      existingUnits: r.units,
      existingFloorAreaM2: r.floor_area_m2,
      existingHeightM: r.height_m,
      landUse: r.land_use,
      eligible: r.eligible,
      neighborhood: r.neighborhood
    };
    const cellId = cellIdFor(r.x0, r.y0);
    let c = cells.get(cellId);
    if (!c) {
      c = { recs: [], bbox: [r.xmin, r.ymin, r.xmax, r.ymax] };
      cells.set(cellId, c);
    }
    c.recs.push(rec);
    c.bbox = [
      Math.min(c.bbox[0], r.xmin),
      Math.min(c.bbox[1], r.ymin),
      Math.max(c.bbox[2], r.xmax),
      Math.max(c.bbox[3], r.ymax)
    ];
  }
  report.set('chunks.empty_polygon', empty);
  report.set('chunks.label_outside_local', outside);

  await fs.mkdir(path.join(outDir, 'parcels'), { recursive: true });
  const outs: ChunkOut[] = [];
  for (const cellId of [...cells.keys()].sort(cmp)) {
    const c = cells.get(cellId)!;
    const buf = Buffer.from(encodeParcelChunk(datasetVersion, cellId, c.recs));
    const rel = `parcels/${cellId}.json`;
    await fs.writeFile(path.join(outDir, rel), buf);
    outs.push({
      cellId,
      bbox: [
        Math.floor(c.bbox[0] * 1e6) / 1e6,
        Math.floor(c.bbox[1] * 1e6) / 1e6,
        Math.ceil(c.bbox[2] * 1e6) / 1e6,
        Math.ceil(c.bbox[3] * 1e6) / 1e6
      ],
      path: rel,
      parcelCount: c.recs.length,
      rawBytes: buf.length,
      gzipBytes: gzipSync(buf, { level: 9 }).length
    });
  }
  report.set('chunks.count', outs.length);
  return outs;
}

export async function writeNeighborhoods(db: Duck, outDir: string): Promise<number> {
  const rows = await db.all<{ name: string; geojson4326: string }>(
    'SELECT name, geojson4326 FROM neighborhoods_out ORDER BY name'
  );
  const fc = {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      properties: { name: r.name },
      geometry: JSON.parse(r.geojson4326)
    }))
  };
  const buf = Buffer.from(JSON.stringify(fc));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'neighborhoods.geojson'), buf);
  return buf.length;
}
