// The T6 ProjectCard and the day-based project choice (spec §4.9, §6 `card.spec.ts`, AC 10).
import { describe, expect, it, vi } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { generate, generateForUnits, massedUnits, massingApproximate } from '$lib/generator';
import type { GeneratedBuilding } from '$lib/generator';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import { DYING_DAYS, type Day } from '$lib/timelapse/time';
import type { Calibration } from '$lib/timelapse/types';
import { createLru } from '../lru';
import { blockLot, chooseProject, firstDay, isVisible, projectCard, type CardCtx } from './card';
import { dayOf } from './dates';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity, MINI_LP_ID } from './fixtures/mini-parcels';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import { buildSimInput } from './input';
import { massingFor, type MassingCtx } from './massing';
import { simulateDetailed, type Master } from './simulate';
import type { Massing, Schedule, SimInput } from './types';

const AS_OF = MINI_AS_OF;
const P = MINI_PROJECTS;
const d = dayOf;

const city = miniCity();
const file = parseProjectsFile(miniProjectsJson(), { onInvalid() {} });
const input: SimInput = buildSimInput({
  parcels: city.parcels,
  projects: file,
  calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown) as Calibration
});
const qualityRules = new Map(file.qualityRules.map((r) => [r.id, r]));

const FOOT: Massing = {
  footprint: [
    [0, 0],
    [1, 0],
    [1, 1]
  ]
};

/** A hand-made building. `floorAreaM2` sets `massedUnits`; `units` is what the record asked for. */
function bld(over: Partial<GeneratedBuilding> = {}): GeneratedBuilding {
  return {
    parcelId: '0026T003',
    source: 'pipeline',
    typology: 'midrise',
    composition: 'slab' as GeneratedBuilding['composition'],
    parts: [],
    stories: 5,
    units: 40,
    floorAreaM2: 3000,
    replacesExisting: false,
    ...over
  };
}
/** A building whose own massing carries exactly its `units`. */
function matched(over: Partial<GeneratedBuilding> = {}): GeneratedBuilding {
  const b = bld(over);
  return { ...b, units: massedUnits(b) };
}

function mkCtx(over: Partial<CardCtx> = {}) {
  const logged: string[] = [];
  const seen = new Set<string>();
  const ctx: CardCtx = {
    asOf: AS_OF,
    input,
    rows: new Map(structuredClone(input.projects).map((p) => [p.id, p])),
    masters: new Map(),
    qualityRules,
    building: () => FOOT,
    logOnce(key, msg) {
      if (seen.has(key)) return;
      seen.add(key);
      logged.push(msg);
    },
    ...over
  };
  return { ctx, logged };
}

function sched(over: Partial<Schedule> & Pick<Schedule, 'projectId'>): Schedule {
  return {
    origin: 'pipeline',
    parcelIds: ['2999A005'],
    pathway: 'discretionary',
    entered: { filed: d(2021, 3, 1), entitled: d(2021, 12, 1) },
    end: { kind: 'open' },
    revisions: [{ day: d(2021, 3, 1), units: 60, stories: 8 }],
    existingUnits: 3,
    multiPhase: false,
    phase: null,
    ...over
  };
}

/** The construction row (label, tier-0 stories 8, forward-clamp quality, a `key` source). */
const construction = (over: Partial<Schedule> = {}) =>
  sched({ projectId: P.construction, ...over });

describe('blockLot', () => {
  it('splits the three real shapes', () => {
    expect(blockLot('0026T001A')).toBe('Block 0026T, Lot 001A');
    expect(blockLot('2999A019')).toBe('Block 2999A, Lot 019');
    expect(blockLot('3512008')).toBe('Block 3512, Lot 008');
  });

  it('takes a following letter only when the fifth character is a letter', () => {
    expect(blockLot('8711023C')).toBe('Block 8711, Lot 023C');
  });
});

describe('firstDay and isVisible', () => {
  const s = sched({
    projectId: 'x',
    entered: { entitled: 200, filed: 100 },
    end: { kind: 'exit', stage: 'entitled', reason: 'expired', day: 300 }
  });

  it('firstDay is the earliest entered day, whatever the key order', () => {
    expect(firstDay(s)).toBe(100);
  });

  it('is not visible before its first entered day', () => {
    expect(isVisible(s, 99)).toBe(false);
    expect(isVisible(s, 100)).toBe(true);
  });

  it('stays visible for DYING_DAYS after an exit, and not one day longer', () => {
    expect(isVisible(s, 300)).toBe(true);
    expect(isVisible(s, 300 + DYING_DAYS)).toBe(true);
    expect(isVisible(s, 300 + DYING_DAYS + 1)).toBe(false);
  });

  it('is visible before an exit that is still in the future', () => {
    expect(isVisible(s, 250)).toBe(true);
  });

  it('a completed or open project is visible for ever', () => {
    const done = sched({
      projectId: 'c',
      entered: { filed: 10 },
      end: { kind: 'complete', day: 50 }
    });
    const open = sched({ projectId: 'o', entered: { filed: 10 } });
    expect(isVisible(done, 50 + DYING_DAYS * 100)).toBe(true);
    expect(isVisible(open, 50 + DYING_DAYS * 100)).toBe(true);
  });
});

