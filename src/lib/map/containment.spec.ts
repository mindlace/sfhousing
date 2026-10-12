import { describe, expect, it } from 'vitest';
import golden from '$lib/generator/fixtures/golden-seeded.json';
import small from './fixtures/generated-small.json';
import type { GeneratedBuilding } from '$lib/generator';
import { fromLngLat } from '$lib/generator/geo';
import { insideDomain } from '$lib/generator/domain';
import { inset } from '$lib/generator/poly';
const buildings = [
  ...(golden as unknown as { out: GeneratedBuilding | null }[]).flatMap((c) =>
    c.out ? [c.out] : []
  ),
  ...(small as unknown as GeneratedBuilding[])
];
describe('supported part containment (U6)', () => {
  it('supports each whole region on the union of occupied solids below', () => {
    expect(buildings.length).toBeGreaterThan(0);
    for (const b of buildings) {
      const label = b.parts[0].footprint[0];
      const rings = b.parts.map((p) => fromLngLat(p.footprint, label).map(([x, y]) => ({ x, y })));
      b.parts.forEach((up, i) => {
        if (!up.baseM) return;
        const below = b.parts.flatMap((lo, j) =>
          lo.role === 'occupied' && lo.baseM < up.baseM && lo.topM >= up.baseM ? [rings[j]] : []
        );
        expect(insideDomain([rings[i]], inset(below, -0.02))).toBe(true);
      });
    }
  });
});
