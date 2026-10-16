import { describe, expect, it } from 'vitest';
import type { TransitNetwork } from '$lib/data/transit';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { SF_GRID_BBOX, accessAt, buildAccessGrid, gridLngLat, walkWeight } from './grid';

const at = (x: number, y: number): [number, number] => [
  LNG0 + x / M_PER_DEG_LNG,
  LAT0 + y / M_PER_DEG_LAT
];
const V = { bus: { label: 'b', seats: 30, capacity: 44 } };
function line(stops: [number, number][], tph = 10): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }],
    vehicles: V,
    stops: stops.map(([x, y], i) => ({
      id: `s${i}`,
      name: `s${i}`,
      lngLat: at(x, y),
      stationId: null,
      placeId: `s${i}`
    })),
    patterns: [
      {
        id: 'p',
        operatorId: 'muni',
        routeId: '1',
        routeName: '1',
        mode: 'bus',
        direction: 0,
        vehicle: 'bus',
        cars: 1,
        stops: stops.map((_, i) => ({ stop: i, tph, tpd: tph * 18 }))
      }
    ]
  };
}

describe('walkWeight', () => {
  it('is 1 to d0, linear to 0 at R, 0 beyond', () => {
    expect(walkWeight(0)).toBe(1);
    expect(walkWeight(200)).toBe(1);
    expect(walkWeight(500)).toBeCloseTo(0.5);
    expect(walkWeight(800)).toBe(0);
    expect(walkWeight(900)).toBe(0);
  });
});

describe('buildAccessGrid', () => {
  it('counts a route-direction once, at its best stop, however many stops are near', () => {
    const one = buildAccessGrid(line([[0, 0]]));
    const six = buildAccessGrid(
      line([
        [0, 0],
        [60, 0],
        [120, 0],
        [180, 0],
        [240, 0],
        [300, 0]
      ])
    );
    expect(accessAt(one, at(0, 0))).toBeCloseTo(440, 0);
    expect(accessAt(six, at(150, 0))).toBeCloseTo(440, 0);
  });

  it('decays with distance and is 0 beyond R', () => {
    const g = buildAccessGrid(line([[0, 0]]));
    expect(accessAt(g, at(500, 0))).toBeGreaterThan(150);
    expect(accessAt(g, at(500, 0))).toBeLessThan(290);
    expect(accessAt(g, at(2000, 0))).toBe(0);
  });

  it('sums different route-directions', () => {
    const n = line([[0, 0]]);
    n.patterns.push({ ...n.patterns[0], id: 'q', direction: 1 });
    expect(accessAt(buildAccessGrid(n), at(0, 0))).toBeCloseTo(880, 0);
  });

  it('changes when the network is edited (raise a route frequency)', () => {
    const n = line([[0, 0]]);
    const before = accessAt(buildAccessGrid(n), at(0, 0));
    n.patterns[0] = { ...n.patterns[0], stops: [{ stop: 0, tph: 20, tpd: 360 }] };
    expect(accessAt(buildAccessGrid(n), at(0, 0))).toBeCloseTo(2 * before, 0);
  });

  it('covers the bounds and is all zero for an empty network', () => {
    const g = buildAccessGrid(line([[0, 0]]));
    const [w, so, e, n] = SF_GRID_BBOX;
    expect(gridLngLat(g, 0, 0)[0]).toBeCloseTo(w, 6);
    expect(gridLngLat(g, 0, 0)[1]).toBeCloseTo(so, 6);
    const [ex, ey] = gridLngLat(g, g.cols * g.sizeM, g.rows * g.sizeM);
    expect(ex).toBeGreaterThanOrEqual(e);
    expect(ey).toBeGreaterThanOrEqual(n);
    const empty = buildAccessGrid({ ...line([]), patterns: [] });
    expect(empty.values.length).toBe(g.values.length);
    expect(empty.values.every((v) => v === 0)).toBe(true);
    expect(accessAt(empty, at(0, 0))).toBe(0);
  });

  it('is 0 outside the grid', () => {
    expect(accessAt(buildAccessGrid(line([[0, 0]])), [-123, 37.75])).toBe(0);
  });
});
