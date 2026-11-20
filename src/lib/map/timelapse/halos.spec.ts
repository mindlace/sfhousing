import { describe, expect, it } from 'vitest';
import { HALO_KIND, buildHalos, evalHalo, type HaloAttrs } from './halos';
import { HALO_DAYS, HALO_R_PX, HALO_STILL_R_PX, MARK_PX } from './constants';
import { packTimedCell, type TimedPackInput } from '../pack-timed';
import { SLOT_FLAG } from '../types';
import type { Schedule } from '$lib/sim/scenario/types';
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
  opts: { flags?: number; revs?: [Day, [number, number]][] } = {}
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
      revisions: revs.map(([day]) => ({ day, units: 10, stories: null })),
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

const brief = (hs: HaloAttrs[]) => hs.map((h) => [h.projectId, h.kind, h.day, h.until, h.policy]);

describe('buildHalos', () => {
  it('a discretionary slot rings at entitled, construction and completion, after from only', () => {
    const cell = packTimedCell('c', [DISCRETIONARY]);
    expect(brief(buildHalos([cell], B))).toEqual([
      ['disc', HALO_KIND.approved, B + 200, B + 200 + HALO_DAYS, false],
      ['disc', HALO_KIND.started, B + 500, B + 500 + HALO_DAYS, false],
      ['disc', HALO_KIND.completed, B + 900, B + 900 + HALO_DAYS, false]
    ]);
    expect(buildHalos([cell], B + 300).map((h) => h.kind)).toEqual([
      HALO_KIND.started,
      HALO_KIND.completed
    ]);
  });

  it('records leave out events on or before from', () => {
    const cell = packTimedCell('c', [DISCRETIONARY]);
    expect(buildHalos([cell], B + 500).map((h) => h.kind)).toEqual([HALO_KIND.completed]);
    expect(buildHalos([cell], B + 900)).toEqual([]);
  });

  it('a permit-only slot rings approved at permitIssued', () => {
    const cell = packTimedCell('c', [PERMIT_ONLY]);
    expect(brief(buildHalos([cell], B))).toEqual([
      ['perm', HALO_KIND.approved, B + 300, B + 300 + HALO_DAYS, false],
      ['perm', HALO_KIND.started, B + 400, B + 400 + HALO_DAYS, false]
    ]);
  });

  it('a discretionary slot that skipped entitled rings approved at permitIssued', () => {
    const skipped = item(
      'skip',
      'discretionary',
      { filed: B + 100, permitFiled: B + 200, permitIssued: B + 350 },
      { kind: 'open' }
    );
    const hs = buildHalos([packTimedCell('c', [skipped])], B);
    expect(brief(hs)).toEqual([['skip', HALO_KIND.approved, B + 350, B + 350 + HALO_DAYS, false]]);
  });

  it('a stopped slot rings only the events it reached; its mark ends DYING_DAYS after the exit', () => {
    const cell = packTimedCell('c', [STOPPED]);
    expect(brief(buildHalos([cell], B))).toEqual([
      ['stop', HALO_KIND.approved, B + 200, B + 200 + HALO_DAYS, true],
      ['stop', HALO_KIND.mark, B + 50, B + 450 + DYING_DAYS, true]
    ]);
  });

  it('a flagged slot gets one mark from its first stage day, policy true on its rings too', () => {
    const flagged = { ...DISCRETIONARY, flags: SLOT_FLAG.money };
    const cell = packTimedCell('c', [flagged, PERMIT_ONLY]);
    const hs = buildHalos([cell], B);
    expect(brief(hs)).toEqual([
      ['disc', HALO_KIND.approved, B + 200, B + 200 + HALO_DAYS, true],
      ['disc', HALO_KIND.started, B + 500, B + 500 + HALO_DAYS, true],
      ['disc', HALO_KIND.completed, B + 900, B + 900 + HALO_DAYS, true],
      ['disc', HALO_KIND.mark, B + 100, OPEN_DAY, true],
      ['perm', HALO_KIND.approved, B + 300, B + 300 + HALO_DAYS, false],
      ['perm', HALO_KIND.started, B + 400, B + 400 + HALO_DAYS, false]
    ]);
    // A flagged slot whose first stage is on or before `from` gets no mark.
    expect(buildHalos([cell], B + 100).some((h) => h.kind === HALO_KIND.mark)).toBe(false);
  });

  it('keeps cell then slot order across cells', () => {
    const a = packTimedCell('a', [PERMIT_ONLY]);
    const b = packTimedCell('b', [DISCRETIONARY]);
    expect(buildHalos([b, a], B).map((h) => h.projectId)).toEqual([
      'disc',
      'disc',
      'disc',
      'perm',
      'perm'
    ]);
  });

  it('anchors on the centre of the final revision, the same for every record of the slot', () => {
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
    expect(hs).toHaveLength(4);
    for (const h of hs) {
      expect(h.anchor).toHaveLength(2);
      expect(h.anchor[0]).toBeCloseTo(far[0], 10);
      expect(h.anchor[1]).toBeCloseTo(far[1], 10);
      expect(h.anchor).toEqual(hs[0].anchor);
    }
  });

  it('a cell without slotFlags (an older producer) has no policy and no marks', () => {
    const cell = { ...packTimedCell('c', [STOPPED]), slotFlags: undefined };
    const hs = buildHalos([cell], B);
    expect(hs.map((h) => h.policy)).toEqual([false]);
  });
});