describe('chooseProject', () => {
  const a = sched({ projectId: 'a', entered: { filed: 100 }, end: { kind: 'complete', day: 400 } });
  const b = sched({
    projectId: 'b',
    entered: { filed: 500 },
    end: { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: 600 }
  });

  it('honours projectId when that project is visible', () => {
    expect(chooseProject([a, b], 550, 'a')).toBe(a);
    expect(chooseProject([a, b], 550, 'b')).toBe(b);
  });

  it('falls back to the day rule when the named project is not visible at day', () => {
    // b has not started at 450; the latest started project is a
    expect(chooseProject([a, b], 450, 'b')).toBe(a);
    // b died more than DYING_DAYS before this day: the day rule then offers b, which is also not
    // visible, so nothing is returned
    expect(chooseProject([b], 600 + DYING_DAYS + 1, 'b')).toBeNull();
  });

  it('falls back to the day rule when the named project is not on the parcel', () => {
    expect(chooseProject([a, b], 550, 'zzz')).toBe(b);
  });

  it('takes the latest-started project whose first stage is on or before day', () => {
    expect(chooseProject([b, a], 99)).toBeNull();
    expect(chooseProject([b, a], 100)).toBe(a);
    expect(chooseProject([a, b], 499)).toBe(a);
    expect(chooseProject([a, b], 500)).toBe(b);
    expect(chooseProject([b, a], 500)).toBe(b);
  });

  it('applies the DYING_DAYS cut to the latest project', () => {
    expect(chooseProject([a, b], 600 + DYING_DAYS)).toBe(b);
    // the latest project is b and it is no longer visible: the spec takes the latest, if visible
    expect(chooseProject([a, b], 600 + DYING_DAYS + 1)).toBeNull();
  });

  it('is independent of input order for projects that start on the same day', () => {
    const c = sched({ projectId: 'c', entered: { filed: 100 } });
    expect(chooseProject([a, c], 200)?.projectId).toBe(chooseProject([c, a], 200)?.projectId);
  });

  it('returns null for an empty parcel', () => {
    expect(chooseProject([], 1000)).toBeNull();
  });
});

describe('projectCard: label', () => {
  it('a pipeline card shows the T3 label', () => {
    const { ctx } = mkCtx();
    expect(projectCard(construction(), d(2022, 1, 1), ctx).label).toBe('500 Mini Blvd');
  });

  it('a pipeline row without a label shows Block/Lot of its smallest ParcelId', () => {
    const { ctx } = mkCtx();
    const s = sched({
      projectId: P.complete,
      parcelIds: ['3512006', '2999A007', '3512001'],
      entered: { filed: d(2019, 1, 10) }
    });
    expect(projectCard(s, d(2020, 1, 1), ctx).label).toBe('Block 2999A, Lot 007');
  });

  it('a simulated card is always Block/Lot, for the three id shapes', () => {
    const { ctx } = mkCtx();
    const label = (id: ParcelId) =>
      projectCard(
        sched({
          projectId: `SIM:${id}`,
          origin: 'simulated',
          parcelIds: [id],
          entered: { filed: AS_OF + 10 },
          revisions: [{ day: AS_OF + 10, units: 5, stories: 4 }]
        }),
        AS_OF + 20,
        ctx
      ).label;
    expect(label('0026T001A')).toBe('Block 0026T, Lot 001A');
    expect(label('2999A019')).toBe('Block 2999A, Lot 019');
    expect(label('3512008')).toBe('Block 3512, Lot 008');
  });

  it('a simulated card ignores any row that happens to share its id', () => {
    const { ctx } = mkCtx();
    const s = sched({
      projectId: P.construction, // would give '500 Mini Blvd' if it were looked up
      origin: 'simulated',
      parcelIds: ['2999A005'],
      entered: { filed: AS_OF + 10 }
    });
    const c = projectCard(s, AS_OF + 20, ctx);
    expect(c.label).toBe('Block 2999A, Lot 005');
    expect(c.sources).toEqual([]);
    expect(c.quality).toEqual([]);
  });

  it('a phase uses its master row label, or Block/Lot of the phase when the master has none', () => {
    const phase: Schedule['phase'] = { masterId: P.entitled3, index: 1, of: 3, start: 'scheduled' };
    const s = sched({
      projectId: `${P.entitled3}:phase:1`,
      parcelIds: ['3600004', '3600003'],
      phase,
      multiPhase: true,
      entered: { permitFiled: AS_OF + 100 },
      revisions: [{ day: AS_OF + 100, units: 300, stories: null }]
    });
    const { ctx } = mkCtx({ masters: new Map([[P.entitled3, master(P.entitled3, {})]]) });
    expect(projectCard(s, AS_OF + 200, ctx).label).toBe('Mini Shipyard');
    ctx.rows.get(P.entitled3)!.label = null;
    expect(projectCard(s, AS_OF + 200, ctx).label).toBe('Block 3600, Lot 003');
  });
});

