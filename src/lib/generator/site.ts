import { FillRule, simplifyPathsD, unionD, type PathD, type PathsD } from 'clipper2-ts';
import { CLIPPER_PRECISION, MIN_SITE_M2, MIN_WIDTH_INSET_M, SIMPLIFY_EPS_M } from './constants';
import {
  canonicalRing,
  centroid,
  inset,
  keepPieces,
  principalAxis,
  signedArea,
  type Vec
} from './poly';

export interface Site {
  /** Site ring (local metres), canonical: open, CCW, no holes. */
  P: PathD;
  /** |area(P)| in m². */
  A: number;
  /** Area centroid of P. */
  c: Vec;
  /** Long principal axis of P (unit). */
  u: Vec;
  /** u rotated +90°. */
  v: Vec;
  /** Base region: P inset by the edge inset, pieces ≥ 10 m². */
  Q: PathsD;
}

/** Open, de-duplicated ring; [] if any coordinate is non-finite or < 3 distinct vertices. */
function cleanRing(ring: readonly (readonly number[])[]): PathD {
  const out: PathD = [];
  for (const pt of ring) {
    const x = pt[0];
    const y = pt[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const last = out[out.length - 1];
    if (!last || last.x !== x || last.y !== y) out.push({ x, y });
  }
  while (
    out.length > 1 &&
    out[0].x === out[out.length - 1].x &&
    out[0].y === out[out.length - 1].y
  ) {
    out.pop();
  }
  const distinct = new Set(out.map((p) => p.x + ',' + p.y));
  return distinct.size >= 3 ? out : [];
}

/** §4.4 steps 4–6. Returns null for degenerate parcels. */
export function normaliseSite(polygon: [number, number][][], edgeInsetM: number): Site | null {
  const rings: PathsD = [];
  for (const ring of polygon) {
    const r = cleanRing(ring);
    if (r.length) rings.push(r);
  }
  if (rings.length === 0) return null;

  let P: PathD | null;
  if (rings.length === 1) {
    P = rings[0];
  } else {
    // Resolves holes and disjoint parts without trusting ring orientation. Outers come back
    // positive; holes negative. The largest positive path is the site's outer ring.
    const merged = unionD(rings, [], FillRule.EvenOdd, CLIPPER_PRECISION);
    P = null;
    let best = 0;
    for (const p of merged) {
      const a = signedArea(p);
      if (a > best) {
        best = a;
        P = p;
      }
    }
    if (!P) return null;
  }
  P = canonicalRing(P);
  const simplified = simplifyPathsD([P], SIMPLIFY_EPS_M, true);
  if (simplified.length === 0 || simplified[0].length < 3) return null;
  P = canonicalRing(simplified[0]);

  const A = Math.abs(signedArea(P));
  if (!(A >= MIN_SITE_M2)) return null;

  const Q = keepPieces(inset([P], edgeInsetM));
  if (Q.length === 0) return null;
  if (inset(Q, MIN_WIDTH_INSET_M).length === 0) return null;

  const c = centroid(P);
  const u = principalAxis(P, c);
  // `+ 0` turns -0 into 0 so structurally equal sites compare equal
  return { P, A, c, u, v: { x: -u.y + 0, y: u.x + 0 }, Q };
}
