import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate, generateDetailed, generateWith, type Detailed } from './generate';
import { varietyFromUniforms } from './variety';
import { signedArea } from './poly';
import std from './fixtures/std-25x100.json';
import shallow from './fixtures/shallow-adu-fail.json';
import lot1000 from './fixtures/lot-1000.json';
import lot3000 from './fixtures/lot-3000.json';
import lot1200 from './fixtures/lot-1200.json';
import overApt from './fixtures/std-over-apartment.json';
import over10 from './fixtures/std-over-10units.json';
import vacant from './fixtures/vacant-std.json';
import sliver from './fixtures/sliver.json';
import tiny from './fixtures/tiny.json';
import multipart from './fixtures/multipart.json';
import holed from './fixtures/holed.json';
import lshape from './fixtures/lshape.json';

/** Golden draws r = [0.5, 0.5, 0.5, 0.5, 0, x]: inset 0.4, stepback 2.25, parapet 0.75, slide 0, aspect 1. */
const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);
const P = (j: unknown) => j as ParcelRecord;
const run = (j: unknown, S: number) => generateDetailed(P(j), { maxStories: S }, GOLDEN, 'max');
const localArea = (d: Detailed, i: number) =>
  Math.abs(signedArea(d.local[i].ring.map(([x, y]) => ({ x, y }))));
/** Building without parcelId, footprints as sorted vertex lists (start vertex may differ). */
const shape = (d: Detailed | null) =>
  d && {
    ...d.building,
    parcelId: undefined,
    parts: d.building.parts.map((p) => ({ ...p, footprint: [...p.footprint].sort() }))
  };

describe('golden fixtures (hand-calculated, §6)', () => {
  it('std 25×100 S=3 → plex', () => {
    const d = run(std, 3)!;
    expect(d.building.typology).toBe('plex');
    expect(d.building.stories).toBe(3);
    expect(d.building.units).toBe(3);
    expect(d.building.replacesExisting).toBe(true);
    expect(d.building.parts).toHaveLength(1);
    expect(localArea(d, 0)).toBeCloseTo(139.4, 0); // ±0.5
    expect(Math.abs(d.building.floorAreaM2 - 418.1)).toBeLessThanOrEqual(2);
    expect(d.building.parts[0].baseM).toBe(0);
    expect(d.building.parts[0].topM).toBe(10.05); // 3×3.1 + 0.75
    expect(d.building.source).toBe('user');
    expect(d.building.parcelId).toBe('0000001');
  });
  it('std S=5 → walkup, FA 812.9, units 9', () => {
    const b = run(std, 5)!.building;
    expect(b.typology).toBe('walkup');
    expect(Math.abs(b.floorAreaM2 - 812.9)).toBeLessThanOrEqual(2);
    expect(b.units).toBe(9);
  });
  it('std S=12 → walkup via the cap chain, 5 stories, 9 units', () => {
    const b = run(std, 12)!.building;
    expect(b).toMatchObject({ typology: 'walkup', stories: 5, units: 9 });
  });
  it('std S=2 → adu, FA 68.75, 1 unit, keeps the existing building', () => {
    const b = run(std, 2)!.building;
    expect(b).toMatchObject({ typology: 'adu', stories: 2, units: 1, replacesExisting: false });
    expect(Math.abs(b.floorAreaM2 - 68.75)).toBeLessThanOrEqual(2);
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0]).toMatchObject({ baseM: 0, topM: 6.95 }); // 2×3.1 + 0.75
  });
  it('shallow lot S=2 → null (open 34 m² < 60)', () => {
    expect(run(shallow, 2)).toBeNull();
  });
  it('lot-1000 S=6 → podium, FA 4800, 59 units, top 20.0 + 0.75', () => {
    const b = run(lot1000, 6)!.building;
    expect(b.typology).toBe('podium');
    expect(Math.abs(b.floorAreaM2 - 4800)).toBeLessThanOrEqual(2);
    expect(b.units).toBe(59);
    expect(b.parts.map((p) => p.topM)).toEqual([20.75]);
  });
  it('std over an 8-unit apartment (FA 700) S=3 → null (N6)', () => {
    expect(run(overApt, 3)).toBeNull();
  });
  it('std with 1 unit, FA 500, S=3 → null (N6 isolated: FA 418 ≤ 500, units 3 > 1)', () => {
    expect(run({ ...std, existingUnits: 1, existingFloorAreaM2: 500 }, 3)).toBeNull();
  });
  it('aduEnd −1 places the ADU at the −u end', () => {
    const d = generateDetailed(
      P(std),
      { maxStories: 2 },
      varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.75]),
      'max'
    )!;
    expect(d.building.typology).toBe('adu');
    expect(Math.abs(d.building.floorAreaM2 - 68.75)).toBeLessThanOrEqual(2);
    expect(d.local[0].ring.every(([, y]) => y < 0)).toBe(true);
  });
  it('std over 10 units (FA 600) S=5 → null (N7)', () => {
    expect(run(over10, 5)).toBeNull();
  });
  it('vacant std S=2 → plex replacement, 2 stories, FA 278.7, 2 units', () => {
    const b = run(vacant, 2)!.building;
    expect(b).toMatchObject({ typology: 'plex', stories: 2, units: 2, replacesExisting: true });
    expect(Math.abs(b.floorAreaM2 - 278.7)).toBeLessThanOrEqual(2);
  });
  it('sliver and tiny → null at any S', () => {
    for (const S of [1, 3, 5, 12, 40]) {
      expect(run(sliver, S)).toBeNull();
      expect(run(tiny, S)).toBeNull();
    }
  });
  it('multipart and holed equal the std S=3 result', () => {
    expect(shape(run(multipart, 3))).toEqual(shape(run(std, 3)));
    expect(shape(run(holed, 3))).toEqual(shape(run(std, 3)));
  });
  it('lshape S=5 → walkup, ≥ 1 part, footprint ≤ 0.7·A·1.001', () => {
    const d = run(lshape, 5)!;
    expect(d.building.typology).toBe('walkup');
    expect(d.local.length).toBeGreaterThanOrEqual(1);
    const base = d.local.reduce((s, _, i) => s + localArea(d, i), 0);
    expect(base).toBeLessThanOrEqual(0.7 * 300 * 1.001);
  });
});