describe('evalHalo', () => {
  const ring: HaloAttrs = {
    projectId: 'r',
    anchor: C,
    day: 1000,
    until: 1000 + HALO_DAYS,
    kind: HALO_KIND.started,
    policy: false
  };
  const [R0, R1] = HALO_R_PX;

  it('evalHalo: visible only for 0 <= age < HALO_DAYS; radius grows and alpha falls linearly', () => {
    expect(evalHalo(ring, 999, false)).toEqual({ visible: false, radiusPx: 0, alpha: 0 });
    expect(evalHalo(ring, 1000, false)).toEqual({ visible: true, radiusPx: R0, alpha: 1 });
    expect(evalHalo(ring, 1000 + HALO_DAYS / 2, false)).toEqual({
      visible: true,
      radiusPx: (R0 + R1) / 2,
      alpha: 0.5
    });
    const late = evalHalo(ring, 1000 + HALO_DAYS - 1, false);
    expect(late.visible).toBe(true);
    expect(late.radiusPx).toBeCloseTo(R0 + ((R1 - R0) * (HALO_DAYS - 1)) / HALO_DAYS, 10);
    expect(late.alpha).toBeCloseTo(1 / HALO_DAYS, 10);
    expect(evalHalo(ring, 1000 + HALO_DAYS, false).visible).toBe(false);
  });

  it('evalHalo reduced: HALO_STILL_R_PX and alpha 1 through the same window', () => {
    for (const t of [1000, 1365, 1000 + HALO_DAYS - 1])
      expect(evalHalo(ring, t, true)).toEqual({
        visible: true,
        radiusPx: HALO_STILL_R_PX,
        alpha: 1
      });
    expect(evalHalo(ring, 999, true).visible).toBe(false);
    expect(evalHalo(ring, 1000 + HALO_DAYS, true).visible).toBe(false);
  });

  it('evalHalo: a mark shows from its day to until at MARK_PX', () => {
    const mark: HaloAttrs = { ...ring, kind: HALO_KIND.mark, until: 2000, policy: true };
    expect(evalHalo(mark, 999, false).visible).toBe(false);
    for (const reduced of [false, true]) {
      expect(evalHalo(mark, 1000, reduced)).toEqual({ visible: true, radiusPx: MARK_PX, alpha: 1 });
      expect(evalHalo(mark, 1999, reduced)).toEqual({ visible: true, radiusPx: MARK_PX, alpha: 1 });
    }
    expect(evalHalo(mark, 2000, false).visible).toBe(false);
    const open = { ...mark, until: OPEN_DAY };
    expect(evalHalo(open, 29584, false).visible).toBe(true);
  });

  it('evalHalo: below ringMinZoom a ring and a mark are hidden; from it both show', () => {
    const mark: HaloAttrs = { ...ring, kind: HALO_KIND.mark, until: 2000, policy: true };
    for (const reduced of [false, true]) {
      expect(evalHalo(ring, 1000, reduced, 12, 14).visible).toBe(false);
      expect(evalHalo(ring, 1000, reduced, 15, 14).visible).toBe(true);
      expect(evalHalo(mark, 1000, reduced, 12, 14).visible).toBe(false);
      expect(evalHalo(mark, 1000, reduced, 13.99, 14).visible).toBe(false);
      expect(evalHalo(mark, 1000, reduced, 14, 14)).toEqual({
        visible: true,
        radiusPx: MARK_PX,
        alpha: 1
      });
    }
    // The defaults gate nothing: every page without the city layer is unchanged.
    expect(evalHalo(ring, 1000, false)).toEqual(evalHalo(ring, 1000, false, 11, 0));
    expect(evalHalo(ring, 1000, false, 11).visible).toBe(true);
    expect(evalHalo(mark, 1000, false, 11, 0).visible).toBe(true);
    // The gate never shows a ring outside its window.
    expect(evalHalo(ring, 999, false, 16, 14).visible).toBe(false);
  });

  it('evalHalo at 13.99 and 14.0 with ringMinZoom 14: hidden, then shown', () => {
    expect(evalHalo(ring, 1000, false, 13.99, 14).visible).toBe(false);
    expect(evalHalo(ring, 1000, false, 14, 14)).toEqual({ visible: true, radiusPx: R0, alpha: 1 });
  });
});