describe('projectCard: units, stories and the revision at day', () => {
  const revs: Schedule['revisions'] = [
    { day: d(2021, 3, 1), units: 60, stories: 8 },
    { day: d(2021, 9, 1), units: 66, stories: 9 },
    { day: d(2022, 3, 1), units: 50, stories: 7 }
  ];

  it('uses the latest revision on or before day, and lists only those', () => {
    const { ctx } = mkCtx();
    const s = construction({ revisions: revs });
    const c1 = projectCard(s, d(2021, 3, 1), ctx);
    expect([c1.units, c1.stories, c1.revisions]).toEqual([60, 8, [revs[0]]]);
    const c2 = projectCard(s, d(2021, 9, 1), ctx);
    expect([c2.units, c2.stories, c2.revisions]).toEqual([66, 9, [revs[0], revs[1]]]);
    const c3 = projectCard(s, d(2030, 1, 1), ctx);
    expect([c3.units, c3.stories, c3.revisions]).toEqual([50, 7, revs]);
  });

  it('asks the building callback for the revision shown', () => {
    const building = vi.fn(() => FOOT);
    const { ctx } = mkCtx({ building });
    const s = construction({ revisions: revs });
    projectCard(s, d(2021, 10, 1), ctx);
    expect(building).toHaveBeenCalledTimes(1);
    expect(building).toHaveBeenCalledWith(s, 1);
  });

  it('existingUnits is the schedule value, not the assessor sum', () => {
    const { ctx } = mkCtx();
    // sharedExisting: T3 existingUnits 0 although parcel 3512012 holds 2 assessor units
    const row = ctx.rows.get(P.sharedExisting)!;
    const i = city.parcels.index.get(row.parcelIds[0])!;
    expect(city.parcels.existingUnits[i]).toBeGreaterThan(row.existingUnits);
    const s = sched({
      projectId: P.sharedExisting,
      parcelIds: row.parcelIds,
      existingUnits: row.existingUnits,
      entered: { filed: d(2025, 4, 1) }
    });
    expect(projectCard(s, AS_OF, ctx).existingUnits).toBe(0);
    // a phase and a simulated card show their own schedule value, 0 after a demolition included
    expect(projectCard(construction({ existingUnits: 11 }), d(2022, 1, 1), ctx).existingUnits).toBe(
      11
    );
    const sim = sched({
      projectId: 'SIM:x',
      origin: 'simulated',
      parcelIds: ['3512008'],
      existingUnits: 0,
      entered: { filed: AS_OF + 1 }
    });
    expect(projectCard(sim, AS_OF + 5, ctx).existingUnits).toBe(0);
  });

  it('copies pathway, multiPhase and phase from the schedule', () => {
    const { ctx } = mkCtx();
    const c = projectCard(construction({ pathway: 'streamlined' }), d(2022, 1, 1), ctx);
    expect([c.projectId, c.origin, c.pathway, c.multiPhase, c.phase]).toEqual([
      P.construction,
      'pipeline',
      'streamlined',
      false,
      null
    ]);
  });
});

