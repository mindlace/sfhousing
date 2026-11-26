import { describe, expect, it } from 'vitest';
import { buildHalos, evalHalo, type HaloAttrs } from './halos';
import { packTimedCell, type TimedPackInput } from '../pack-timed';
import { SLOT_FLAG } from '../types';
import { cityGroup } from './city-grid';
import { MARK_AREA_ZOOM } from './constants';
import type { Schedule } from '$lib/sim/world/input/types';
import { DYING_DAYS, OPEN_DAY, type Day } from '$lib/timelapse/time';

/** Base day; stage days below are offsets from it. */
const B = 21000;
const C: [number, number] = [-122.42, 37.77];

/** A square footprint of half-side `h` degrees centred on `c`. */
function square(c: [number, number], h = 0.0001): { footprint: [number, number][] } {
  return {
    footprint: [
      [c[0] - h, c[1] - h],
      [c[0] + h, c[1] - h],
      [c[0] + h, c[1] + h],
      [c[0] - h, c[1] + h]
    ]
  };
}

function item(
  projectId: string,
  pathway: Schedule['pathway'],
  entered: Schedule['entered'],
  end: Schedule['end'],
  opts: { flags?: number; revs?: [Day, [number, number]][]; units?: number } = {}
): TimedPackInput {
  const revs = opts.revs ?? [[Math.min(...Object.values(entered)), C]];
  return {
    schedule: {
      projectId,
      origin: 'simulated',
      parcelIds: [`p-${projectId}`],
      pathway,
      entered,
      end,
      revisions: revs.map(([day]) => ({ day, units: opts.units ?? 10, stories: null })),
      existingUnits: 0,
      multiPhase: false,
      phase: null
    },
    massings: revs.map(([, c]) => square(c)),
    pickParcelId: `p-${projectId}`,
    flags: opts.flags
  };
}

const DISCRETIONARY = item(
  'disc',
  'discretionary',
  {
    filed: B + 100,
    entitled: B + 200,
    permitFiled: B + 300,
    permitIssued: B + 400,
    construction: B + 500
  },
  { kind: 'complete', day: B + 900 }
);
const PERMIT_ONLY = item(
  'perm',
  'permitOnly',
  { permitFiled: B + 100, permitIssued: B + 300, construction: B + 400 },
  { kind: 'open' }
);
const STOPPED = item(
  'stop',
  'discretionary',
  { preApplication: B + 50, filed: B + 100, entitled: B + 200, permitFiled: B + 300 },
  { kind: 'exit', stage: 'permitFiled', reason: 'withdrawn', day: B + 450 },
  { flags: SLOT_FLAG.zoning }
);

const brief = (hs: HaloAttrs[]) => hs.map((h) => [h.projectId, h.day, h.until]);

describe('buildHalos', () => {
  it('makes no record for an unflagged slot, at any stage', () => {
    expect(buildHalos([packTimedCell('c', [DISCRETIONARY, PERMIT_ONLY])], B)).toEqual([]);
  });

  it('a flagged slot gets one mark from its first stage day and nothing else', () => {
    const flagged = { ...DISCRETIONARY, flags: SLOT_FLAG.money };
    expect(buildHalos([packTimedCell('c', [flagged])], B)).toEqual([
      { projectId: 'disc', anchor: C, day: B + 100, until: OPEN_DAY, areaFrom: B + 100 }
    ]);
  });

  it('records leave out events on or before from', () => {
    const cell = packTimedCell('c', [{ ...DISCRETIONARY, flags: SLOT_FLAG.money }]);
    expect(buildHalos([cell], B + 99)).toHaveLength(1);
    expect(buildHalos([cell], B + 100)).toEqual([]);
  });

  it("a stopped slot's mark ends DYING_DAYS after its exit", () => {
    const cell = packTimedCell('c', [STOPPED]);
    expect(brief(buildHalos([cell], B))).toEqual([['stop', B + 50, B + 450 + DYING_DAYS]]);
  });

  it('keeps cell then slot order across cells', () => {
    const a = packTimedCell('a', [{ ...PERMIT_ONLY, flags: SLOT_FLAG.zoning }]);
    const b = packTimedCell('b', [{ ...DISCRETIONARY, flags: SLOT_FLAG.zoning }]);
    expect(buildHalos([b, a], B).map((h) => h.projectId)).toEqual(['disc', 'perm']);
  });

  it('anchors on the centre of the final revision', () => {
    const far: [number, number] = [C[0] + 0.01, C[1] + 0.005];
    const revised = item(
      'rev',
      'discretionary',
      { filed: B + 100, entitled: B + 200, construction: B + 500 },
      { kind: 'complete', day: B + 900 },
      {
        flags: SLOT_FLAG.zoning,
        revs: [
          [B + 100, C],
          [B + 300, far]
        ]
      }
    );
    const hs = buildHalos([packTimedCell('c', [revised])], B);
    expect(hs).toHaveLength(1);
    expect(hs[0].anchor[0]).toBeCloseTo(far[0], 10);
    expect(hs[0].anchor[1]).toBeCloseTo(far[1], 10);
  });

  it('a cell without slotFlags (an older producer) has no marks', () => {
    const cell = { ...packTimedCell('c', [STOPPED]), slotFlags: undefined };
    expect(buildHalos([cell], B)).toEqual([]);
  });
});

