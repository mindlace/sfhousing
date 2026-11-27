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
  hostable_base: true
};

describe('v18Compare (coordinator ruling 2026-10-18)', () => {
  it('equal rows with equal caps match', () => {
    expect(v18Compare(t11Of(ROW, 3), 0, ROW)).toEqual({ capPeriodDiffers: false, mismatch: false });
  });

  it('a cap-period difference is counted and compares nothing less (hostableBase reads no cap)', () => {
    // RM-1 on 1,614 sf: the panel's 2025 row (lien 2025-01-01) has max(3, 2) = 3, T11 (2026-01-11)
    // the bare 2, each correct for its date.
    expect(v18Compare(t11Of(ROW, 2), 0, ROW)).toEqual({ capPeriodDiffers: true, mismatch: false });
  });

  it('a mismatch fails whether or not the caps differ', () => {
    for (const cap of [2, 3])
      for (const edit of [
        (t: V18Panel) => (t.yearBuilt[0] = 1926),
        (t: V18Panel) => (t.imputed[0] = 1),
        (t: V18Panel) => (t.existingUnits[0] = 2),
        (t: V18Panel) => (t.existingStories[0] = 1),
        (t: V18Panel) => (t.hostableBase[0] = 0)
      ]) {
        const t = t11Of(ROW, cap);
        edit(t);
        expect(v18Compare(t, 0, ROW).mismatch).toBe(true);
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

  it('freeway land compares hostableBase with the rule (0), not the panel', () => {
    // The panel keeps freeway land eligible (calibration describes the past market); T11 applies
    // the rule, so its hostableBase is 0 while the panel's is not.
    const t = t11Of(ROW, 3);
    t.hostableBase[0] = 0;
    expect(v18Compare(t, 0, ROW, true)).toEqual({ capPeriodDiffers: false, mismatch: false });
    expect(v18Compare(t, 0, ROW).mismatch).toBe(true);
    expect(v18Compare(t11Of(ROW, 3), 0, ROW, true).mismatch).toBe(true);
    const u = t11Of(ROW, 3);
    u.hostableBase[0] = 0;
    u.yearBuilt[0] = 1926;
    expect(v18Compare(u, 0, ROW, true).mismatch).toBe(true);
  });
});
