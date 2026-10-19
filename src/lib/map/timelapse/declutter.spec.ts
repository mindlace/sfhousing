import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { barSizePx } from './bars';
import { BAR_MIN_ZOOM, DECLUTTER_MAX_ZOOM, DECLUTTER_STEP } from './constants';
import { declutter, mpp } from './declutter';
import type { BarAttrs } from './types';
import { OPEN_DAY } from '$lib/timelapse/time';

const LAT = 37.75;
const LNG = -122.44;
const M_PER_DEG_LAT = 111320;
const LADDER: number[] = [];
for (let z = BAR_MIN_ZOOM; z <= DECLUTTER_MAX_ZOOM; z += DECLUTTER_STEP) LADDER.push(z);

/** A bar at `(dx, dy)` metres from the origin, active over `[from, to)`. */
function mk(
  id: string,
  units: number,
  dx: number,
  dy: number,
  from = 0,
  to: number = OPEN_DAY,
  parcelId = id
): BarAttrs {
  const lat = LAT + dy / M_PER_DEG_LAT;
  const lng = LNG + dx / (M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180));
  return {
    projectId: id,
    parcelId,
    units,
    pathway: 0,
    anchor: [lng, lat, 20],
    from,
    to,
    barEnd: to,
    endDay: OPEN_DAY,
    endKind: 0,
    completeDay: OPEN_DAY,
    segCount: 5,
    segEntry: [],
    segTypicalDays: [],
    segRow: [],
    minZoom: BAR_MIN_ZOOM
  };
}

const zoomsOf = (bars: BarAttrs[]) => bars.map((b) => b.minZoom);

describe('mpp', () => {
  it('is the Web Mercator metres per 512 px tile pixel', () => {
    expect(mpp(0, 0)).toBeCloseTo(40075016.686 / 512, 6);
    expect(mpp(15, 0)).toBeCloseTo(40075016.686 / (512 * 2 ** 15), 9);
    expect(mpp(15, 60)).toBeCloseTo(mpp(15, 0) / 2, 9);
  });
});