describe('evalHalo', () => {
  const m: HaloAttrs = {
    projectId: 'm',
    anchor: C,
    day: 1000,
    until: 2000,
    areaFrom: 1500
  };

  it('below zoom 14 only from areaFrom; from 14 from its day; never at or after until', () => {
    expect(evalHalo(m, m.day, 13.99)).toBe(false);
    expect(evalHalo(m, m.areaFrom - 1, 13.99)).toBe(false);
    expect(evalHalo(m, m.areaFrom, 13.99)).toBe(true);
    expect(evalHalo(m, m.day, MARK_AREA_ZOOM)).toBe(true);
    expect(evalHalo(m, m.day - 1, 18)).toBe(false);
    expect(evalHalo(m, m.until - 1, 18)).toBe(true);
    expect(evalHalo(m, m.until, 18)).toBe(false);
    expect(evalHalo(m, m.until, 0)).toBe(false);
  });

  it('the default zoom is no gate', () => {
    expect(evalHalo(m, m.day)).toBe(true);
    expect(evalHalo({ ...m, until: OPEN_DAY }, 29584)).toBe(true);
  });
});

/** A flagged slot at `at` whose first stage is `day` and that ends at `exit` (open if absent). */
function marked(
  id: string,
  at: [number, number],
  day: Day,
  units = 10,
  exit?: Day
): TimedPackInput {
  return item(
    id,
    'permitOnly',
    { permitFiled: day, permitIssued: day + 30 },
    exit === undefined
      ? { kind: 'open' }
      : { kind: 'exit', stage: 'permitIssued', reason: 'withdrawn', day: exit },
    { flags: SLOT_FLAG.zoning, units, revs: [[day, at]] }
  );
}
const near: [number, number] = [C[0] + 0.0005, C[1] + 0.0003];
const other: [number, number] = [C[0] + 0.02, C[1]];
const marksOf = (cells: TimedPackInput[]) => buildHalos([packTimedCell('c', cells)], B);
const areaOf = (hs: HaloAttrs[]) => Object.fromEntries(hs.map((h) => [h.projectId, h.areaFrom]));

describe('buildHalos: one mark per square below the handover', () => {
  it('the test points: C and near share a square, other is another', () => {
    expect(cityGroup(...near)).toBe(cityGroup(...C));
    expect(cityGroup(...other)).not.toBe(cityGroup(...C));
  });

  it('the earliest revealed mark stands for its square from its day; a later one never does while it stands', () => {
    const hs = marksOf([marked('late', near, B + 200), marked('early', C, B + 100)]);
    expect(areaOf(hs)).toEqual({ early: B + 100, late: OPEN_DAY });
    // Each mark keeps its own window and day: one record per mark.
    expect(hs.map((h) => [h.projectId, h.day, h.until]).sort()).toEqual([
      ['early', B + 100, OPEN_DAY],
      ['late', B + 200, OPEN_DAY]
    ]);
  });

  it('another square has its own', () => {
    const hs = marksOf([marked('a', C, B + 100), marked('b', other, B + 200)]);
    expect(areaOf(hs)).toEqual({ a: B + 100, b: B + 200 });
  });

  it('ties on the day go to more homes, then to the project id', () => {
    expect(
      areaOf(marksOf([marked('small', C, B + 100, 5), marked('big', near, B + 100, 50)]))
    ).toEqual({ small: OPEN_DAY, big: B + 100 });
    expect(areaOf(marksOf([marked('y', C, B + 100), marked('x', near, B + 100)]))).toEqual({
      x: B + 100,
      y: OPEN_DAY
    });
  });

  it('when the standing one ends, the square hands over to the earliest still standing', () => {
    const endA = B + 300 + DYING_DAYS; // a's until
    const hs = marksOf([
      marked('a', C, B + 100, 10, B + 300),
      marked('b', near, B + 200),
      marked('c', near, B + 150, 10, B + 250), // ends before a: never stands for the square
      marked('d', near, endA + 50)
    ]);
    expect(areaOf(hs)).toEqual({ a: B + 100, b: endA, c: B + 250 + DYING_DAYS, d: OPEN_DAY });
  });

  it('with a gap, the next mark to be revealed stands for the square from its day', () => {
    const endA = B + 300 + DYING_DAYS;
    const hs = marksOf([marked('a', C, B + 100, 10, B + 300), marked('b', near, endA + 40)]);
    expect(areaOf(hs)).toEqual({ a: B + 100, b: endA + 40 });
  });

  it('below the handover a square shows exactly one diamond while one of its marks stands; from it, every one', () => {
    // A square's worth of marks with exits and ties, and a second square.
    const cells = [
      marked('m0', C, B + 100, 10, B + 400),
      marked('m1', near, B + 100, 20, B + 200),
      marked('m2', near, B + 180),
      marked('m3', near, B + 500, 10, B + 600),
      marked('m4', near, B + 2000, 10, B + 2100),
      marked('o0', other, B + 300, 10, B + 350),
      marked('o1', other, B + 3000)
    ];
    const hs = marksOf(cells);
    expect(hs).toHaveLength(cells.length);
    const squares = new Map<number, HaloAttrs[]>();
    for (const h of hs) {
      const g = cityGroup(...h.anchor);
      squares.set(g, [...(squares.get(g) ?? []), h]);
    }
    for (let t = B; t < B + 4000; t += 5)
      for (const group of squares.values()) {
        const standing = group.filter((h) => h.day <= t && t < h.until).length;
        const shown = (z: number) => group.filter((h) => evalHalo(h, t, z)).length;
        expect(shown(13)).toBe(standing > 0 ? 1 : 0);
        expect(shown(MARK_AREA_ZOOM)).toBe(standing);
      }
  });
});
