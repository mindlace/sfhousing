import { expect, it } from 'vitest';
import { compositionDistrict } from './composition-district';
for (const stories of [6, 20, 40])
  it(`represents the composition vocabulary at ${stories} floors`, () => {
    const district = compositionDistrict(42, stories);
    const families = new Set(district.buildings.map((b) => b.composition));
    for (const family of stories === 6
      ? ['simple', 'terrace', 'divided']
      : ['slab', 'shouldered', 'offset', 'paired'])
      expect(families.has(family as never)).toBe(true);
    expect(district).toEqual(compositionDistrict(42, stories));
    expect(district.buildings.every((b) => Number.isFinite(b.floorAreaM2) && b.units > 0)).toBe(
      true
    );
  });
