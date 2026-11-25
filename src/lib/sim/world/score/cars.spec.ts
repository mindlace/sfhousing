// Cars in the series, chunks and view.
import { describe, expect, it } from 'vitest';
import type { CarSnapshot } from '../cars/columns';
import { monthLastDay } from '../months';
import { chunkOf } from './chunk';
import { createWorldSeries } from './series';
import type { ScoreStatics, SeriesChunk, WorldSeriesData } from './types';
import { chunksBefore, viewOf } from './view';

const ASOF = 1000;
const N = 12;
// Calendar months of 30 days from the day after the as-of day.
const months = Array.from({ length: N }, (_, i) => ASOF + 1 + i * 30);
const statics = {
  asOf: ASOF,
  months,
  lastIndex: N - 1,
  baseline: { units: 0, since: ASOF, provenance: 'p' },
  tierBaseline: null,
  phasing: [],
  references: [],
  compare: 'plan',
  limits: null,
  debts: null
} as unknown as ScoreStatics;

const snap = (households: number, spaces: number | null = 1.5): CarSnapshot => ({
  households,
  cars: households / 2,
  carless: households / 4,
  spacesPerHome: spaces,
  zones: new Float32Array([households, 2 * households])
});

/** The calendar month holding model month m's last day. */
const calendarOf = (m: number): number =>
  months.filter((first) => first <= monthLastDay(ASOF, m)).length - 1;

function fed(upTo: number, cars: (m: number) => CarSnapshot | null) {
  const s = createWorldSeries(statics);
  for (let m = 1; m <= upTo; m++) s.stepped(m, cars(m));
  return s;
}

describe('cars in the series', () => {
  it('files a snapshot in the calendar month holding the model month last day', () => {
    const s = fed(14, (m) => snap(m * 10));
    const c = chunkOf(s, s, null, 0, s.finalThrough()).cars!;
    for (let m = 1; m <= 14; m++) {
      const i = calendarOf(m);
      if (i > s.finalThrough()) continue;
      // The last model month ending in calendar month i is the one filed there.
      const later = calendarOf(m + 1) === i;
      if (!later) expect(c[i].households).toBe(m * 10);
    }
  });

  it('a later model month in the same calendar month overwrites it', () => {
    // Calendar months of 61 days hold two model month ends each.
    const long = {
      ...statics,
      months: Array.from({ length: 6 }, (_, i) => ASOF + 1 + i * 61),
      lastIndex: 5
    } as ScoreStatics;
    const s = createWorldSeries(long);
    for (let m = 1; m <= 14; m++) s.stepped(m, snap(m * 10));
    const c = chunkOf(s, s, null, 0, s.finalThrough()).cars!;
    // Model months 1 and 2 end in calendar month 0 (days 1030, 1060 < 1062): 2 wins.
    expect(c[0].households).toBe(20);
    expect(c[1].households).toBe(40);
  });

  it('a calendar month with no model month ending in it carries the previous one', () => {
    // Feed only some model months; the calendar months between them carry the earlier.
    const s = fed(14, (m) => (m === 2 ? snap(10, null) : m === 6 ? snap(40) : null));
    const c = chunkOf(s, s, null, 0, s.finalThrough()).cars!;
    const a = calendarOf(2);
    const b = calendarOf(6);
    expect(b).toBeGreaterThan(a + 1);
    for (let i = a; i < b; i++) expect(c[i].households).toBe(10);
    expect(c[a].spacesPerHome).toBeNull();
    expect(c[b].spacesPerHome).toBe(1.5);
    expect(c[0].households).toBe(0);
  });

  it('a series fed no snapshots gives null cars', () => {
    const s = fed(14, () => null);
    const chunk = chunkOf(s, s, null, 0, 2);
    expect(chunk.cars).toBeNull();
    expect(viewOf([chunk], statics).cars).toBeNull();
  });

  it('data then restore gives the same chunks', () => {
    const s = fed(7, (m) => snap(m * 10, m % 2 ? null : 2));
    const r = createWorldSeries(statics, structuredClone(s.data()));
    for (let m = 8; m <= 14; m++) {
      s.stepped(m, snap(m * 10));
      r.stepped(m, snap(m * 10));
    }
    const a = chunkOf(s, s, null, 0, s.finalThrough());
    const b = chunkOf(r, r, null, 0, r.finalThrough());
    expect(a.cars).not.toBeNull();
    expect(b.cars).toEqual(a.cars);
  });

  it('rejects saved version 5 data', () => {
    const d = { ...createWorldSeries(statics).data(), version: 5 } as unknown as WorldSeriesData;
    expect(() => createWorldSeries(statics, d)).toThrow('world-score: saved series version 5');
  });
});

describe('cars in the view', () => {
  const s = fed(14, (m) => snap(m * 10, m === 6 ? null : 1.5));
  const through = s.finalThrough();
  const cs = (from: number, to: number): SeriesChunk => chunkOf(s, s, null, from, to);

  it('joins cars across chunks and divides per household', () => {
    const cars = viewOf([cs(0, 3), cs(4, through)], statics).cars!;
    expect(cars.households.length).toBe(through + 1);
    for (let i = 0; i <= through; i++) {
      expect(cars.perHousehold[i]).toBe(cars.cars[i] / cars.households[i]);
    }
    expect(cars.zones[through]).toBeInstanceOf(Float32Array);
    expect(cars.spacesPerHome.some((x) => x === null)).toBe(true);
  });

  it('chunksBefore trims the cars', () => {
    const t = chunksBefore([cs(0, 3), cs(4, through)], 6);
    expect(t.map((c) => c.cars!.length)).toEqual([4, 2]);
    expect(viewOf(t, statics).cars!.households.length).toBe(6);
  });

  it('a mix of null and non-null cars throws', () => {
    const bare = { ...cs(4, through), cars: null };
    expect(() => viewOf([cs(0, 3), bare], statics)).toThrow('mix');
  });
});