describe('declutter', () => {
  it('is deterministic', () => {
    const make = () => [
      mk('a', 10, 0, 0),
      mk('b', 10, 5, 0),
      mk('c', 30, 8, 3),
      mk('d', 5, 12, 12)
    ];
    const one = make();
    const two = make();
    declutter(one);
    declutter(two);
    expect(zoomsOf(two)).toEqual(zoomsOf(one));
    declutter(one);
    expect(zoomsOf(one)).toEqual(zoomsOf(two));
  });

  it('is independent of input order', () => {
    const bars = [mk('a', 10, 0, 0), mk('b', 10, 5, 0), mk('c', 30, 8, 3)];
    const rev = [...bars].reverse().map((b) => ({ ...b }));
    declutter(bars);
    declutter(rev);
    for (const b of bars) {
      expect(rev.find((r) => r.projectId === b.projectId)!.minZoom).toBe(b.minZoom);
    }
  });

  it('keeps co-located, time-disjoint projects at 15', () => {
    const bars = [mk('a', 10, 0, 0, 0, 100), mk('b', 10, 0, 0, 100, 200)];
    declutter(bars);
    expect(zoomsOf(bars)).toEqual([15, 15]);
  });

  it('gives co-located, overlapping projects the larger one first', () => {
    const bars = [mk('small', 5, 0, 0, 0, 100), mk('big', 50, 0, 0, 50, 200)];
    declutter(bars);
    expect(bars[1].minZoom).toBe(15);
    expect(bars[0].minZoom).toBeGreaterThan(15);
    expect(bars[0].minZoom).toBe(DECLUTTER_MAX_ZOOM);
  });

  it('breaks units ties by parcelId, then projectId', () => {
    const byParcel = [mk('x', 10, 0, 0, 0, 100, 'p2'), mk('y', 10, 0, 0, 0, 100, 'p1')];
    declutter(byParcel);
    expect(zoomsOf(byParcel)).toEqual([18, 15]);
    const byProject = [mk('y', 10, 0, 0, 0, 100, 'p'), mk('x', 10, 0, 0, 0, 100, 'p')];
    declutter(byProject);
    expect(zoomsOf(byProject)).toEqual([18, 15]);
  });

  it('shows a nearby project at the first rung that clears the larger one', () => {
    // 40 m apart: W(z)·mpp(z) is about 60 m at z15 and 23 m at z17, so the first clear rung is mid.
    const bars = [mk('big', 50, 0, 0), mk('small', 5, 40, 0)];
    declutter(bars);
    const lat = bars[1].anchor[1];
    const need = (z: number) => barSizePx(z).w * mpp(z, lat);
    const z = bars[1].minZoom;
    expect(z).toBeGreaterThan(15);
    expect(z).toBeLessThan(18);
    expect(need(z)).toBeLessThanOrEqual(40.1);
    expect(need(z - DECLUTTER_STEP)).toBeGreaterThan(39.9);
  });

  it('gives all revisions of a project one minZoom, from its whole interval', () => {
    const early = mk('p', 5, 0, 0, 0, 100);
    const late = mk('p', 5, 0, 0, 100, 300);
    const big = mk('big', 50, 0, 0, 250, 400);
    declutter([early, late, big]);
    // 'big' overlaps only p's late revision, but the project shares one zoom.
    expect(early.minZoom).toBe(late.minZoom);
    expect(early.minZoom).toBe(DECLUTTER_MAX_ZOOM);
    expect(big.minZoom).toBe(15);
  });

  it('uses the final revision anchor for the project', () => {
    const near = mk('p', 5, 0, 0, 0, 100);
    const far = mk('p', 5, 500, 0, 100, 300);
    const big = mk('big', 50, 0, 0, 0, 300);
    declutter([near, far, big]);
    expect(near.minZoom).toBe(15);
    expect(far.minZoom).toBe(15);
  });

  it('handles an empty list', () => {
    const bars: BarAttrs[] = [];
    declutter(bars);
    expect(bars).toEqual([]);
  });

  it('keeps every overlapping, co-visible pair apart (property)', () => {
    const arb = fc.array(
      fc.record({
        units: fc.integer({ min: 1, max: 20 }),
        dx: fc.double({ min: 0, max: 300, noNaN: true }),
        dy: fc.double({ min: 0, max: 300, noNaN: true }),
        from: fc.integer({ min: 0, max: 100 }),
        len: fc.integer({ min: 1, max: 100 })
      }),
      { minLength: 2, maxLength: 60 }
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const bars = rows.map((r, i) => mk(`p${i}`, r.units, r.dx, r.dy, r.from, r.from + r.len));
        declutter(bars);
        for (let i = 0; i < bars.length; i++) {
          for (let j = i + 1; j < bars.length; j++) {
            const a = bars[i];
            const b = bars[j];
            if (!(a.from < b.to && b.from < a.to)) continue;
            // The lower-priority bar's latitude sets the distance and mpp.
            const aFirst = a.units !== b.units ? a.units > b.units : a.projectId < b.projectId;
            const lo = aFirst ? b : a;
            const mx = (a.anchor[0] - b.anchor[0]) * Math.cos((lo.anchor[1] * Math.PI) / 180);
            const my = a.anchor[1] - b.anchor[1];
            const dist = Math.hypot(mx, my) * (M_PER_DEG_LAT * 1.0002);
            const from = Math.max(a.minZoom, b.minZoom);
            for (const z of LADDER) {
              if (z >= DECLUTTER_MAX_ZOOM || z < from) continue;
              expect(dist).toBeGreaterThanOrEqual(barSizePx(z).w * mpp(z, lo.anchor[1]) * 0.99);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('declutters 30,000 bars across the SF bbox in 50 ms', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const make = () => {
      const bars: BarAttrs[] = [];
      for (let i = 0; i < 30000; i++) {
        const from = Math.floor(rnd() * 8000);
        const b = mk(`p${i}`, 1 + Math.floor(rnd() * 400), 0, 0, from, from + 500 + rnd() * 3000);
        b.anchor = [-122.515 + rnd() * 0.17, 37.708 + rnd() * 0.12, 20];
        bars.push(b);
      }
      return bars;
    };
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const bars = make();
      const t0 = performance.now();
      declutter(bars);
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThanOrEqual(50);
  });
});
