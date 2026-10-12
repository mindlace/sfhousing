import { expect, it } from 'vitest';
import { roofAccents } from './roof';
import { compositionCandidates, referenceComposition } from './compositions';
import { compositionParcel } from './fixtures/composition-parcel';
import { normaliseSite } from './site';
import { drawComposition } from './composition-variety';
import { drawVariety } from './variety';
import { insideDomain } from './domain';
import { floorTop } from './massing';
import { occupiedArea } from './bands';
import { inset } from './poly';
it('caps highest roofs within the height allowance without adding housing', () => {
  const site = normaliseSite(compositionParcel('p', 60, 50).polygon, 0.4)!;
  const reference = referenceComposition(site, 'tower', 40, drawVariety(1))!;
  const draws = { ...drawComposition(1), capEnabled: true, familyOrder: ['paired' as const] };
  const composition = compositionCandidates(site, reference, draws)[0];
  const area = occupiedArea(composition.bands);
  const caps = roofAccents(site, composition, draws, 0.7);
  expect(caps.length).toBeGreaterThan(0);
  expect(caps.length).toBeLessThanOrEqual(2);
  expect(caps.every((c) => c.topM <= floorTop(composition.typology, 40) + 0.7)).toBe(true);
  const roofs = composition.bands
    .filter((b) => b.firstFloor + b.floors - 1 === 40)
    .flatMap((b) => b.regions);
  expect(caps.every((c) => insideDomain([c.ring], inset(roofs, 0.2)))).toBe(true);
  expect(roofAccents(site, composition, { ...draws, capEnabled: false }, 0.7)).toEqual([]);
  expect(occupiedArea(composition.bands)).toBe(area);
  expect(roofAccents(site, composition, draws, 0)).toEqual([]);
});
