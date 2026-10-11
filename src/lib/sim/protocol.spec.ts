import { describe, expect, it } from 'vitest';
import type { ParcelSummaryLike } from '$lib/map/types';
import type { ParcelSummary } from './protocol';

describe('protocol', () => {
  it('ParcelSummary is assignable to ParcelSummaryLike (compile-time, I17 addendum)', () => {
    const s: ParcelSummary = {
      parcelId: '3512008',
      neighborhood: 'Mission',
      landUse: 'UNKNOWN',
      eligible: true,
      existingUnits: 2,
      envelope: { maxStories: 6 },
      generated: { typology: 'plex', stories: 3, units: 2 }
    };
    const like: ParcelSummaryLike = s;
    expect(like.generated?.units).toBe(2);
  });
});
