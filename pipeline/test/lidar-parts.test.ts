import { describe, expect, it } from 'vitest';
import { area, difference, intersect, type MultiPoly, type Ring } from '../geom.js';
import {
  countedParts,
  partBoxes,
  partCoverage,
  uncoveredArea,
  type Part
} from '../lib/lidar/parts.js';

const rect = (x0: number, y0: number, x1: number, y1: number): MultiPoly => [
  [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1]
    ] as Ring
  ]
];

const part = (id: string, shape: MultiPoly, o: Partial<Part> = {}): Part => ({
  id,
  buildingId: 'b14',
  shape,
  heightM: 20,
  minHeightM: null,
  roofShape: null,
  roofHeightM: null,
  ...o
});

const tower = (o: Partial<Part> = {}): Part =>
  part('p14b', rect(133, 15, 137, 24), {
    heightM: 60,
    minHeightM: 20,
    roofShape: 'pyramidal',
    roofHeightM: 8,
    ...o
  });

describe('mapped parts', () => {
  it('a plain part', () => {
    const boxes = partBoxes('b14', [part('p14a', rect(132, 5, 138, 25))], 0);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ bid: 'b14', k: 0, src: 'part', baseM: 0, heightM: 20 });
  });

  it('pyramidal tiers', () => {
    const p = tower();
    const boxes = partBoxes('b14', [p], 1);
    expect(boxes).toHaveLength(6);
    expect(boxes.map((b) => b.k)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(boxes[0].baseM).toBe(20);
    expect(boxes[0].heightM).toBe(52);
    const tiers = boxes.slice(1);
    tiers.forEach((t, i) => {
      expect(Math.abs(t.baseM - (52 + 1.6 * i))).toBeLessThanOrEqual(0.05);
      expect(Math.abs(t.heightM - (52 + 1.6 * (i + 1)))).toBeLessThanOrEqual(0.05);
      expect(area(difference(t.shape, p.shape))).toBeLessThan(1e-6);
    });
    for (let i = 1; i < tiers.length; i++)
      expect(area(tiers[i].shape)).toBeLessThan(area(tiers[i - 1].shape));
  });

  it('dome tiers shrink by sqrt(1-t^2)', () => {
    const p = tower({ roofShape: 'dome' });
    const tiers = partBoxes('b14', [p], 0).slice(1);
    const ratio = area(tiers[2].shape) / area(p.shape);
    const want = 1 - 0.4 * 0.4;
    expect(Math.abs(ratio - want) / want).toBeLessThan(0.02);
  });

  it('gabled goes flat at eave + half', () => {
    const boxes = partBoxes(
      'b',
      [part('g', rect(0, 0, 5, 5), { heightM: 12, roofShape: 'gabled', roofHeightM: 4 })],
      0
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0].heightM).toBe(10);
  });

  it('tiered shape without roof height is flat at height', () => {
    const boxes = partBoxes('b', [tower({ roofHeightM: null })], 0);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ baseM: 20, heightM: 60 });
  });

  it('uncounted parts are ignored', () => {
    const c = part('p14c', rect(132, 5, 134, 7), { heightM: null });
    const ids = countedParts([tower(), c, part('p14a', rect(132, 5, 138, 25))]).map((p) => p.id);
    expect(ids).toEqual(['p14a', 'p14b']);
  });

  it('parts outside the footprint are kept', () => {
    const leg = part('p14leg', rect(139, 26, 140, 27), { heightM: 10 });
    const boxes = partBoxes('b14', countedParts([leg]), 0);
    expect(boxes).toHaveLength(1);
    expect(area(difference(boxes[0].shape, leg.shape))).toBeLessThan(1e-6);
    expect(area(intersect(boxes[0].shape, leg.shape))).toBeCloseTo(1, 6);
  });

  it('keeps baseM 0 for min_height 0 and clamps height only', () => {
    const b = partBoxes('b', [part('x', rect(0, 0, 3, 3), { heightM: 1, minHeightM: 0 })], 0);
    expect(b[0]).toMatchObject({ baseM: 0, heightM: 2.5 });
  });

  it('uncovered area', () => {
    const fp = rect(95, 5, 105, 25);
    const counted = countedParts([part('p10', rect(95, 5, 100, 25), { heightM: 18 })]);
    const u = uncoveredArea(fp, counted);
    expect(Math.abs(area(u) - 100)).toBeLessThan(0.01);
    for (const [x] of u[0][0]) expect(x).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(partCoverage(fp, counted)).toBeCloseTo(0.5, 6);
  });

  it('drops slivers where a part edge almost meets the footprint edge', () => {
    // The mini b10: lng/lat rounding leaves the part's north edge a few mm off the footprint's,
    // and the raw difference keeps a zero-width spike back to the footprint's far corner.
    const fp: MultiPoly = [
      [
        [
          [95, 5],
          [105, 5],
          [105, 25],
          [95, 25.008]
        ] as Ring
      ]
    ];
    const counted = [part('p10', rect(95, 5, 100, 24.999), { heightM: 18 })];
    const u = uncoveredArea(fp, counted);
    expect(Math.abs(area(u) - 100)).toBeLessThan(0.1);
    for (const poly of u)
      for (const ring of poly) for (const [x] of ring) expect(x).toBeGreaterThan(99.9);
  });

  it('drops uncovered pieces under 2 m2', () => {
    const fp = rect(0, 0, 10, 10);
    const counted = [part('x', rect(0, 0, 10, 9.9))];
    expect(uncoveredArea(fp, counted)).toEqual([]);
  });
});