describe('projectCard: storiesTier', () => {
  const rv = (stories: number | null, day: Day = d(2021, 3, 1), units = 60) => ({
    day,
    units,
    stories
  });

  it('is the row tier 0 for stories at revisions[0]', () => {
    const { ctx } = mkCtx();
    const c = projectCard(construction({ revisions: [rv(8)] }), d(2022, 1, 1), ctx);
    expect([c.stories, c.storiesTier]).toEqual([8, 0]);
  });

  it('is the row tier 3 (parsed from text) for stories at revisions[0]', () => {
    const { ctx } = mkCtx();
    const s = sched({
      projectId: P.preApplication,
      parcelIds: ['0026T002'],
      entered: { preApplication: d(2026, 8, 3) },
      revisions: [rv(5, d(2026, 8, 3), 12)]
    });
    const c = projectCard(s, AS_OF, ctx);
    expect([c.stories, c.storiesTier]).toEqual([5, 3]);
  });

  it('is 4 for stories from a later, scaled revision, even when revisions[0] is recorded', () => {
    const { ctx } = mkCtx();
    const s = construction({ revisions: [rv(8), rv(10, d(2021, 9, 1), 75)] });
    expect(projectCard(s, d(2021, 8, 1), ctx).storiesTier).toBe(0);
    const c = projectCard(s, d(2021, 10, 1), ctx);
    expect([c.stories, c.storiesTier]).toEqual([10, 4]);
  });

  it('is 4 and takes the building stories when the revision has none', () => {
    const { ctx } = mkCtx({ building: () => matched({ stories: 6 }) });
    const c = projectCard(construction({ revisions: [rv(null)] }), d(2022, 1, 1), ctx);
    expect([c.stories, c.storiesTier]).toEqual([6, 4]);
  });

  it('is 4 for a later revision with no stories that the building supplies', () => {
    const { ctx } = mkCtx({ building: () => matched({ stories: 7 }) });
    const s = construction({ revisions: [rv(8), rv(null, d(2021, 9, 1), 66)] });
    const c = projectCard(s, d(2021, 10, 1), ctx);
    expect([c.stories, c.storiesTier]).toEqual([7, 4]);
  });

  it('is null with stories null for a footprint entry', () => {
    const { ctx } = mkCtx({ building: () => FOOT });
    const c = projectCard(construction({ revisions: [rv(null)] }), d(2022, 1, 1), ctx);
    expect([c.stories, c.storiesTier, c.massing]).toEqual([null, null, 'none']);
  });

  it('a revision with stories keeps them when the massing is a footprint', () => {
    const { ctx } = mkCtx({ building: () => FOOT });
    const c = projectCard(construction({ revisions: [rv(8)] }), d(2022, 1, 1), ctx);
    expect([c.stories, c.storiesTier, c.massing]).toEqual([8, 0, 'none']);
  });

  it('is null for a simulated card, with or without a building', () => {
    const { ctx } = mkCtx({ building: () => matched({ stories: 6, source: 'scenario' }) });
    const sim = (stories: number | null) =>
      sched({
        projectId: 'SIM:y',
        origin: 'simulated',
        parcelIds: ['3512008'],
        entered: { filed: AS_OF + 1 },
        revisions: [rv(stories, AS_OF + 1, 20)]
      });
    const a = projectCard(sim(6), AS_OF + 5, ctx);
    expect([a.stories, a.storiesTier]).toEqual([6, null]);
    const b = projectCard(sim(null), AS_OF + 5, ctx);
    expect([b.stories, b.storiesTier]).toEqual([6, null]);
  });

  it('a phase has tier 4 from the building and null from a footprint', () => {
    const phase: Schedule['phase'] = { masterId: P.entitled3, index: 1, of: 3, start: 'estimated' };
    const s = sched({
      projectId: `${P.entitled3}:phase:1`,
      parcelIds: ['3600003'],
      phase,
      multiPhase: true,
      entered: { permitFiled: AS_OF + 100 },
      revisions: [rv(null, AS_OF + 100, 300)]
    });
    const masters = new Map([[P.entitled3, master(P.entitled3, {})]]);
    const a = projectCard(s, AS_OF + 200, mkCtx({ masters, building: () => matched() }).ctx);
    expect([a.stories, a.storiesTier]).toEqual([5, 4]);
    const b = projectCard(s, AS_OF + 200, mkCtx({ masters, building: () => FOOT }).ctx);
    expect([b.stories, b.storiesTier]).toEqual([null, null]);
  });
});

describe('projectCard: storiesTier 1 (large-site massing §4.5, R1)', () => {
  const phase: Schedule['phase'] = { masterId: P.entitled3, index: 1, of: 3, start: 'estimated' };
  /** `input` with Mini Shipyard's phase 1 curated at `phaseStories` and the master at 6. */
  function curatedInput(phaseStories: number | null): SimInput {
    const projects = structuredClone(input.projects).map((r) =>
      r.id !== P.entitled3
        ? r
        : {
            ...r,
            daHeights: { stories: 6, maxStories: null, openSpaceShare: null },
            phases: r.phases!.map((ph, i) =>
              i === 0 && phaseStories !== null
                ? { ...ph, stories: phaseStories, storiesTier: 1 as const }
                : ph
            )
          }
    );
    return { ...input, projects };
  }
  const district = (stories: number[]) =>
    matched({
      stories: Math.max(...stories),
      lots: stories.map((n) => ({ typology: 'midrise' as const, stories: n, floorAreaM2: 1000 }))
    });
  const card = (b: Massing, inp: SimInput, stories: number | null = null) => {
    const s = sched({
      projectId: `${P.entitled3}:phase:1`,
      parcelIds: ['3600003'],
      phase,
      multiPhase: true,
      entered: { permitFiled: AS_OF + 100 },
      revisions: [{ day: AS_OF + 100, units: 300, stories }]
    });
    const masters = new Map([[P.entitled3, master(P.entitled3, {})]]);
    const c = projectCard(s, AS_OF + 200, mkCtx({ input: inp, masters, building: () => b }).ctx);
    return [c.stories, c.storiesTier];
  };

  it('a district built at the curated height reports tier 1', () => {
    expect(card(district([8, 8, 8]), curatedInput(8))).toEqual([8, 1]);
    // R1: small lots capped below the curated height still count; the tallest is at it
    expect(card(district([8, 5, 3]), curatedInput(8))).toEqual([8, 1]);
    // a phase without its own height takes the master's
    expect(card(district([6, 4]), curatedInput(null))).toEqual([6, 1]);
  });

  it('a drawn-height district reports tier 4', () => {
    // no curated height at all
    expect(card(district([5, 9, 3]), input)).toEqual([9, 4]);
  });

  it('a district raised above the curated height, or not reaching it, reports tier 4', () => {
    expect(card(district([12, 8]), curatedInput(8))).toEqual([12, 4]);
    expect(card(district([7, 5]), curatedInput(8))).toEqual([7, 4]);
  });

  it('a non-district building or a stated revision is not tier 1', () => {
    expect(card(matched({ stories: 8 }), curatedInput(8))).toEqual([8, 4]);
    expect(card(district([8, 8]), curatedInput(8), 8)).toEqual([8, 4]);
  });
});

