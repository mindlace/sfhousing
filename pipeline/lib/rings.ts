export type Ring = [number, number][];

/** Minimal GeoJSON polygon shapes (no @types/geojson dependency). */
export type PolygonGeom = { type: 'Polygon'; coordinates: number[][][] };
export type MultiPolygonGeom = { type: 'MultiPolygon'; coordinates: number[][][][] };

const q = (v: number): number => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0

function signedArea2(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

/** Quantise to cm, open the ring, drop consecutive duplicates; null if < 3 vertices remain. */
function cleanRing(coords: number[][], x0: number, y0: number, wantCcw: boolean): Ring | null {
  const out: Ring = [];
  for (const c of coords) {
    const p: [number, number] = [q(c[0] - x0), q(c[1] - y0)];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  // Drops the closing vertex (equal to the first, before or after quantising).
  while (
    out.length > 1 &&
    out[0][0] === out[out.length - 1][0] &&
    out[0][1] === out[out.length - 1][1]
  )
    out.pop();
  if (out.length < 3) return null;
  const ccw = signedArea2(out) > 0;
  if (ccw !== wantCcw) {
    // Reverse but keep the first vertex in place.
    const [first, ...rest] = out;
    return [first, ...rest.reverse()];
  }
  return out;
}

/** Spec §4.4 steps 5-6: local-frame, cm-quantised, open rings; parts by area desc. */
export function toLocalRings(geom: PolygonGeom | MultiPolygonGeom, x0: number, y0: number): Ring[] {
  const parts = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const scored = parts.map((part, i) => {
    const outer = part[0] ?? [];
    let a = 0;
    for (let k = 0; k < outer.length - 1; k++) {
      a += outer[k][0] * outer[k + 1][1] - outer[k + 1][0] * outer[k][1];
    }
    return { part, i, area: Math.abs(a) / 2 };
  });
  scored.sort((a, b) => b.area - a.area || a.i - b.i);
  const result: Ring[] = [];
  for (const { part } of scored) {
    const outer = part[0] ? cleanRing(part[0], x0, y0, true) : null;
    if (!outer) continue; // a collapsed outer takes its holes with it
    result.push(outer);
    for (const h of part.slice(1)) {
      const hole = cleanRing(h, x0, y0, false);
      if (hole) result.push(hole);
    }
  }
  return result;
}

/** Even-odd containment over all rings; false when the point lies on any edge. */
export function pointStrictlyInside(pt: [number, number], rings: Ring[]): boolean {
  const [px, py] = pt;
  let inside = false;
  for (const r of rings) {
    for (let i = 0, n = r.length; i < n; i++) {
      const [x1, y1] = r[i];
      const [x2, y2] = r[(i + 1) % n];
      const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
      if (
        cross === 0 &&
        px >= Math.min(x1, x2) &&
        px <= Math.max(x1, x2) &&
        py >= Math.min(y1, y2) &&
        py <= Math.max(y1, y2)
      )
        return false;
      if (y1 > py !== y2 > py && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}

export function cellIdFor(x0: number, y0: number, size = 1000): string {
  return `${Math.floor(x0 / size)}_${Math.floor(y0 / size)}`;
}
