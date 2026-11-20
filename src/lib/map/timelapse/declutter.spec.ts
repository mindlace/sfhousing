import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { barSizePx, buildBars, evalBar } from './bars';
import {
  BAR_FAR_GAP_PX,
  BAR_FAR_MIN_ZOOM,
  BAR_FAR_PX,
  BAR_MIN_ZOOM,
  DECLUTTER_MAX_ZOOM,
  DECLUTTER_STEP
} from './constants';
import { declutter, declutterPx, mpp } from './declutter';
import type { BarAttrs } from './types';
import { OPEN_DAY } from '$lib/timelapse/time';
import { SYNTHETIC_LOOKUPS, makeSyntheticTimeline } from '../test/synthetic-timeline';

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
    minZoom: BAR_MIN_ZOOM,
    policy: false
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
});

/** Web Mercator px (512 px tiles) of a lng/lat at zoom `z`: the flat screen at pitch 0. */
function mercPx(lng: number, lat: number, z: number): [number, number] {
  const world = 512 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [(world * (lng + 180)) / 360, world * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))];
}

describe('declutter modes', () => {
  it('declutterPx: street is the bar width; far is the 32 by 6 box with its gap, at every zoom', () => {
    for (const z of [15, 16, 17, 18]) expect(declutterPx(z, 'street')).toBe(barSizePx(z).w);
    const far = Math.hypot(BAR_FAR_PX.w + BAR_FAR_GAP_PX, BAR_FAR_PX.h + BAR_FAR_GAP_PX);
    for (const z of [12, 13, 15, 18]) expect(declutterPx(z, 'far')).toBe(far);
  });

  it("street mode without flags keeps today's gates exactly", () => {
    // Recorded on b65c0c14, before bar modes: 80 bars of 70 projects in a 350 m square.
    const make = () => {
      let seed = 7;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const bars: BarAttrs[] = [];
      for (let i = 0; i < 80; i++) {
        const from = Math.floor(rnd() * 400);
        const b = mk(`p${i % 70}`, 0, 0, 0, from, 0, `l${Math.floor(rnd() * 50)}`);
        b.units = 1 + Math.floor(rnd() * 8);
        b.anchor = [-122.44 + rnd() * 0.004, 37.75 + rnd() * 0.003, 20];
        b.to = from + 50 + Math.floor(rnd() * 300);
        bars.push(b);
      }
      return bars;
    };
    const recorded = [
      15, 16.5, 16, 15.5, 16.5, 16.5, 17.5, 16.5, 17, 16.5, 18, 15, 17.5, 16, 17.5, 15.5, 16, 16,
      17.5, 18, 15, 15, 15, 17.5, 15, 17, 15, 17, 18, 17.5, 17, 17, 17.5, 16.5, 18, 16, 18, 15, 15,
      15, 15, 18, 15, 17.5, 16.5, 16, 17, 17.5, 15, 15, 15, 16.5, 15, 18, 15.5, 15, 16, 16.5, 16.5,
      16, 15, 15, 18, 15.5, 17, 16, 15.5, 15, 15, 15, 15, 16.5, 16, 15.5, 16.5, 16.5, 17.5, 16.5,
      17, 16.5
    ];
    const byDefault = make();
    declutter(byDefault);
    expect(zoomsOf(byDefault)).toEqual(recorded);
    const street = make();
    declutter(street, 'street');
    expect(zoomsOf(street)).toEqual(recorded);
  });

  it('far: two projects 300 m apart both show by zoom 14, one hidden at 12', () => {
    const bars = [mk('big', 50, 0, 0), mk('small', 5, 300, 0)];
    declutter(bars, 'far');
    expect(bars[0].minZoom).toBe(BAR_FAR_MIN_ZOOM);
    expect(bars[1].minZoom).toBeGreaterThan(12);
    expect(bars[1].minZoom).toBeLessThanOrEqual(14);
    // Alone, a project shows from 12.
    const alone = [mk('a', 5, 0, 0)];
    declutter(alone, 'far');
    expect(alone[0].minZoom).toBe(12);
  });

  it('a flagged project wins a collision over a larger unflagged one', () => {
    for (const mode of ['street', 'far'] as const) {
      const bars = [mk('big', 500, 0, 0), { ...mk('mine', 5, 5, 0), policy: true }];
      declutter(bars, mode);
      const gate = mode === 'far' ? BAR_FAR_MIN_ZOOM : BAR_MIN_ZOOM;
      expect(bars[1].minZoom, mode).toBe(gate);
      expect(bars[0].minZoom, mode).toBeGreaterThan(gate);
      // Two flagged projects: the larger first, as without flags.
      const both = [
        { ...mk('big', 500, 0, 0), policy: true },
        { ...mk('mine', 5, 5, 0), policy: true }
      ];
      declutter(both, mode);
      expect(both[0].minZoom, mode).toBe(gate);
      expect(both[1].minZoom, mode).toBeGreaterThan(gate);
    }
  });

  it('far: keeps every co-visible pair a gapped box apart (property)', () => {
    const arb = fc.array(
      fc.record({
        units: fc.integer({ min: 1, max: 20 }),
        policy: fc.boolean(),
        dx: fc.double({ min: 0, max: 2000, noNaN: true }),
        dy: fc.double({ min: 0, max: 2000, noNaN: true }),
        from: fc.integer({ min: 0, max: 100 }),
        len: fc.integer({ min: 1, max: 100 })
      }),
      { minLength: 2, maxLength: 60 }
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const bars = rows.map((r, i) => ({
          ...mk(`p${i}`, r.units, r.dx, r.dy, r.from, r.from + r.len),
          policy: r.policy
        }));
        declutter(bars, 'far');
        for (let i = 0; i < bars.length; i++) {
          for (let j = i + 1; j < bars.length; j++) {
            const a = bars[i];
            const b = bars[j];
            if (!(a.from < b.to && b.from < a.to)) continue;
            const from = Math.max(a.minZoom, b.minZoom);
            for (let z = BAR_FAR_MIN_ZOOM; z < DECLUTTER_MAX_ZOOM; z += DECLUTTER_STEP) {
              if (z < from) continue;
              const [ax, ay] = mercPx(a.anchor[0], a.anchor[1], z);
              const [bx, by] = mercPx(b.anchor[0], b.anchor[1], z);
              const overlap =
                Math.abs(ax - bx) < BAR_FAR_PX.w + BAR_FAR_GAP_PX - 0.5 &&
                Math.abs(ay - by) < BAR_FAR_PX.h + BAR_FAR_GAP_PX - 0.5;
              expect(overlap).toBe(false);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('far: the synthetic 30,000 at zoom 13 show no two bars within a gapped box', () => {
    // The default desktop view's ground bounds (plan, Measured: 1280x800, zoom 13, pitch 55).
    const [w, s, e, n] = [-122.5399, 37.7479, -122.3429, 37.851];
    const u = makeSyntheticTimeline(1, 30_000, 1500, false);
    const bars = buildBars(u.cells, SYNTHETIC_LOOKUPS);
    declutter(bars, 'far');
    const [x0, y0] = mercPx(w, n, 13);
    const [x1, y1] = mercPx(e, s, 13);
    // Disjoint boxes of (w + gap) by (h + gap) bound the count by the area they can tile.
    const bound = Math.ceil(
      ((x1 - x0 + BAR_FAR_PX.w + BAR_FAR_GAP_PX) * (y1 - y0 + BAR_FAR_PX.h + BAR_FAR_GAP_PX)) /
        ((BAR_FAR_PX.w + BAR_FAR_GAP_PX) * (BAR_FAR_PX.h + BAR_FAR_GAP_PX))
    );
    for (const day of [22_000, 25_000, 28_000]) {
      const shown = bars
        .filter((b) => {
          const [lng, lat] = b.anchor;
          if (lng < w || lng > e || lat < s || lat > n) return false;
          return evalBar(b, SYNTHETIC_LOOKUPS, day, 13, 'far').visible;
        })
        .map((b) => mercPx(b.anchor[0], b.anchor[1], 13))
        .sort((a, b) => a[0] - b[0]);
      expect(shown.length, `day ${day}`).toBeGreaterThan(0);
      expect(shown.length, `day ${day}`).toBeLessThanOrEqual(bound);
      // Sweep by x: only neighbours within one gapped width can collide.
      for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
          const dx = shown[j][0] - shown[i][0];
          if (dx >= BAR_FAR_PX.w + BAR_FAR_GAP_PX - 0.5) break;
          const dy = Math.abs(shown[j][1] - shown[i][1]);
          expect(dy, `day ${day}`).toBeGreaterThanOrEqual(BAR_FAR_PX.h + BAR_FAR_GAP_PX - 0.5);
        }
      }
    }
  });
});
