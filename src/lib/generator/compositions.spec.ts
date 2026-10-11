import { describe, expect, it } from 'vitest';
import { referenceComposition, compositionCandidates, validComposition } from './compositions';
import { normaliseSite } from './site';
import { drawVariety } from './variety';
import { drawComposition } from './composition-variety';
import { compositionParcel } from './fixtures/composition-parcel';
import { occupiedArea } from './bands';
import { inset } from './poly';
import { lRing } from './fixtures/geom';
import type { CompositionId } from './composition-types';

describe('parcel composition recipes', () => {
  for (const family of ['simple', 'terrace', 'divided'] as CompositionId[]) {
    it(`fits a six-floor ${family} and preserves capacity`, () => {
      const site = normaliseSite(compositionParcel('p', 30, 30).polygon, 0.4)!;
      const reference = referenceComposition(site, 'podium', 6, drawVariety(1))!;
      const candidate = compositionCandidates(site, reference, {
        ...drawComposition(1),
        familyOrder: [family]
      })[0];
      expect(candidate.family).toBe(family);
      expect(candidate.stories).toBe(6);
      expect(validComposition(site, candidate, reference)).toBe(true);
      expect(occupiedArea(candidate.bands)).toBeGreaterThanOrEqual(
        0.9 * occupiedArea(reference.bands)
      );
    });
  }
  it('fits awkward parcels without creating narrow scraps', () => {
    for (const polygon of [compositionParcel('n', 7.62, 30.48).polygon, [lRing(30, 30, 15, 15)]]) {
      const site = normaliseSite(polygon, 0.4)!;
      const reference = referenceComposition(site, 'walkup', 5, drawVariety(1))!;
      const candidates = compositionCandidates(site, reference, drawComposition(1));
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every((c) => validComposition(site, c, reference))).toBe(true);
      expect(
        candidates.every((c) =>
          c.bands.every((b) => b.regions.every((r) => inset([r], 1.5).length > 0))
        )
      ).toBe(true);
    }
  });
  it('extends the same low-rise family when the allowance rises', () => {
    const site = normaliseSite(compositionParcel('p', 30, 30).polygon, 0.4)!;
    for (const family of ['terrace', 'divided'] as CompositionId[]) {
      let previous = 0;
      for (const stories of [5, 6, 7, 8, 9, 10, 11, 12]) {
        const reference = referenceComposition(
          site,
          stories >= 8 ? 'midrise' : 'podium',
          stories,
          drawVariety(1)
        )!;
        const candidate = compositionCandidates(site, reference, {
          ...drawComposition(1),
          familyOrder: [family]
        })[0];
        expect(candidate.family).toBe(family);
        expect(occupiedArea(candidate.bands)).toBeGreaterThan(previous);
        previous = occupiedArea(candidate.bands);
      }
    }
  });
});