describe('I8 contract and mode', () => {
  it('unsupported mode throws', () => {
    expect(() => generate(P(std), { maxStories: 3 }, 1, 'likely' as never)).toThrow(
      'unsupported BuildoutMode'
    );
  });
  it('ineligible parcel → null', () => {
    expect(
      generateWith(P({ ...std, eligible: false }), { maxStories: 3 }, GOLDEN, 'max')
    ).toBeNull();
  });
  it('generate draws variety from the seed', () => {
    const a = generate(P(std), { maxStories: 3 }, 1, 'max');
    const b = generate(P(std), { maxStories: 3 }, 1, 'max');
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });
  // Review Focus 3
  it('clockwise outer ring gives the same building', () => {
    const cw = { ...std, polygon: [[...std.polygon[0]].reverse()] };
    expect(shape(run(cw, 3))).toEqual(shape(run(std, 3)));
    expect(shape(run(cw, 2))).toEqual(shape(run(std, 2)));
  });
  // Review Focus 4
  it('odd envelope values floor, null or clamp; unknown fields are ignored', () => {
    expect(run(std, 5.7)!.building).toEqual(run(std, 5)!.building);
    for (const S of [0, 0.9, -3, NaN, Infinity, -Infinity]) expect(run(std, S)).toBeNull();
    expect(run(lot1000, 1e9)!.building.stories).toBeLessThanOrEqual(80);
    const extra = { maxStories: 3, farMax: 2, setbackM: 9 } as unknown as { maxStories: number };
    expect(generateWith(P(std), extra, GOLDEN, 'max')).toEqual(run(std, 3)!.building);
  });
  it('local parts mirror the output parts', () => {
    const d = run(std, 3)!;
    expect(d.local.map((l) => [l.baseM, l.topM])).toEqual(
      d.building.parts.map((p) => [p.baseM, p.topM])
    );
    expect(d.local[0].ring.length).toBe(d.building.parts[0].footprint.length);
  });
});

describe('golden fixtures: midrise and tower', () => {
  it('lot-1000 S=10 → midrise, FA 6587.4, 81 units, tops 20.0 / 32.4 + 0.75', () => {
    const d = run(lot1000, 10)!;
    expect(d.building.typology).toBe('midrise');
    expect(Math.abs(d.building.floorAreaM2 - 6587.4)).toBeLessThanOrEqual(2);
    expect(d.building.units).toBe(81);
    expect(d.building.parts.map((p) => [p.baseM, p.topM])).toEqual([
      [0, 20],
      [20, 33.15]
    ]);
  });
  it('lot-3000 S=30 → tower, podium plate 2400, tower plate 900, 394 units', () => {
    const d = run(lot3000, 30)!;
    expect(d.building).toMatchObject({ typology: 'tower', stories: 30, units: 394 });
    expect(d.building.parts.map((p) => [p.baseM, p.topM])).toEqual([
      [0, 16.9],
      [16.9, 95.15]
    ]);
    expect(localArea(d, 0)).toBeCloseTo(2400, 0);
    expect(localArea(d, 1)).toBeCloseTo(900, 0);
  });
  it('lot-1200 S=30 → midrise, 12 stories (cap chain)', () => {
    expect(run(lot1200, 30)!.building).toMatchObject({ typology: 'midrise', stories: 12 });
  });
  it('midrise without room for a stepback keeps U = F', () => {
    const narrow = {
      ...lot1000,
      id: 'n',
      polygon: [
        [
          [-5.5, -27.5],
          [5.5, -27.5],
          [5.5, 27.5],
          [-5.5, 27.5]
        ]
      ]
    };
    const big = varietyFromUniforms([0.5, 0.999, 0.5, 0.5, 0, 0.25]);
    const d = generateDetailed(P(narrow), { maxStories: 10 }, big, 'max')!;
    expect(d.building.typology).toBe('midrise');
    expect(d.local[1].ring).toEqual(d.local[0].ring);
  });
  it('tall paint on a large skinny L falls back without breaking nesting', () => {
    const L = {
      ...lot1000,
      id: 'L',
      polygon: [
        [
          [0, 0],
          [90, 0],
          [90, 10],
          [10, 10],
          [10, 80],
          [0, 80]
        ]
      ]
    };
    const d = run(L, 40)!;
    expect(['tower', 'midrise']).toContain(d.building.typology);
    if (d.building.typology === 'midrise') expect(d.building.stories).toBe(12);
    for (const up of d.local.filter((l) => l.baseM > 0)) {
      expect(d.local.some((lo) => lo.baseM < up.baseM && lo.topM === up.baseM)).toBe(true);
    }
  });
});
