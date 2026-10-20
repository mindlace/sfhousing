import { describe, expect, it } from 'vitest';
import { FillRule, intersectD, unionD, type PathD, type PathsD } from 'clipper2-ts';
import {
  BLOCK_U_M,
  BLOCK_V_M,
  DISTRICT_MIN_M2,
  LOT_MIN_M2,
  OPEN_SPACE_SHARE,
  STREET_M
} from './constants';
import { districtArea, layoutDistrict, mayBeDistrict } from './district-layout';
import { domainArea, insideDomain } from './domain';
import { holed40ha, lshape, pier, rect, twoPieces, type Polygon } from './fixtures/district';
import { inset, signedArea } from './poly';

const toPaths = (polygon: Polygon): PathsD => polygon.map((r) => r.map(([x, y]) => ({ x, y })));
/** The fixture's domain as oriented Clipper contours (outers CCW, holes CW). */
const domainOf = (polygon: Polygon): PathsD => unionD(toPaths(polygon), FillRule.EvenOdd);
const keyParts = (key: string) => key.split(':').map(Number);

function segDist2(p: { x: number; y: number }, a: { x: number; y: number }, b: typeof a) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}
/** Minimum distance between two disjoint rings (vertex-to-edge both ways). */
function ringDist(a: PathD, b: PathD): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [s, t] of [
    [a, b],
    [b, a]
  ]) {
    for (const p of s) {
      for (let i = 0; i < t.length; i++) {
        const d = segDist2(p, t[i], t[(i + 1) % t.length]);
        if (d < best) best = d;
      }
    }
  }
  return Math.sqrt(best);
}

const FIXTURES: [string, Polygon][] = [
  ['rect(800, 500)', rect(800, 500)],
  ['lshape', lshape],
  ['holed40ha', holed40ha],
  ['twoPieces', twoPieces]
];

describe('districtArea', () => {
  it('sums every piece', () => {
    expect(districtArea(twoPieces)).toBeCloseTo(400 * 300 + 160 * 70, 2);
  });
  it('subtracts holes', () => {
    expect(districtArea(holed40ha)).toBeCloseTo(800 * 500 - 150 * 100, 2);
  });
});

describe('mayBeDistrict (cheap upper bound before the union)', () => {
  it('is true for a 2 ha rectangle and false just under it', () => {
    expect(mayBeDistrict(rect(200, 100))).toBe(true);
    expect(mayBeDistrict(rect(141.4, 141.4))).toBe(false);
  });
  it('is never false when districtArea reaches the threshold', () => {
    const all = [...FIXTURES.map(([, p]) => p), rect(167, 73), pier(25, 900)];
    for (const p of all) {
      if (districtArea(p) >= DISTRICT_MIN_M2) expect(mayBeDistrict(p)).toBe(true);
    }
    expect(all.some((p) => districtArea(p) >= DISTRICT_MIN_M2)).toBe(true);
  });
});

