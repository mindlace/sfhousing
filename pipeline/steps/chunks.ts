import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
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
  underwater: boolean;
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

/** One parcel_out row as the chunk record, its cell and its lng/lat extent. */
interface ParcelRow {
  rec: ParcelRecord;
  cellId: string;
  bbox: [number, number, number, number];
}

async function readParcelRows(db: Duck): Promise<ParcelRow[]> {
  const rows = await db.all<Row>(
    `SELECT id, label_lng, label_lat, x0, y0, units, floor_area_m2, height_m, land_use,
            eligible, underwater, neighborhood, xmin, ymin, xmax, ymax, geojson7131
     FROM parcel_out ORDER BY id`
  );
  return rows.map((r) => {
    const polygon = toLocalRings(JSON.parse(r.geojson7131), r.x0, r.y0);
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
      neighborhood: r.neighborhood,
      ...(r.underwater ? { underwater: true as const } : {})
    };
    return { rec, cellId: cellIdFor(r.x0, r.y0), bbox: [r.xmin, r.ymin, r.xmax, r.ymax] };
  });
}

/**
 * Every parcel_out row as the exact `ParcelRecord` `writeChunks` encodes, with its cell, sorted
 * by id. The scenario step reads parcels through this so both see one record per parcel.
 */
export async function readParcelRecords(
  db: Duck
): Promise<{ rec: ParcelRecord; cellId: string }[]> {
  return (await readParcelRows(db)).map(({ rec, cellId }) => ({ rec, cellId }));
}

/**
 * The original outline of every clipped lot (status 'clipped'), in the same local frame as its
 * chunk record (`x0, y0`), with the share of its area the clip kept (`dry_m2 / orig_m2`).
 */
export async function readClippedOriginals(
  db: Duck
): Promise<Map<ParcelId, { polygon: [number, number][][]; keptShare: number }>> {
  const rows = await db.all<{
    id: string;
    x0: number;
    y0: number;
    geojson7131_orig: string;
    kept: number;
  }>(
    `SELECT o.id, o.x0, o.y0, o.geojson7131_orig, l.dry_m2 / l.orig_m2 AS kept
     FROM parcel_out o JOIN parcel_land l USING (id)
     WHERE l.status = 'clipped' AND o.geojson7131_orig IS NOT NULL ORDER BY o.id`
  );
  return new Map(
    rows.map((r) => [
      String(r.id),
      { polygon: toLocalRings(JSON.parse(r.geojson7131_orig), r.x0, r.y0), keptShare: r.kept }
    ])
  );
}

export async function writeChunks(
  db: Duck,
  outDir: string,
  datasetVersion: string,
  report: Report
): Promise<ChunkOut[]> {
  const cells = new Map<string, Cell>();
  let empty = 0;
  let outside = 0;
  for (const { rec, cellId, bbox } of await readParcelRows(db)) {
    if (rec.polygon.length === 0) empty++;
    if (!pointStrictlyInside([0, 0], rec.polygon)) outside++;
    let c = cells.get(cellId);
    if (!c) {
      c = { recs: [], bbox };
      cells.set(cellId, c);
    }
    c.recs.push(rec);
    c.bbox = [
      Math.min(c.bbox[0], bbox[0]),
      Math.min(c.bbox[1], bbox[1]),
      Math.max(c.bbox[2], bbox[2]),
      Math.max(c.bbox[3], bbox[3])
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
