// The lot under a point: pure geometry for the scenario host's `lotAt` request. Worker-safe.
import type { ParcelId } from '$lib/data/parcel';

/** Even-odd test of `p` (lng, lat) against a lot's rings (lng, lat); a hole is a second ring. */
export function pointInRings(p: [number, number], rings: readonly [number, number][][]): boolean {
  const [x, y] = p;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The first record whose polygon holds `p`, or null. */
export function lotAtPoint<
  R extends { id: ParcelId; polygon: unknown; labelPoint: [number, number] }
>(records: Iterable<R>, p: [number, number], rings: (r: R) => [number, number][][]): R | null {
  for (const r of records) if (pointInRings(p, rings(r))) return r;
  return null;
}