describe('layoutDistrict', () => {
  it('lots stay inside the site and out of holes', () => {
    for (const p of [rect(800, 500), lshape, holed40ha]) {
      const domain = domainOf(p);
      const grown = inset(domain, -0.02);
      const holes = domain.filter((r) => signedArea(r) < 0).map((r) => [...r].reverse());
      for (const seed of [1, 2, 3]) {
        const { lots } = layoutDistrict(p, seed);
        expect(lots.length).toBeGreaterThan(0);
        for (const lot of lots) {
          expect(insideDomain(toPaths(lot.polygon), grown)).toBe(true);
          for (const hole of holes) {
            const overlap = intersectD(toPaths(lot.polygon), [hole], FillRule.NonZero, 4);
            expect(domainArea(overlap)).toBeLessThanOrEqual(0.01);
          }
        }
      }
    }
  });

  it('no lot under LOT_MIN_M2', () => {
    for (const [, p] of FIXTURES) {
      for (const seed of [1, 2, 3]) {
        const { lots } = layoutDistrict(p, seed);
        expect(lots.every((l) => l.areaM2 >= LOT_MIN_M2)).toBe(true);
        for (const l of lots) expect(l.areaM2).toBeCloseTo(domainArea(toPaths(l.polygon)), 6);
      }
    }
  });

  it('streets are at least STREET_M wide', () => {
    const { lots } = layoutDistrict(rect(800, 500), 1);
    let min = Number.POSITIVE_INFINITY;
    for (let a = 0; a < lots.length; a++) {
      const [, ia, ja] = keyParts(lots[a].key);
      for (let b = a + 1; b < lots.length; b++) {
        const [, ib, jb] = keyParts(lots[b].key);
        if (ia === ib && ja === jb) continue;
        const d = ringDist(toPaths(lots[a].polygon)[0], toPaths(lots[b].polygon)[0]);
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThanOrEqual(STREET_M - 0.05);
    expect(min).toBeLessThan(STREET_M + 0.05);
  });

  it('open space within one block of target', () => {
    for (const seed of [1, 2, 3]) {
      const { lots, openSpace } = layoutDistrict(rect(800, 500), seed);
      const openArea = openSpace.reduce((s, b) => s + domainArea(toPaths(b)), 0);
      // rectangular blocks are tiled exactly by their lots, so lots + open = Σ block area
      const blockArea = openArea + lots.reduce((s, l) => s + l.areaM2, 0);
      expect(openSpace.length).toBeGreaterThan(0);
      expect(Math.abs(openArea - OPEN_SPACE_SHARE * blockArea)).toBeLessThanOrEqual(
        BLOCK_U_M * BLOCK_V_M
      );
    }
    expect(layoutDistrict(rect(800, 500), 1, 0).openSpace).toEqual([]);
  });

  it('a one-block piece gets no synthetic street', () => {
    const { lots } = layoutDistrict(twoPieces, 1);
    const small = lots.filter((l) => keyParts(l.key)[0] === 1);
    expect(small.length).toBeGreaterThan(0);
    for (const l of small) {
      const [, i, j] = keyParts(l.key);
      expect(i).toBe(0);
      expect(j).toBe(0);
    }
    expect(small.reduce((s, l) => s + l.areaM2, 0)).toBeCloseTo(160 * 70, 1);
  });

  it('pier yields no lots', () => {
    // 5 m × 4,100 m: a district (20,500 m²) whose every block is under BLOCK_MIN_M2
    const thin = pier(5, 4100);
    expect(mayBeDistrict(thin)).toBe(true);
    expect(districtArea(thin)).toBeGreaterThanOrEqual(DISTRICT_MIN_M2);
    for (const seed of [1, 2, 3]) expect(layoutDistrict(thin, seed).lots).toEqual([]);
  });

  it('a 25 m pier still yields lots inside the site', () => {
    const p = pier(25, 900);
    const grown = inset(domainOf(p), -0.02);
    const { lots } = layoutDistrict(p, 1);
    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) expect(insideDomain(toPaths(lot.polygon), grown)).toBe(true);
  });

  it('deterministic and order-independent', () => {
    for (const [, p] of FIXTURES) {
      const a = layoutDistrict(p, 7);
      expect(layoutDistrict(p, 7)).toStrictEqual(a);
      expect(layoutDistrict([...p].reverse(), 7)).toStrictEqual(a);
      expect(
        layoutDistrict(
          p.map((r) => [...r].reverse()),
          7
        )
      ).toStrictEqual(a);
    }
  });

  it('keys are unique and lots come in a sweep order', () => {
    const { lots } = layoutDistrict(rect(800, 500), 3);
    expect(new Set(lots.map((l) => l.key)).size).toBe(lots.length);
    const parts = lots.map((l) => keyParts(l.key));
    const cmp = (x: number[], y: number[]) => {
      for (let n = 0; n < x.length; n++) if (x[n] !== y[n]) return x[n] - y[n];
      return 0;
    };
    const signs = parts.slice(1).map((p, n) => Math.sign(cmp(p, parts[n])));
    expect(signs.every((s) => s === signs[0])).toBe(true);
  });

  it('median block splits into 2 × 4 lots', () => {
    const { lots, openSpace } = layoutDistrict(rect(167, 73), 1, 0);
    expect(openSpace).toEqual([]);
    expect(lots).toHaveLength(8);
    for (const l of lots) expect(Math.abs(l.areaM2 - 1524)).toBeLessThanOrEqual(5);
  });

  it('reports the summed domain area', () => {
    expect(layoutDistrict(holed40ha, 1).areaM2).toBeCloseTo(districtArea(holed40ha), 6);
  });
});
