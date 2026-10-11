// Test-only helpers. No transcendental Math (AC4 covers this directory too).

export type Ring = [number, number][];

export function rectRing(w: number, h: number, cx = 0, cy = 0): Ring {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2]
  ];
}

export function lRing(w: number, h: number, nw: number, nh: number): Ring {
  const x = w / 2;
  const y = h / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y - nh],
    [x - nw, y - nh],
    [x - nw, y],
    [-x, y]
  ];
}

export function uRing(w: number, h: number, gapW: number, gapH: number): Ring {
  const x = w / 2;
  const y = h / 2;
  const g = gapW / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y],
    [g, y],
    [g, y - gapH],
    [-g, y - gapH],
    [-g, y],
    [-x, y]
  ];
}

/** Rotation with cos=(1−t²)/(1+t²), sin=2t/(1+t²); `flip` adds 180°. Covers every angle. */
export function rotateRing(ring: Ring, t: number, flip: boolean): Ring {
  const d = 1 + t * t;
  let c = (1 - t * t) / d;
  let s = (2 * t) / d;
  if (flip) {
    c = -c;
    s = -s;
  }
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

function segDist2(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

/** Inside `ring` (even-odd), or within `tol` of its boundary. */
export function pointNearPolygon(p: [number, number], ring: Ring, tol: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (segDist2(p, ring[j], ring[i]) <= tol * tol) return true;
  }
  return false;
}

/**
 * Approximate lng/lat → local metres around `label` (equirectangular, metres per degree at the
 * label latitude). Only used to compare lng/lat rings with each other, so the shared
 * convergence rotation and scale cancel out; tolerance 0.02 m still applies.
 */
export function lngLatToLocalApprox(ring: Ring, label: [number, number]): Ring {
  const mPerDegLat = 111_000;
  // cos(lat) is not computed here: SF latitudes are ~37.7–37.8°, cos ≈ 0.7907 there
  const mPerDegLng = 111_000 * 0.7907;
  return ring.map(([lng, lat]) => [(lng - label[0]) * mPerDegLng, (lat - label[1]) * mPerDegLat]);
}
