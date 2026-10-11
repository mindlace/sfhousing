import { describe, expect, it } from 'vitest';
import { referenceComposition, compositionCandidates, validComposition } from './compositions';
import { normaliseSite } from './site';
import { drawVariety } from './variety';
import { drawComposition } from './composition-variety';
import { compositionParcel } from './fixtures/composition-parcel';
import { occupiedArea } from './bands';
import { domainArea } from './domain';
import { inset, signedArea, intersect } from './poly';
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

describe('skyline recipes', () => {
  for (const stories of [20, 40]) {
    it(`distinguishes four tower forms at ${stories} floors`, () => {
      const site = normaliseSite(compositionParcel('t', 60, 50).polygon, 0.4)!;
      const reference = referenceComposition(site, 'tower', stories, drawVariety(1))!;
      const forms = (['slab', 'shouldered', 'offset', 'paired'] as CompositionId[]).map(
        (family) => {
          const candidate = compositionCandidates(site, reference, {
            ...drawComposition(1),
            familyOrder: [family]
          })[0];
          expect(candidate.family).toBe(family);
          expect(validComposition(site, candidate, reference)).toBe(true);
          if (family === 'paired') {
            const plates = candidate.bands.find((b) => b.firstFloor === 6)!.regions;
            expect(plates).toHaveLength(2);
            expect(plates.every((r) => signedArea(r) >= 150 && inset([r], 3).length > 0)).toBe(
              true
            );
            expect(
              domainArea(intersect(inset([plates[0]], -2.999), inset([plates[1]], -2.999)))
            ).toBe(0);
            expect(domainArea(plates)).toBeLessThanOrEqual(Math.min(900, 0.35 * site.A) + 0.01);
          }
          return JSON.stringify(candidate.bands);
        }
      );
      expect(new Set(forms).size).toBe(4);
    });
  }
  it('falls back when two usable separated plates do not fit', () => {
    const site = normaliseSite(compositionParcel('t', 10, 160).polygon, 0.4)!;
    const reference = referenceComposition(site, 'tower', 40, drawVariety(1))!;
    const candidate = compositionCandidates(site, reference, {
      ...drawComposition(1),
      familyOrder: ['paired']
    })[0];
    expect(candidate.family).not.toBe('paired');
    expect(candidate.typology).toBe(reference.typology);
  });
});
