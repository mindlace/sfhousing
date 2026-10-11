import { differenceD, FillRule, intersectD, type PathsD } from 'clipper2-ts';
import { MIN_PIECE_M2 } from './constants';
import { canonicalRing, orientedRect, project, signedArea } from './poly';
import type { Site } from './site';

/** Net area of resolved Clipper contours (positive outers, negative exclusions). */
export function domainArea(domain: PathsD): number {
  return Math.abs(domain.reduce((sum, ring) => sum + signedArea(ring), 0));
}

/** Tests the complete region, including edges crossing concave boundaries. */
export function insideDomain(region: PathsD, domain: PathsD): boolean {
  // Convex domains contain an entire straight-edged region iff they contain every vertex.
  // Concavities, multiple components and exclusions still use polygon difference.
  if (domain.length === 1 && domain[0].length >= 3) {
    const outer = domain[0];
    let convex = true;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i],
        b = outer[(i + 1) % outer.length],
        c = outer[(i + 2) % outer.length];
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-9) {
        convex = false;
        break;
      }
    }
    if (
      convex &&
      region.every((r) =>
        r.every((p) =>
          outer.every((a, i) => {
            const b = outer[(i + 1) % outer.length];
            return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
          })
        )
      )
    )
      return true;
  }
  return domainArea(differenceD(region, domain, FillRule.NonZero, 4)) <= 0.0001;
}

/** Cut through exclusion bounds until only representable, hole-free components remain. */
export function fitSimpleRegions(region: PathsD, site: Site): PathsD {
  let pieces = region;
  const holes = region.filter((p) => signedArea(p) < 0);
  for (const hole of holes) {
    for (const axis of [site.u, site.v]) {
      const cross = axis === site.u ? site.v : site.u;
      const h = project([hole], site.c, axis);
      const extent = project(pieces, site.c, axis);
      const side = project(pieces, site.c, cross);
      for (const cut of [h.min, h.max]) {
        const left = orientedRect(
          site.c,
          axis,
          cross,
          extent.min - 1,
          cut,
          side.min - 1,
          side.max + 1
        );
        const right = orientedRect(
          site.c,
          axis,
          cross,
          cut,
          extent.max + 1,
          side.min - 1,
          side.max + 1
        );
        // Separate the regions, rather than unioning them back into a donut.
        pieces = [
          ...intersectD(pieces, [left], FillRule.NonZero, 4),
          ...intersectD(pieces, [right], FillRule.NonZero, 4)
        ];
      }
    }
  }
  return pieces
    .filter(
      (p) => signedArea(p) >= MIN_PIECE_M2 && (holes.length === 0 || insideDomain([p], site.domain))
    )
    .map(canonicalRing)
    .sort((a, b) => signedArea(b) - signedArea(a) || a[0].x - b[0].x || a[0].y - b[0].y);
}
