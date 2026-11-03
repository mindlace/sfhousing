/**
 * Packed lot outlines: one ring per polygon ring as typed arrays, so a worker can transfer them.
 * Shared by the scenario host's `lotOutlines` and the editor host's `opLots`. Worker-bundle
 * module: DOM-free and $app-free.
 */
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { toLngLat } from '$lib/generator/geo';

/**
 * `lots` in answer order; ring `k` belongs to `lots[ringLot[k]]` and its vertices are
 * `positions[2 * starts[k] .. 2 * starts[k + 1])` as (lng, lat) pairs.
 */
export interface LotOutlines {
  lots: ParcelId[];
  ringLot: Uint32Array;
  starts: Uint32Array;
  positions: Float64Array;
}

/** `transfer` is the three buffers (fresh typed arrays, so they are ArrayBuffers). */
export function packOutlines(
  recs: readonly { id: ParcelId; polygon: ParcelRecord['polygon']; labelPoint: [number, number] }[]
): { outlines: LotOutlines; transfer: ArrayBuffer[] } {
  const lots: ParcelId[] = [];
  const rings: [number, number][][] = [];
  const ringLotIdx: number[] = [];
  for (const rec of recs) {
    for (const ring of rec.polygon) {
      rings.push(toLngLat(ring, rec.labelPoint));
      ringLotIdx.push(lots.length);
    }
    lots.push(rec.id);
  }
  const starts = new Uint32Array(rings.length + 1);
  rings.forEach((r, k) => (starts[k + 1] = starts[k] + r.length));
  const positions = new Float64Array(2 * starts[rings.length]);
  rings.forEach((r, k) =>
    r.forEach(([lng, lat], v) => {
      positions[2 * (starts[k] + v)] = lng;
      positions[2 * (starts[k] + v) + 1] = lat;
    })
  );
  const ringLot = new Uint32Array(ringLotIdx);
  return {
    outlines: { lots, ringLot, starts, positions },
    transfer: [
      ringLot.buffer as ArrayBuffer,
      starts.buffer as ArrayBuffer,
      positions.buffer as ArrayBuffer
    ]
  };
}