describe('projectCard: massing', () => {
  const pipe = (b: Massing, over: Partial<Schedule> = {}) => {
    const { ctx } = mkCtx({ building: () => b });
    return projectCard(construction(over), d(2022, 1, 1), ctx).massing;
  };

  it('pipeline: matched when the massing carries the units', () => {
    const b = matched();
    expect(massingApproximate(b)).toBe(false);
    expect(pipe(b)).toBe('matched');
  });

  it('pipeline: approximate when massingApproximate', () => {
    const b = bld({ units: 400 });
    expect(massingApproximate(b)).toBe(true);
    expect(pipe(b)).toBe('approximate');
  });

  it('pipeline: approximate for a hand-made building with massedUnits 0 and 1 unit', () => {
    const b = bld({ units: 1, floorAreaM2: 0 });
    expect(massedUnits(b)).toBe(0);
    expect(massingApproximate(b)).toBe(false); // IA-22: the helper alone would say matched
    expect(pipe(b)).toBe('approximate');
  });

  it('a footprint entry is none', () => {
    expect(pipe(FOOT)).toBe('none');
  });

  it('a master without phases reports massing matched or approximate, not none', () => {
    const unphased = { multiPhase: true, phase: null };
    expect(pipe(matched(), unphased)).toBe('matched');
    expect(pipe(bld({ units: 9999 }), unphased)).toBe('approximate');
    expect(pipe(FOOT, unphased)).toBe('none');
  });

  it('a phase uses the pipeline rule', () => {
    const phase: Schedule['phase'] = { masterId: P.entitled3, index: 2, of: 3, start: 'estimated' };
    const run = (b: Massing) => {
      const { ctx } = mkCtx({
        building: () => b,
        masters: new Map([[P.entitled3, master(P.entitled3, {})]])
      });
      const s = sched({
        projectId: `${P.entitled3}:phase:2`,
        parcelIds: ['3600004'],
        phase,
        multiPhase: true,
        entered: { permitFiled: AS_OF + 100 },
        revisions: [{ day: AS_OF + 100, units: 350, stories: null }]
      });
      return projectCard(s, AS_OF + 200, ctx).massing;
    };
    expect(run(matched({ units: 350 }))).toBe('matched');
    expect(run(bld({ units: 1, floorAreaM2: 0 }))).toBe('approximate');
    expect(run(bld({ units: 9999 }))).toBe('approximate');
    expect(run(FOOT)).toBe('none');
  });

  describe('simulated', () => {
    const sim = (b: Massing, units: number) => {
      const { ctx } = mkCtx({ building: () => b });
      const s = sched({
        projectId: 'SIM:z',
        origin: 'simulated',
        parcelIds: ['3512008'],
        entered: { filed: AS_OF + 1 },
        revisions: [{ day: AS_OF + 1, units, stories: 5 }]
      });
      return projectCard(s, AS_OF + 5, ctx).massing;
    };

    it('is matched within unitsTolerance of the revision units', () => {
      const b = matched({ source: 'scenario', units: 20 });
      expect(massedUnits(b)).toBeGreaterThan(0);
      expect(sim({ ...b, units: 20 }, 20)).toBe('matched');
      expect(sim({ ...b, units: 22 }, 20)).toBe('matched'); // tolerance(20) = 2
    });

    it('is approximate beyond unitsTolerance', () => {
      const b = matched({ source: 'scenario' });
      expect(sim({ ...b, units: 23 }, 20)).toBe('approximate');
    });

    it('is approximate when massedUnits is 0', () => {
      const b = bld({ source: 'scenario', units: 1, floorAreaM2: 0 });
      expect(sim(b, 1)).toBe('approximate');
    });

    it('is none for a footprint', () => {
      expect(sim(FOOT, 20)).toBe('none');
    });
  });
});

/** A Master for the tests. `entered` is its Planning-side days. */
function master(masterId: string, entered: Master['entered']): Master {
  return {
    masterId,
    pathway: 'discretionary',
    entered,
    end: { kind: 'open' },
    phaseUnits: [],
    phaseFiled: []
  };
}

