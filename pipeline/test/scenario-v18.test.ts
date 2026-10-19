import { describe, expect, it } from 'vitest';
import { v18Compare, type V18Panel, type V18Row } from '../steps/scenario';

/** One T11 row (index 0) whose every V18 feature equals `row`'s, the base cap included. */
function t11Of(row: V18Row, baseCap: number | null): V18Panel {
  return {
    existingUnits: Uint16Array.of(row.existing_units),
    existingFloorAreaM2: Uint32Array.of(row.existing_floor_area_m2),
    existingStories: Uint8Array.of(row.existing_stories),
    lotAreaM2: Uint32Array.of(row.lot_area_m2),
    yearBuilt: Uint16Array.of(row.year_built),
    improvementShare: Float32Array.of(row.improvement_share),
    rentControlLikely: Uint8Array.of(row.rent_control_likely ? 1 : 0),
    landUseClass: Uint8Array.of(row.land_use_class),
    imputed: Uint8Array.of(row.imputed),
    baseCap: Uint16Array.of(baseCap === null ? 0xffff : baseCap),
    potentialRatio: { fzp: Float32Array.of(0), base: Float32Array.of(row.potential_ratio_base) },
    storiesGap: { fzp: Int16Array.of(0), base: Int16Array.of(row.stories_gap_base) },
    hostableBase: Uint8Array.of(row.hostable_base ? 1 : 0)
  };
}

const ROW: V18Row = {
  existing_units: 1,
  existing_floor_area_m2: 120,
  existing_stories: 2,
  lot_area_m2: 150,
  year_built: 1925,
  improvement_share: 0.25,
  rent_control_likely: false,
  land_use_class: 0,
  imputed: 0,
  base_density_cap: 3,
  potential_ratio_base: 3,
  stories_gap_base: 2,
  hostable_base: true
};

describe('v18Compare (V18 cap-period exclusion, coordinator ruling 2026-10-18)', () => {
  it('equal rows with equal caps match', () => {
    expect(v18Compare(t11Of(ROW, 3), 0, ROW)).toEqual({ capPeriodDiffers: false, mismatch: false });
  });

  it('a cap-period difference excludes the base-cap features and is counted', () => {
    // RM-1 on 1,614 sf: the panel's 2025 row (lien 2025-01-01) has max(3, 2) = 3, T11 (2026-01-11)
    // the bare 2, so the capped base yields, and the ratios, differ: each correct for its date.
    const t = t11Of(ROW, 2);
    t.potentialRatio.base[0] = 2;
    expect(v18Compare(t, 0, ROW)).toEqual({ capPeriodDiffers: true, mismatch: false });
  });

  it('a base-ratio difference with equal caps still fails', () => {
    const t = t11Of(ROW, 3);
    t.potentialRatio.base[0] = 2;
    expect(v18Compare(t, 0, ROW)).toEqual({ capPeriodDiffers: false, mismatch: true });
  });

  it('a mismatch unrelated to the cap still fails where the caps differ', () => {
    for (const edit of [
      (t: V18Panel) => (t.yearBuilt[0] = 1926),
      (t: V18Panel) => (t.imputed[0] = 1),
      (t: V18Panel) => (t.existingUnits[0] = 2),
      (t: V18Panel) => (t.storiesGap.base[0] = 1),
      (t: V18Panel) => (t.hostableBase[0] = 0)
    ]) {
      const t = t11Of(ROW, 2);
      t.potentialRatio.base[0] = 2;
      edit(t);
      expect(v18Compare(t, 0, ROW)).toEqual({ capPeriodDiffers: true, mismatch: true });
    }
  });

  it('a null cap on one side and a number on the other differ by period', () => {
    expect(v18Compare(t11Of(ROW, null), 0, ROW).capPeriodDiffers).toBe(true);
    expect(
      v18Compare(t11Of({ ...ROW, base_density_cap: null }, null), 0, {
        ...ROW,
        base_density_cap: null
      })
    ).toEqual({ capPeriodDiffers: false, mismatch: false });
  });
});
