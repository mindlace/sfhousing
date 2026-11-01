import type { PathD } from 'clipper2-ts';
import type { ParcelRecord } from '$lib/data/parcel';
import {
  FT_PER_M,
  MAX_STORIES,
  PHYS_AREA_KNOTS,
  PHYS_AREA_SLOPES,
  PHYS_JOIN_FROM_FT,
  PHYS_JOIN_TO_FT,
  PHYS_MIN_STORIES,
  PHYS_SF_FT_COEF,
  PHYS_SLENDER_FT_COEF,
  PHYS_SQRT_AREA_COEF
} from './constants';
import { project } from './poly';
import { selectTypology } from './select';
import { normaliseSite, type Site } from './site';

/*
 * Physical story limit: the hybrid width/area rule. Evidence and scripts are in
 * docs/superpowers/design/2026-10-31-physical-limits/. Pure and deterministic; only Math.sqrt.
 */

export type PhysicalSite = Pick<Site, 'P' | 'A' | 'c' | 'v'>;

/** Stories allowed by lot area alone (piecewise linear through `PHYS_AREA_KNOTS`). */
function capA(areaFt2: number): number {
  const k = areaFt2 / 1000;
  let i = PHYS_AREA_KNOTS.length - 1;
  while (i > 0 && k <= PHYS_AREA_KNOTS[i][0]) i--;
  return PHYS_AREA_KNOTS[i][1] + PHYS_AREA_SLOPES[i] * (k - PHYS_AREA_KNOTS[i][0]);
}

/** Narrowest extent of the ring across any of its edge directions, metres. */
function narrowestEdgeExtent(P: PathD): number {
  let best = Number.POSITIVE_INFINITY;
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
    if (!(len > 0)) continue;
    const { min, max } = project([P], a, { x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
    if (max - min < best) best = max - min;
  }
  return best;
}

/** Hybrid rule; integer in [PHYS_MIN_STORIES, MAX_STORIES]. */
export function physicalMaxStories(site: PhysicalSite): number {
  const cross = project([site.P], site.c, site.v);
  // principalAxis is arbitrary on a square, so also take the narrowest edge-direction extent
  const wM = Math.min(cross.max - cross.min, narrowestEdgeExtent(site.P));
  const w = wM * FT_PER_M;
  const A = site.A * FT_PER_M * FT_PER_M;
  const sf = Math.min(PHYS_SF_FT_COEF * w, capA(A));
  const big = Math.min(PHYS_SLENDER_FT_COEF * w, PHYS_SQRT_AREA_COEF * Math.sqrt(A));
  const t = Math.min(
    1,
    Math.max(0, (w - PHYS_JOIN_FROM_FT) / (PHYS_JOIN_TO_FT - PHYS_JOIN_FROM_FT))
  );
  const blend = (1 - t) * sf + t * Math.max(sf, big);
  const clamped = Math.min(MAX_STORIES, Math.max(PHYS_MIN_STORIES, blend));
  // the m -> ft round trip turns exact values (6) into 5.9999...; 1e-9 stories is below any signal
  return Math.min(MAX_STORIES, Math.floor(clamped + 1e-9));
}

/** Physical max stories for a parcel polygon; null when the polygon is degenerate. */
export function lotPhysicalMaxStories(polygon: ParcelRecord['polygon']): number | null {
  const site = normaliseSite(polygon, 0);
  return site ? physicalMaxStories(site) : null;
}

/** Built stories after the physical cap and the typology cascade; null if nothing can be built. */
export function lotBuildableStories(
  polygon: ParcelRecord['polygon'],
  allowedStories: number,
  existingUnits: number
): number | null {
  const site = normaliseSite(polygon, 0);
  const allowed = Math.floor(allowedStories);
  if (!site || !(allowed >= 1)) return null;
  const S = Math.min(allowed, physicalMaxStories(site), MAX_STORIES);
  return selectTypology(S, site.A, existingUnits).stories;
}