describe('projectCard: stages', () => {
  it('lists only stages entered on or before day, in STAGE_ORDER', () => {
    const { ctx } = mkCtx();
    const s = construction({
      entered: {
        construction: d(2024, 6, 3), // inserted out of order on purpose
        filed: d(2021, 3, 1),
        permitIssued: d(2023, 2, 1),
        entitled: d(2021, 12, 1),
        permitFiled: d(2022, 4, 1)
      }
    });
    const stages = (day: Day) => projectCard(s, day, ctx).stages.map((x) => x.stage);
    expect(stages(d(2021, 2, 1))).toEqual([]);
    expect(stages(d(2021, 12, 1))).toEqual(['filed', 'entitled']);
    expect(stages(d(2023, 2, 1))).toEqual(['filed', 'entitled', 'permitFiled', 'permitIssued']);
    expect(stages(d(2030, 1, 1))).toEqual([
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
  });

  it('actual is true only for a history day on or before asOf', () => {
    const { ctx } = mkCtx();
    const s = construction({
      entered: {
        filed: d(2021, 3, 1), // history
        entitled: d(2021, 12, 1), // history
        permitFiled: d(2022, 4, 1), // history
        permitIssued: d(2023, 2, 1), // history
        construction: d(2024, 6, 3), // history
        complete: AS_OF + 400 // drawn
      }
    });
    const c = projectCard(s, AS_OF + 500, ctx);
    expect(c.stages.map((x) => [x.stage, x.actual])).toEqual([
      ['filed', true],
      ['entitled', true],
      ['permitFiled', true],
      ['permitIssued', true],
      ['construction', true],
      ['complete', false]
    ]);
  });

  it('a stage without a history day is not actual, even on or before asOf', () => {
    const { ctx } = mkCtx();
    const row = ctx.rows.get(P.construction)!;
    delete row.history.entitled;
    const s = construction({ entered: { filed: d(2021, 3, 1), entitled: AS_OF } });
    const c = projectCard(s, AS_OF, ctx);
    expect(c.stages.map((x) => [x.stage, x.actual])).toEqual([
      ['filed', true],
      ['entitled', false]
    ]);
  });

  it('a simulated card has no actual stage', () => {
    const { ctx } = mkCtx();
    const sim = sched({
      projectId: 'SIM:s',
      origin: 'simulated',
      parcelIds: ['3512008'],
      entered: { filed: AS_OF + 3, entitled: AS_OF + 90 },
      revisions: [{ day: AS_OF + 3, units: 6, stories: 3 }]
    });
    const c = projectCard(sim, AS_OF + 100, ctx);
    expect(c.stages.map((x) => x.actual)).toEqual([false, false]);
  });

  describe('phase cards', () => {
    const phase: Schedule['phase'] = { masterId: P.entitled3, index: 1, of: 3, start: 'scheduled' };
    const F = AS_OF + 300;
    const ph = sched({
      projectId: `${P.entitled3}:phase:1`,
      parcelIds: ['3600003'],
      phase,
      multiPhase: true,
      entered: { permitFiled: F, permitIssued: F + 200, construction: F + 400 },
      revisions: [{ day: F, units: 300, stories: null }]
    });
    const m = master(P.entitled3, { filed: d(2009, 3, 2), entitled: d(2012, 6, 15) });
    const stages = (day: Day, mm: Master | null = m) => {
      const { ctx } = mkCtx({ masters: new Map(mm ? [[P.entitled3, mm]] : []) });
      return projectCard(ph, day, ctx).stages.map((x) => [x.stage, x.day, x.actual]);
    };

    it('starts with the master Planning-side stages, then the phase own stages', () => {
      expect(stages(F + 250)).toEqual([
        ['filed', d(2009, 3, 2), true],
        ['entitled', d(2012, 6, 15), true],
        ['permitFiled', F, false],
        ['permitIssued', F + 200, false]
      ]);
    });

    it('filters the master context by day too', () => {
      expect(stages(d(2010, 1, 1))).toEqual([['filed', d(2009, 3, 2), true]]);
      expect(stages(d(2012, 6, 15))).toEqual([
        ['filed', d(2009, 3, 2), true],
        ['entitled', d(2012, 6, 15), true]
      ]);
    });

    it('master actual follows the master history day', () => {
      // entitled by a draw or the asOf fallback: in the master's entered, not in the row history
      const { ctx } = mkCtx({
        masters: new Map([
          [P.entitled3, master(P.entitled3, { filed: d(2009, 3, 2), entitled: AS_OF })]
        ])
      });
      const c = projectCard(ph, F + 10, ctx);
      expect(c.stages.slice(0, 2).map((x) => [x.stage, x.actual])).toEqual([
        ['filed', true],
        ['entitled', false]
      ]);
    });

    it('master history after asOf is never actual', () => {
      const { ctx } = mkCtx({
        masters: new Map([
          [P.entitled3, master(P.entitled3, { filed: d(2009, 3, 2), entitled: AS_OF + 50 })]
        ])
      });
      ctx.rows.get(P.entitled3)!.history.entitled = AS_OF + 50;
      const c = projectCard(ph, F + 10, ctx);
      expect(c.stages[1]).toEqual({ stage: 'entitled', day: AS_OF + 50, actual: false });
    });

    it('a phase own stages are never actual, whatever the master history holds', () => {
      const { ctx } = mkCtx({ masters: new Map([[P.entitled3, m]]) });
      ctx.rows.get(P.entitled3)!.history.permitFiled = F; // permit-side day on the master row
      const c = projectCard(ph, F + 10, ctx);
      expect(c.stages.find((x) => x.stage === 'permitFiled')).toEqual({
        stage: 'permitFiled',
        day: F,
        actual: false
      });
    });

    it('logs once and shows the phase stages alone when the master is unknown', () => {
      const { ctx, logged } = mkCtx();
      projectCard(ph, F + 10, ctx);
      const c = projectCard(ph, F + 10, ctx);
      expect(c.stages.map((x) => x.stage)).toEqual(['permitFiled']);
      expect(logged).toHaveLength(1);
    });

    it('a non-phase card never takes master context', () => {
      const { ctx } = mkCtx({ masters: new Map([[P.entitled3, m]]) });
      const c = projectCard(construction(), d(2022, 1, 1), ctx);
      expect(c.stages.map((x) => x.stage)).toEqual(['filed', 'entitled']);
    });
  });
});

describe('projectCard: end', () => {
  const exit = { kind: 'exit', stage: 'entitled', reason: 'expired', day: 5000 } as const;

  it('is null while the end is after day, the end once reached', () => {
    const { ctx } = mkCtx();
    const s = construction({ end: exit });
    expect(projectCard(s, 4999, ctx).end).toBeNull();
    expect(projectCard(s, 5000, ctx).end).toEqual(exit);
    expect(projectCard(s, 5100, ctx).end).toEqual(exit);
    const done = construction({ end: { kind: 'complete', day: 5000 } });
    expect(projectCard(done, 4999, ctx).end).toBeNull();
    expect(projectCard(done, 5000, ctx).end).toEqual({ kind: 'complete', day: 5000 });
  });

  it('is null for an open end: nothing has ended', () => {
    const { ctx } = mkCtx();
    expect(projectCard(construction({ end: { kind: 'open' } }), 99999, ctx).end).toBeNull();
  });
});

describe('projectCard: localProgram', () => {
  const lpIndex = city.parcels.index.get(MINI_LP_ID)!;
  const plainId = [...city.parcels.index.keys()].find(
    (id) => city.parcels.localProgram[city.parcels.index.get(id)!] === 0
  )!;
  const mk = (origin: Schedule['origin'], parcelId: ParcelId) =>
    sched({
      projectId: origin === 'simulated' ? 'SIM:lp' : P.construction,
      origin,
      parcelIds: [parcelId],
      entered: { filed: AS_OF + 1 }
    });

  it('is true for a simulated project on a Local Program parcel only', () => {
    expect(city.parcels.localProgram[lpIndex]).toBe(1);
    const { ctx } = mkCtx();
    expect(projectCard(mk('simulated', MINI_LP_ID), AS_OF + 5, ctx).localProgram).toBe(true);
    expect(projectCard(mk('simulated', plainId), AS_OF + 5, ctx).localProgram).toBe(false);
    expect(projectCard(mk('pipeline', MINI_LP_ID), AS_OF + 5, ctx).localProgram).toBe(false);
  });
});

describe('projectCard: sources and quality', () => {
  it('passes sources through with their key, absent when the source has none', () => {
    const { ctx } = mkCtx();
    const c = projectCard(construction(), d(2022, 1, 1), ctx);
    expect(c.sources).toEqual([
      { dataset: '6jgi-cpb4', id: '2021-000107PRJ', key: 'case_no' },
      {
        dataset: 'qvu5-m3a2',
        id: '2021-000107PRJ'
      }
    ]);
    expect('key' in c.sources[1]).toBe(false);
  });

  it('returns copies: editing the card does not touch the row', () => {
    const { ctx } = mkCtx();
    const c = projectCard(construction(), d(2022, 1, 1), ctx);
    c.sources[0].id = 'changed';
    expect(ctx.rows.get(P.construction)!.sources[0].id).toBe('2021-000107PRJ');
  });

  it('maps quality ids through qualityRules in id order', () => {
    const { ctx } = mkCtx();
    const s = sched({
      projectId: P.linked,
      parcelIds: ['3600010'],
      entered: { filed: d(2020, 7, 24) }
    });
    const c = projectCard(s, AS_OF, ctx);
    expect(c.quality).toEqual([
      { label: 'Dates taken from the Planning record on this lot', tier: 2, valueTier: 0 },
      {
        label: "A stage date earlier than the stage before it was moved up to that stage's date",
        tier: 2,
        valueTier: 2
      }
    ]);
  });

  it('sorts by id even if the row lists them out of order, and keeps a null valueTier', () => {
    const { ctx } = mkCtx();
    ctx.rows.get(P.linked)!.quality = ['pr.stages.forward-clamp', 'pr.multiphase.score-only'];
    const s = sched({
      projectId: P.linked,
      parcelIds: ['3600010'],
      entered: { filed: d(2020, 7, 24) }
    });
    const q = projectCard(s, AS_OF, ctx).quality;
    expect(q.map((x) => x.valueTier)).toEqual([null, 2]);
  });

  it('drops an unknown id and logs it once', () => {
    const { ctx, logged } = mkCtx();
    ctx.rows.get(P.construction)!.quality = ['pr.nope.unknown', 'pr.stages.forward-clamp'];
    const a = projectCard(construction(), d(2022, 1, 1), ctx);
    const b = projectCard(construction(), d(2023, 1, 1), ctx);
    expect(a.quality).toHaveLength(1);
    expect(b.quality).toHaveLength(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('pr.nope.unknown');
  });

  it('a phase uses its master row sources and quality', () => {
    const phase: Schedule['phase'] = { masterId: P.entitled3, index: 3, of: 3, start: 'estimated' };
    const s = sched({
      projectId: `${P.entitled3}:phase:3`,
      parcelIds: ['3600005'],
      phase,
      multiPhase: true,
      entered: { permitFiled: AS_OF + 100 },
      revisions: [{ day: AS_OF + 100, units: 250, stories: null }]
    });
    const { ctx } = mkCtx({ masters: new Map([[P.entitled3, master(P.entitled3, {})]]) });
    const c = projectCard(s, AS_OF + 150, ctx);
    expect(c.sources).toEqual([{ dataset: '6jgi-cpb4', id: '2012.000201PRX', key: 'case_no' }]);
    expect(c.quality.map((x) => x.tier)).toEqual([2]);
    expect(c.quality[0].label).toContain('Development Agreement');
    expect(c.phase).toEqual(phase);
    expect(c.multiPhase).toBe(true);
  });

  it('a simulated card has no sources and no quality', () => {
    const { ctx } = mkCtx();
    const sim = sched({
      projectId: 'SIM:q',
      origin: 'simulated',
      parcelIds: ['3512008'],
      entered: { filed: AS_OF + 3 }
    });
    const c = projectCard(sim, AS_OF + 5, ctx);
    expect([c.sources, c.quality]).toEqual([[], []]);
  });
});

describe('projectCard on a real run', () => {
  const run = simulateDetailed(input, 7, MINI_HORIZON);
  const masters = new Map(run.masters.map((m) => [m.masterId, m]));
  const records = new Map(city.records);
  const massingCtx: MassingCtx = {
    input,
    records: (id) => records.get(id),
    memo: createLru(1000),
    gen: generate,
    genForUnits: generateForUnits,
    logOnce() {}
  };
  const { ctx } = mkCtx({
    masters,
    building: (s, k) => massingFor(s, k, massingCtx)
  });
  const find = (pred: (s: Schedule) => boolean) => run.schedules.find(pred)!;

  it('a simulated project: Block/Lot label, no sources or quality, no stories tier', () => {
    const s = find((x) => x.origin === 'simulated');
    expect(s).toBeDefined();
    const day = s.revisions[0].day;
    const c = projectCard(s, day, ctx);
    expect(c.label).toMatch(/^Block \w{4,5}, Lot \w+$/);
    expect([c.sources, c.quality, c.storiesTier]).toEqual([[], [], null]);
    expect(c.stories).toBe(s.revisions[0].stories);
    expect(['matched', 'approximate']).toContain(c.massing);
    expect(c.existingUnits).toBe(s.existingUnits);
    expect(c.stages.every((x) => !x.actual)).toBe(true);
  });

  it('an entitled master phase: the master entitlement comes first, then the phase', () => {
    const s = find((x) => x.phase?.masterId === P.entitled3 && x.phase.index === 2);
    expect(s).toBeDefined();
    const c = projectCard(s, s.entered.permitFiled! + 1, ctx);
    expect(c.label).toBe('Mini Shipyard');
    expect(c.stages.slice(0, 2)).toEqual([
      { stage: 'filed', day: d(2009, 3, 2), actual: true },
      { stage: 'entitled', day: d(2012, 6, 15), actual: true }
    ]);
    expect(c.stages[2]).toEqual({
      stage: 'permitFiled',
      day: s.entered.permitFiled!,
      actual: false
    });
    expect(c.phase).toEqual(s.phase);
    expect(c.existingUnits).toBe(s.existingUnits);
    expect(c.storiesTier === 4 || c.storiesTier === null).toBe(true);
  });

  it('a phase of a master entitled by the asOf fallback shows that entitlement as not actual', () => {
    const inp: SimInput = { ...input, projects: structuredClone(input.projects) };
    const row = inp.projects.find((p) => p.id === P.entitled3)!;
    delete row.history.entitled; // stage entitled without a day: E falls back
    const r = simulateDetailed(inp, 7, MINI_HORIZON);
    const ms = new Map(r.masters.map((m) => [m.masterId, m]));
    const s = r.schedules.find((x) => x.phase?.masterId === P.entitled3)!;
    const { ctx: c2 } = mkCtx({
      input: inp,
      rows: new Map(inp.projects.map((p) => [p.id, p])),
      masters: ms
    });
    const card = projectCard(s, s.entered.permitFiled!, c2);
    const ent = card.stages.find((x) => x.stage === 'entitled')!;
    expect(ent.day).toBe(ms.get(P.entitled3)!.entered.entitled);
    expect(ent.actual).toBe(false);
  });
});
