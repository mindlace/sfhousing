import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import golden from '$lib/generator/fixtures/golden-seeded.json';
import small from './fixtures/generated-small.json';
import type { GeneratedBuilding } from '$lib/generator';

type Pt = [number, number];
const EPS = 1e-9;

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= EPS;
}
function insideOrOn(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (onSegment(p, ring[j], ring[i])) return true;
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

const buildings: GeneratedBuilding[] = [
  ...(golden as unknown as { out: GeneratedBuilding | null }[])
    .map((c) => c.out)
    .filter((o): o is GeneratedBuilding => o !== null),
  ...(small as unknown as GeneratedBuilding[])
];

describe('nested part containment (U6)', () => {
  it('every part footprint lies inside or on the part below', () => {
    expect(buildings.length).toBeGreaterThan(0);
    expect(() =>
      fc.assert(
        fc.property(fc.constantFrom(...buildings), (b) => {
          for (let i = 1; i < b.parts.length; i++)
            for (const v of b.parts[i].footprint)
              if (!insideOrOn(v, b.parts[i - 1].footprint as Pt[])) return false;
          return true;
        }),
        { numRuns: 200 }
      )
    ).not.toThrow();
  });
});
