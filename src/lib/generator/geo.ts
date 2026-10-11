// The only generator module allowed transcendental Math (AC4). Output is rounded to 1e-7°.
// I6's frame is EPSG:7131 (TM, lat_0=37.75, lon_0=-122.45, k=1.000007, GRS80) translated so
// the label point is (0,0). Local tangent-plane approximation; ≤ 0.05 m within 500 m (§4.10).

const D2R = Math.PI / 180;
const A_GRS80 = 6378137;
const E2_GRS80 = 0.0066943800229;
const LON0 = -122.45;

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

/** Coefficients are shared by every part and validation pass on one parcel. */
export function localFrame(labelPoint: readonly [number, number]) {
  const [lng0, lat0] = labelPoint;
  const phi = lat0 * D2R,
    sinP = Math.sin(phi),
    cosP = Math.cos(phi);
  const g = (lng0 - LON0) * sinP * D2R,
    cg = Math.cos(g),
    sg = Math.sin(g);
  const W = 1 - E2_GRS80 * sinP * sinP;
  const M = (A_GRS80 * (1 - E2_GRS80)) / Math.pow(W, 1.5),
    N = A_GRS80 / Math.sqrt(W);
  const degPerMLat = 1 / (M * D2R),
    degPerMLng = 1 / (N * cosP * D2R);
  return {
    to(x: number, y: number): [number, number] {
      const e = x * cg + y * sg,
        n = -x * sg + y * cg;
      return [r7(lng0 + e * degPerMLng), r7(lat0 + n * degPerMLat)];
    },
    from(lng: number, lat: number): [number, number] {
      const e = (lng - lng0) * N * cosP * D2R,
        n = (lat - lat0) * M * D2R;
      return [e * cg - n * sg, e * sg + n * cg];
    }
  };
}
export function toLngLat(
  ring: readonly (readonly [number, number])[],
  labelPoint: readonly [number, number]
): [number, number][] {
  const frame = localFrame(labelPoint);
  return ring.map(([x, y]) => frame.to(x, y));
}
/** Unrounded inverse of the local affine transform, used to validate serialized rings. */
export function fromLngLat(
  ring: readonly (readonly [number, number])[],
  labelPoint: readonly [number, number]
): [number, number][] {
  const frame = localFrame(labelPoint);
  return ring.map(([lng, lat]) => frame.from(lng, lat));
}
