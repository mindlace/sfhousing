// Wire format "sfh-parcels/1" (data-pipeline spec §2). Pure TS, no dependencies:
// the pipeline writes chunks with it and the worker host reads them.
import type { ParcelId, ParcelRecord } from './parcel';

export const PARCEL_CHUNK_FORMAT = 'sfh-parcels/1';

export interface ParcelChunkV1 {
  format: 'sfh-parcels/1';
  datasetVersion: string;
  cellId: string;
  count: number;
  dict: { landUse: string[]; neighborhood: string[] };
  id: ParcelId[];
  label: number[];
  units: number[];
  floorArea: number[];
  height: number[];
  lu: number[];
  nh: number[];
  elig: (0 | 1)[];
  /** Strictly increasing row indices of underwater records; absent when there are none. */
  uw?: number[];
  rings: number[][];
  xy: number[];
}

export class ChunkFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkFormatError';
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Shoelace over all rings (outer CCW positive, holes CW negative), rounded to 0.01 m². */
export function ringsAreaM2(rings: [number, number][][]): number {
  let twice = 0;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      twice += x1 * y2 - x2 * y1;
    }
  }
  return Math.round((twice / 2) * 100) / 100;
}

export function encodeParcelChunk(
  datasetVersion: string,
  cellId: string,
  recs: ParcelRecord[]
): string {
  const sorted = [...recs].sort((a, b) => cmp(a.id, b.id));
  const landUse = [...new Set(sorted.map((r) => r.landUse))].sort(cmp);
  const neighborhood = [...new Set(sorted.map((r) => r.neighborhood))].sort(cmp);
  const luIx = new Map(landUse.map((v, i) => [v, i]));
  const nhIx = new Map(neighborhood.map((v, i) => [v, i]));
  const uw: number[] = [];
  sorted.forEach((r, i) => {
    if (r.underwater) uw.push(i);
  });
  const chunk: ParcelChunkV1 = {
    format: PARCEL_CHUNK_FORMAT,
    datasetVersion,
    cellId,
    count: sorted.length,
    dict: { landUse, neighborhood },
    id: sorted.map((r) => r.id),
    label: sorted.flatMap((r) => [
      Math.round(r.labelPoint[0] * 1e7),
      Math.round(r.labelPoint[1] * 1e7)
    ]),
    units: sorted.map((r) => Math.round(r.existingUnits)),
    floorArea: sorted.map((r) => r1(r.existingFloorAreaM2)),
    height: sorted.map((r) => r1(r.existingHeightM)),
    lu: sorted.map((r) => luIx.get(r.landUse)!),
    nh: sorted.map((r) => nhIx.get(r.neighborhood)!),
    elig: sorted.map((r) => (r.eligible ? 1 : 0)),
    rings: sorted.map((r) => r.polygon.map((ring) => ring.length)),
    xy: sorted.flatMap((r) =>
      r.polygon.flatMap((ring) =>
        ring.flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)])
      )
    ),
    ...(uw.length > 0 ? { uw } : {})
  };
  return JSON.stringify(chunk);
}

function arr(c: Record<string, unknown>, key: string, len: number): unknown[] {
  const v = c[key];
  if (!Array.isArray(v)) throw new ChunkFormatError(`column ${key} is not an array`);
  if (v.length !== len) throw new ChunkFormatError(`column ${key} has ${v.length}, want ${len}`);
  return v;
}

export function decodeParcelChunk(json: unknown): ParcelRecord[] {
  let c: unknown = json;
  if (typeof c === 'string') {
    try {
      c = JSON.parse(c);
    } catch (e) {
      throw new ChunkFormatError(`invalid JSON: ${(e as Error).message}`);
    }
  }
  if (typeof c !== 'object' || c === null || Array.isArray(c)) {
    throw new ChunkFormatError('chunk is not an object');
  }
  const o = c as Record<string, unknown>;
  if (o.format !== PARCEL_CHUNK_FORMAT)
    throw new ChunkFormatError(`unknown format ${String(o.format)}`);
  const n = o.count;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
    throw new ChunkFormatError('bad count');
  const dict = o.dict as { landUse?: unknown; neighborhood?: unknown } | undefined;
  if (!dict || !Array.isArray(dict.landUse) || !Array.isArray(dict.neighborhood)) {
    throw new ChunkFormatError('bad dict');
  }
  const ids = arr(o, 'id', n) as string[];
  const label = arr(o, 'label', 2 * n) as number[];
  const units = arr(o, 'units', n) as number[];
  const floorArea = arr(o, 'floorArea', n) as number[];
  const height = arr(o, 'height', n) as number[];
  const lu = arr(o, 'lu', n) as number[];
  const nh = arr(o, 'nh', n) as number[];
  const elig = arr(o, 'elig', n) as number[];
  const rings = arr(o, 'rings', n) as number[][];
  let verts = 0;
  for (const r of rings) {
    if (!Array.isArray(r)) throw new ChunkFormatError('rings entry is not an array');
    for (const k of r) verts += k;
  }
  const xy = arr(o, 'xy', 2 * verts) as number[];
  const underwater = new Set<number>();
  if (o.uw !== undefined) {
    if (!Array.isArray(o.uw)) throw new ChunkFormatError('column uw is not an array');
    let prev = -1;
    for (const v of o.uw as unknown[]) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= n || v <= prev) {
        throw new ChunkFormatError(`bad uw entry ${String(v)}`);
      }
      underwater.add(v);
      prev = v;
    }
  }
  const landUse = dict.landUse as string[];
  const neighborhood = dict.neighborhood as string[];
  const out: ParcelRecord[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!(lu[i] >= 0 && lu[i] < landUse.length) || !(nh[i] >= 0 && nh[i] < neighborhood.length)) {
      throw new ChunkFormatError(`dictionary index out of range at row ${i}`);
    }
    if (elig[i] !== 0 && elig[i] !== 1) throw new ChunkFormatError(`elig not 0/1 at row ${i}`);
    if (underwater.has(i) && elig[i] === 1) {
      throw new ChunkFormatError(`underwater row ${i} is eligible`);
    }
    const polygon: [number, number][][] = rings[i].map((count) => {
      const ring: [number, number][] = [];
      for (let v = 0; v < count; v++, k += 2) ring.push([xy[k] / 100, xy[k + 1] / 100]);
      return ring;
    });
    out.push({
      id: ids[i],
      polygon,
      labelPoint: [label[2 * i] / 1e7, label[2 * i + 1] / 1e7],
      areaM2: ringsAreaM2(polygon),
      existingUnits: units[i],
      existingFloorAreaM2: floorArea[i],
      existingHeightM: height[i],
      landUse: landUse[lu[i]],
      eligible: elig[i] === 1,
      neighborhood: neighborhood[nh[i]],
      ...(underwater.has(i) ? { underwater: true as const } : {})
    });
  }
  return out;
}
