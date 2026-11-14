import { describe, expect, it } from 'vitest';
import { precomputeOf } from '$lib/sim/scenario/input';
import { miniInput } from './mini';
import {
  IDENTITY,
  changingAt,
  frameOf,
  limited,
  oldInputOf,
  oneFrame,
  scaleProduct,
  touchedRows,
  upzoned
} from './timeline';

describe('world test support', () => {
  it('builds frames, timelines and upzoned lots on the mini city', () => {
    const input = miniInput();
    const f = frameOf(input);
    expect(f.view.pre).toBe(precomputeOf(input));
    expect(oneFrame(f).frameAt(480)).toBe(f);
    const g = frameOf(input, { id: 1, market: 0.4 });
    const t = changingAt(13, f, g, null);
    expect([t.frameAt(12), t.frameAt(13)]).toEqual([f, g]);
    expect(t.changes()).toEqual([13]);
    expect(() => limited(t, () => 12).frameAt(13)).toThrow(RangeError);
    expect(
      scaleProduct(
        { ...IDENTITY, discretionary: { filed: 0.5 } },
        { ...IDENTITY, discretionary: { filed: 0.5 } }
      ).discretionary.filed
    ).toBe(0.25);
    expect(oldInputOf(input).newProjects).toEqual({
      calibration: input.calibration,
      scale: IDENTITY
    });
    const rows = Int32Array.of(...precomputeOf(input).candidates.slice(0, 3));
    expect(Array.from(touchedRows(input.parcels, upzoned(input, rows)))).toEqual(Array.from(rows));
  });
});
