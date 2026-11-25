import { describe, expect, it } from 'vitest';
import { viewOf } from '$lib/sim/world/score/view';
import type { CarsView, TimelineView } from '$lib/sim/world/score/types';
import { carsRow } from './cars-row';
import { carsChange, carsValue } from './copy';
import { chunk, cut, statics } from './test/fixtures';

/** Four months of cars: 1,000 households throughout, cars 1,200, 1,150, 1,100, 1,050. */
function cars(): CarsView {
  const households = [1000, 1000, 1000, 1000];
  const c = [1200, 1150, 1100, 1050];
  return {
    households,
    cars: c,
    carless: [300, 310, 320, 330],
    perHousehold: c.map((x, i) => x / households[i]),
    spacesPerHome: [null, 0.8, null, null],
    zones: c.map(() => new Float32Array([1.2, Number.NaN]))
  };
}

const view = (withCars = true): TimelineView => ({
  ...viewOf([chunk(0, 4)], statics({ lastIndex: 3 })),
  cars: withCars ? cars() : null
});

describe('carsRow', () => {
  it('is null without car data', () => {
    expect(carsRow(view(false), 2)).toBeNull();
  });

  it('is null before the first filled month', () => {
    expect(carsRow(cut(view(), -1), 0)).toBeNull();
  });

  it("reads month 0 as today and the playhead's month", () => {
    expect(carsRow(view(), 2)).toEqual({
      today: 1200,
      atPlayhead: 1100,
      perHouseholdToday: 1.2,
      perHouseholdAt: 1.1
    });
    expect(carsRow(view(), 0)).toEqual({
      today: 1200,
      atPlayhead: 1200,
      perHouseholdToday: 1.2,
      perHouseholdAt: 1.2
    });
  });

  it('is null for a month past the fill', () => {
    expect(carsRow(cut(view(), 1), 2)).toBeNull();
  });

  it('a month with no households has no cars per household; never NaN', () => {
    const v = view();
    v.cars!.perHousehold[2] = null;
    expect(carsRow(v, 2)?.perHouseholdAt).toBeNull();
    v.cars!.cars[3] = Number.NaN;
    expect(carsRow(v, 3)).toBeNull();
  });
});

describe('the row copy', () => {
  it('today alone at today, then today to the playhead', () => {
    const r = carsRow(view(), 2)!;
    expect(carsValue(r, true)).toBe('1,200');
    expect(carsValue(r, false)).toBe('1,200 → 1,100');
  });

  it('the change in cars per household, signed; nothing when either is unknown', () => {
    const r = carsRow(view(), 2)!;
    expect(carsChange(r)).toBe('−0.10 per household');
    expect(carsChange({ ...r, perHouseholdAt: 1.25 })).toBe('+0.05 per household');
    expect(carsChange({ ...r, perHouseholdAt: 1.2001 })).toBe('+0.00 per household');
    expect(carsChange({ ...r, perHouseholdAt: null })).toBeNull();
  });
});
