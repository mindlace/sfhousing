import {
  booleanOpDWithPolyTree,
  ClipType,
  FillRule,
  intersectD,
  PolyTreeD,
  simplifyPathsD,
  type PathD,
  type PathsD
} from 'clipper2-ts';
import { domainArea } from './domain';
import { CLIPPER_PRECISION, MIN_SITE_M2, MIN_WIDTH_INSET_M, SIMPLIFY_EPS_M } from './constants';
import {
  canonicalRing,
  centroid,
  inset,
  isRectangle,
  principalAxis,
  signedArea,
  type Vec
} from './poly';

export interface Site {
  /** Site ring (local metres), canonical: open, CCW, no holes. */
  P: PathD;
  /** |area(P)| in m². */
  A: number;
  originalDomain: PathsD;
  domain: PathsD;
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
  if (out.length < 3) return [];
  const a = out[0];
  const b = out.find((p) => p.x !== a.x || p.y !== a.y);
  return b && out.some((p) => (p.x !== a.x || p.y !== a.y) && (p.x !== b.x || p.y !== b.y))
    ? out
    : [];
}

/** §4.4 steps 4–6. Returns null for degenerate parcels. */
export function normaliseSite(polygon: [number, number][][], edgeInsetM: number): Site | null {
  if (!Array.isArray(polygon)) return null;
  const rings: PathsD = [];
  for (const ring of polygon) {
    if (!Array.isArray(ring)) continue;
    // a ring with a malformed point is dropped whole
    if (ring.some((pt) => !Array.isArray(pt) || pt.length < 2)) continue;
    const r = cleanRing(ring);
    if (r.length) rings.push(r);
  }
  if (rings.length === 0) return null;

  let P: PathD;
  let holes: PathsD = [];
  if (rings.length === 1) {
    P = canonicalRing(rings[0]);
  } else {
    const tree = new PolyTreeD();
    booleanOpDWithPolyTree(ClipType.Union, rings, null, tree, FillRule.EvenOdd, CLIPPER_PRECISION);
    if (tree.count === 0) return null;
    let best = tree.child(0);
    for (let i = 1; i < tree.count; i++) {
      const candidate = tree.child(i);
      if (candidate.area() > best.area()) best = candidate;
    }
    if (!best.poly) return null;
    P = canonicalRing(best.poly);
    for (let i = 0; i < best.count; i++) {
      const hole = best.child(i).poly;
      if (hole) holes.push(canonicalRing(hole).reverse());
    }
    holes = holes.sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y);
  }
  const originalDomain = [P, ...holes];
  const simplified = isRectangle(P) ? [P] : simplifyPathsD([P], SIMPLIFY_EPS_M, true);
  if (simplified.length === 0 || simplified[0].length < 3) return null;
  const next = canonicalRing(simplified[0]);
  const unchanged =
    next.length === P.length && next.every((p, i) => p.x === P[i].x && p.y === P[i].y);
  const domain = unchanged
    ? originalDomain
    : intersectD([next, ...holes], originalDomain, FillRule.NonZero, CLIPPER_PRECISION);
  P = next;
  const A = domainArea(domain);
  if (!(A >= MIN_SITE_M2)) return null;
  // Small exclusions must survive even when their area is below the occupied-piece minimum.
  const Q = inset(domain, edgeInsetM).filter((p) => signedArea(p) < 0 || signedArea(p) >= 10);
  if (Q.length === 0 || inset(Q, MIN_WIDTH_INSET_M).length === 0) return null;

  const c = centroid(P);
  const u = principalAxis(P, c);
  // `+ 0` turns -0 into 0 so structurally equal sites compare equal
  return { P, A, c, u, v: { x: -u.y + 0, y: u.x + 0 }, Q, originalDomain, domain };
}
