// The only generator module allowed transcendental Math (AC4). Output is rounded to 1e-7°.
// I6's frame is EPSG:7131 (TM, lat_0=37.75, lon_0=-122.45, k=1.000007, GRS80) translated so
// the label point is (0,0). Local tangent-plane approximation; ≤ 0.05 m within 500 m (§4.10).

const D2R = Math.PI / 180;
const A_GRS80 = 6378137;
const E2_GRS80 = 0.0066943800229;
const LON0 = -122.45;

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

export function toLngLat(
  ring: readonly (readonly [number, number])[],
  labelPoint: readonly [number, number]
): [number, number][] {
  const lng0 = labelPoint[0];
  const lat0 = labelPoint[1];
  const phi = lat0 * D2R;
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  // grid convergence γ (degrees) = (λ0 − lon_0)·sin φ0; rotate grid → true north
  const g = (lng0 - LON0) * sinP * D2R;
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  const W = 1 - E2_GRS80 * sinP * sinP;
  const M = (A_GRS80 * (1 - E2_GRS80)) / Math.pow(W, 1.5);
  const N = A_GRS80 / Math.sqrt(W);
  const degPerMLat = 1 / (M * D2R);
  const degPerMLng = 1 / (N * cosP * D2R);
  return ring.map(([x, y]) => {
    const e = x * cg + y * sg;
    const n = -x * sg + y * cg;
    return [r7(lng0 + e * degPerMLng), r7(lat0 + n * degPerMLat)];
  });
}
