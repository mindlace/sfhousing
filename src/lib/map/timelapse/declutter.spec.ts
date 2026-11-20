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
import {
  BAR_FAR_MAX_PIECES,
  FAR_UNITS_PER_SLICE,
  FarDeclutter,
  declutter,
  declutterPx,
  mpp
} from './declutter';
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

  /** The far record of `id` in force on `day`. */
  const at = (recs: BarAttrs[], id: string, day: number) =>
    recs.find((b) => b.projectId === id && b.from <= day && day < b.to);

  /**
   * Every pair of far records shown together on `day` at every ladder zoom is at least the
   * gapped box apart on the flat (pitch 0) screen.
   */
  function expectApartOn(recs: BarAttrs[], day: number) {
    const live = recs.filter((b) => b.from <= day && day < b.to);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const from = Math.max(a.minZoom, b.minZoom);
        for (let z = BAR_FAR_MIN_ZOOM; z < DECLUTTER_MAX_ZOOM; z += DECLUTTER_STEP) {
          if (z < from) continue;
          const [ax, ay] = mercPx(a.anchor[0], a.anchor[1], z);
          const [bx, by] = mercPx(b.anchor[0], b.anchor[1], z);
          const overlap =
            Math.abs(ax - bx) < BAR_FAR_PX.w + BAR_FAR_GAP_PX - 0.5 &&
            Math.abs(ay - by) < BAR_FAR_PX.h + BAR_FAR_GAP_PX - 0.5;
          expect(overlap, `day ${day} z${z} ${a.projectId}/${b.projectId}`).toBe(false);
        }
      }
    }
  }

  it('far: two projects 300 m apart both show by zoom 14, one hidden at 12', () => {
    const recs = declutter([mk('big', 50, 0, 0), mk('small', 5, 300, 0)], 'far');
    expect(at(recs, 'big', 10)!.minZoom).toBe(BAR_FAR_MIN_ZOOM);
    const small = at(recs, 'small', 10)!.minZoom;
    expect(small).toBeGreaterThan(12);
    expect(small).toBeLessThanOrEqual(14);
    // Alone, a project shows from 12, in one record over its whole window.
    const alone = declutter([mk('a', 5, 0, 0, 3, 90)], 'far');
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ from: 3, to: 90, minZoom: 12 });
  });

  it('far: a bar held back by a winner shows at the far gate from the day the winner ends', () => {
    const big = mk('big', 50, 0, 0, 0, 100);
    const small = mk('small', 5, 20, 0, 50, 300);
    const recs = declutter([big, small], 'far');
    // Pieces tile the bar's own window, [from, to).
    const pieces = recs.filter((b) => b.projectId === 'small').sort((a, b) => a.from - b.from);
    expect(pieces.map((b) => [b.from, b.to])).toEqual([
      [50, 100],
      [100, 300]
    ]);
    expect(pieces[0].minZoom).toBeGreaterThan(12);
    expect(pieces[1].minZoom).toBe(12);
    // The gate is all that evalBar reads of a piece beyond its window: hidden at zoom 13 on day
    // 99 (the piece's gate), shown from day 100, gone at the bar's end.
    const shown = (day: number) =>
      recs.filter((b) => b.projectId === 'small' && b.from <= day && day < b.to && b.minZoom <= 13)
        .length;
    expect(shown(99)).toBe(0);
    expect(shown(100)).toBe(1);
    expect(shown(299)).toBe(1);
    expect(shown(300)).toBe(0);
    // The input is untouched; street gates stay whole-life, in place.
    expect(small.minZoom).toBe(BAR_MIN_ZOOM);
    const street = [mk('big', 50, 0, 0, 0, 100), mk('small', 5, 20, 0, 50, 300)];
    expect(declutter(street)).toBe(street);
    expect(street[1].minZoom).toBeGreaterThan(15);
  });

  it('far: at most four records a bar; a merge takes the higher gate', () => {
    // Five short winners in turn over the loser's window, each ending before the next starts.
    const winners = [0, 1, 2, 3, 4].map((i) => mk(`w${i}`, 50, 0, 0, 100 * i + 10, 100 * i + 50));
    const loser = mk('loser', 5, 10, 0, 0, 500);
    const recs = declutter([...winners, loser], 'far');
    const pieces = recs.filter((b) => b.projectId === 'loser').sort((a, b) => a.from - b.from);
    expect(pieces.length).toBeLessThanOrEqual(BAR_FAR_MAX_PIECES);
    expect(pieces[0].from).toBe(0);
    expect(pieces.at(-1)!.to).toBe(500);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].from).toBe(pieces[i - 1].to);
    // Wherever a winner is in time, the loser's piece there is gated above the far gate.
    for (const w of winners)
      for (let d = w.from; d < w.to; d += 5)
        expect(at(recs, 'loser', d)!.minZoom, `day ${d}`).toBeGreaterThan(12);
    // Some gap between winners still shows the loser at the far gate.
    expect(pieces.some((b) => b.minZoom === 12)).toBe(true);
    for (const d of [0, 9, 10, 49, 50, 120, 230, 499]) expectApartOn(recs, d);
  });

  it('a flagged project wins a collision over a larger unflagged one', () => {
    for (const mode of ['street', 'far'] as const) {
      const recs = declutter(
        [mk('big', 500, 0, 0), { ...mk('mine', 5, 5, 0), policy: true }],
        mode
      );
      const gate = mode === 'far' ? BAR_FAR_MIN_ZOOM : BAR_MIN_ZOOM;
      expect(at(recs, 'mine', 10)!.minZoom, mode).toBe(gate);
      expect(at(recs, 'big', 10)!.minZoom, mode).toBeGreaterThan(gate);
      // Two flagged projects: the larger first, as without flags.
      const both = declutter(
        [
          { ...mk('big', 500, 0, 0), policy: true },
          { ...mk('mine', 5, 5, 0), policy: true }
        ],
        mode
      );
      expect(at(both, 'big', 10)!.minZoom, mode).toBe(gate);
      expect(at(both, 'mine', 10)!.minZoom, mode).toBeGreaterThan(gate);
    }
  });

  it('far: is deterministic and independent of input order', () => {
    const make = () => [
      mk('a', 10, 0, 0, 0, 100),
      mk('b', 10, 30, 0, 50, 200),
      mk('c', 30, 60, 10, 20, 120),
      mk('d', 5, 10, 40, 0, 400)
    ];
    const key = (r: BarAttrs[]) =>
      r.map((b) => `${b.projectId}:${b.from}-${b.to}@${b.minZoom}`).sort();
    const one = declutter(make(), 'far');
    expect(key(declutter(make(), 'far'))).toEqual(key(one));
    expect(key(declutter(make().reverse(), 'far'))).toEqual(key(one));
  });

  it('far: on every day, records shown together keep a gapped box apart (property)', () => {
    const arb = fc.array(
      fc.record({
        units: fc.integer({ min: 1, max: 20 }),
        policy: fc.boolean(),
        dx: fc.double({ min: 0, max: 2000, noNaN: true }),
        dy: fc.double({ min: 0, max: 2000, noNaN: true }),
        from: fc.integer({ min: 0, max: 100 }),
        len: fc.integer({ min: 1, max: 100 }),
        // 0 open, 1 complete, 2 exit; the end day as an offset from `from` (may fall outside).
        endKind: fc.constantFrom(0, 1, 2),
        endAt: fc.integer({ min: -10, max: 110 })
      }),
      { minLength: 2, maxLength: 60 }
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const bars = rows.map((r, i) => {
          const b = {
            ...mk(`p${i}`, r.units, r.dx, r.dy, r.from, r.from + r.len),
            policy: r.policy
          };
          if (r.endKind === 0) return b;
          const end = r.from + r.endAt;
          return {
            ...b,
            endKind: r.endKind,
            endDay: end,
            completeDay: r.endKind === 1 ? end : OPEN_DAY
          };
        });
        const recs = declutter(bars, 'far');
        // Each bar's records tile its window: at most four for its live part, four for its tail.
        for (const b of bars) {
          const ps = recs
            .filter((r) => r.projectId === b.projectId)
            .sort((x, y) => x.from - y.from);
          expect(ps.length).toBeLessThanOrEqual(2 * BAR_FAR_MAX_PIECES);
          expect(ps[0].from).toBe(b.from);
          expect(ps.at(-1)!.to).toBe(b.to);
          for (let i = 1; i < ps.length; i++) expect(ps[i].from).toBe(ps[i - 1].to);
        }
        // Every day a record starts or ends, and the day before: what shows changes only there.
        const days = new Set<number>();
        for (const r of recs) for (const d of [r.from, r.from - 1, r.to, r.to - 1]) days.add(d);
        for (const d of days) expectApartOn(recs, d);
      }),
      { numRuns: 100 }
    );
  });

  it("far: a finished bar's hold and fade never hold back a bar still in progress", () => {
    // A big project completes on day 100; its bar holds and fades to day 280. A small one 20 m
    // away is live from 50 to 400.
    const big = {
      ...mk('big', 500, 0, 0, 0, 280),
      endKind: 1,
      endDay: 100,
      completeDay: 100
    };
    const small = mk('small', 5, 20, 0, 50, 400);
    const recs = declutter([big, small], 'far');
    // While both are live (50 to 100) the big one wins; from 100 the small one shows at the far
    // gate and the big one's tail is the one held back.
    expect(at(recs, 'big', 60)!.minZoom).toBe(BAR_FAR_MIN_ZOOM);
    expect(at(recs, 'small', 60)!.minZoom).toBeGreaterThan(BAR_FAR_MIN_ZOOM);
    for (const d of [100, 150, 279]) {
      expect(at(recs, 'small', d)!.minZoom, `day ${d}`).toBe(BAR_FAR_MIN_ZOOM);
      expect(at(recs, 'big', d)!.minZoom, `day ${d}`).toBeGreaterThan(BAR_FAR_MIN_ZOOM);
    }
    // The big bar's records still tile its window: live [0, 100), tail [100, 280).
    const bigs = recs.filter((b) => b.projectId === 'big').sort((a, b) => a.from - b.from);
    expect(bigs[0].from).toBe(0);
    expect(bigs.at(-1)!.to).toBe(280);
    expect(bigs.some((b) => b.from === 100)).toBe(true);
    // An exit's dying ghost is a tail too.
    const dead = { ...mk('dead', 500, 0, 0, 0, 370), endKind: 2, endDay: 100 };
    const live = mk('live', 5, 20, 0, 50, 400);
    const r2 = declutter([dead, live], 'far');
    expect(at(r2, 'live', 200)!.minZoom).toBe(BAR_FAR_MIN_ZOOM);
    expect(at(r2, 'dead', 200)!.minZoom).toBeGreaterThan(BAR_FAR_MIN_ZOOM);
    for (const d of [0, 60, 99, 100, 200, 369]) {
      expectApartOn(recs, d);
      expectApartOn(r2, d);
    }
  });

  it('far: sorted grid slots give exactly the records of the full scan (synthetic 5,000)', () => {
    const u = makeSyntheticTimeline(2, 5_000, 1500, false);
    const bars = buildBars(u.cells, SYNTHETIC_LOOKUPS);
    const run = (sortedSlots: boolean) => {
      const job = new FarDeclutter(bars, { sortedSlots });
      job.step(Infinity);
      return job.result();
    };
    const sorted = run(true);
    const full = run(false);
    expect(sorted.length).toBeGreaterThan(bars.length);
    expect(sorted.map((b) => [b.projectId, b.from, b.to, b.minZoom])).toEqual(
      full.map((b) => [b.projectId, b.from, b.to, b.minZoom])
    );
  });

  it('far: a resumable run visits at most its budget a step, and ends as one call does', () => {
    const u = makeSyntheticTimeline(3, 2_000, 1500, false);
    const bars = buildBars(u.cells, SYNTHETIC_LOOKUPS);
    const job = new FarDeclutter(bars);
    expect(job.units).toBeGreaterThan(FAR_UNITS_PER_SLICE);
    expect(() => job.result()).toThrow();
    let steps = 0;
    for (let before = job.visited; !job.step(FAR_UNITS_PER_SLICE); before = job.visited) {
      expect(job.visited - before).toBe(FAR_UNITS_PER_SLICE);
      steps++;
    }
    expect(steps + 1).toBe(Math.ceil(job.units / FAR_UNITS_PER_SLICE));
    const key = (r: BarAttrs[]) => r.map((b) => [b.projectId, b.from, b.to, b.minZoom]);
    expect(key(job.result())).toEqual(key(declutter(bars, 'far')));
  });

  it('far: the synthetic 30,000 at zoom 13 show no two bars within a gapped box', () => {
    // The default desktop view's ground bounds (plan, Measured: 1280x800, zoom 13, pitch 55).
    const [w, s, e, n] = [-122.5399, 37.7479, -122.3429, 37.851];
    const u = makeSyntheticTimeline(1, 30_000, 1500, false);
    const bars = buildBars(u.cells, SYNTHETIC_LOOKUPS);
    const recs = declutter(bars, 'far');
    // The record bound: at most four per bar.
    expect(recs.length).toBeLessThanOrEqual(BAR_FAR_MAX_PIECES * bars.length);
    const [x0, y0] = mercPx(w, n, 13);
    const [x1, y1] = mercPx(e, s, 13);
    // Disjoint boxes of (w + gap) by (h + gap) bound the count by the area they can tile.
    const bound = Math.ceil(
      ((x1 - x0 + BAR_FAR_PX.w + BAR_FAR_GAP_PX) * (y1 - y0 + BAR_FAR_PX.h + BAR_FAR_GAP_PX)) /
        ((BAR_FAR_PX.w + BAR_FAR_GAP_PX) * (BAR_FAR_PX.h + BAR_FAR_GAP_PX))
    );
    for (const day of [21_000, 22_000, 23_500, 25_000, 26_500, 28_000]) {
      const shown = recs
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
