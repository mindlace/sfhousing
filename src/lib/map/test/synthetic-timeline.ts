// Deterministic synthetic whole-city timeline for client budget tests and bench:map (spec §6
// "synthetic-timeline"). Not committed data, and never simulation input: every share and gap
// below is a tier-4 test value, made up to exercise the renderer.
import { timelineLookups } from '../fixtures/timeline-lookups';
import { packTimedCell, type TimedPackInput } from '../pack-timed';
import type { TimelineLookups } from '../timelapse/types';
import type { TimedPackedCell, TimelineUpdate } from '../types';
import {
  benchmarkExemplars,
  cityGrid,
  gridSite,
  mulberry32,
  placeBuilding
} from './synthetic-city';
import type { Schedule } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { EXIT_ORDER, PATHWAYS, pathwayStages, type Stage } from '$lib/timelapse/types';

/** First and last stage day: 2026-10-16 and 2050-12-31 (spec §4.5). */
export const SYNTHETIC_START: Day = 20742;
export const SYNTHETIC_END: Day = 29584;

/** The hand-made test lookups (`fixtures/timeline-lookups.ts`); they cover every pathway. */
export const SYNTHETIC_LOOKUPS: TimelineLookups = timelineLookups;

/** Tier 4, test value only: share of projects that exit (spec §6). Not a calibrated rate. */
const EXIT_SHARE = 0.15;
/** Tier 4, test value only: share still in progress at the horizon. */
const OPEN_SHARE = 0.15;
/** Tier 4, test value only: share with a second revision (≈ 1.3 revisions per project). */
const REVISED_SHARE = 0.3;
/** Tier 4, test value only: share starting at preApplication (PPA is optional, T2). */
const PPA_SHARE = 0.4;
/** Tier 4, test value only: days in a stage before the next, [min, min + span). */
const STAGE_GAP = { min: 30, span: 510 };
const CONSTRUCTION_GAP = { min: 360, span: 540 };
/** Room an open project leaves before the horizon, so a second revision fits. */
const OPEN_LEAD = 60;

const int = (rnd: () => number, n: number) => Math.floor(rnd() * n);

/**
 * `nProjects` single-parcel projects in cells of `perCell` on the synthetic city's grid
 * (`makeSyntheticCity`'s placement and exemplar buildings), as one revision-0 snapshot.
 *
 * Each project draws a pathway (permitOnly skips filed and entitled, T2; PPA is optional, but a
 * streamlined project never takes it because `SYNTHETIC_LOOKUPS` has no streamlined PPA row),
 * seeded stage days in [Day 20742, Day 29584], and an end: an exit at one of its stages, open at
 * the horizon, or complete. A second revision, on a different exemplar building, lands before
 * construction. `demolish` lists every project that reaches construction, at that day.
 * Deterministic for a seed.
 */
export function makeSyntheticTimeline(
  seed: number,
  nProjects: number,
  perCell = 1500
): TimelineUpdate {
  const rnd = mulberry32(seed);
  const exemplars = benchmarkExemplars('representative');
  const grid = cityGrid(nProjects, perCell);
  const cells: TimedPackedCell[] = [];
  const demolish: TimelineUpdate['demolish'] = [];
  let made = 0;
  for (let c = 0; c < grid.nCells; c++) {
    const count = Math.min(perCell, nProjects - made);
    const items: TimedPackInput[] = [];
    for (let i = 0; i < count; i++) {
      const [x, y] = gridSite(grid, c, i, rnd);
      const n = String(made + i).padStart(7, '0');
      const parcelId = `T${seed}-${n}`;
      const schedule = syntheticSchedule(`syn-${seed}-${n}`, parcelId, rnd);
      const first = int(rnd, exemplars.length);
      const picks = [first];
      if (schedule.revisions.length > 1)
        picks.push((first + 1 + int(rnd, exemplars.length - 1)) % exemplars.length);
      const massings = picks.map((e) => placeBuilding(exemplars[e], parcelId, x, y));
      massings.forEach((m, r) => {
        schedule.revisions[r].units = m.units;
        schedule.revisions[r].stories = m.stories;
      });
      items.push({ schedule, massings, pickParcelId: parcelId });
      const built = schedule.entered.construction;
      if (built !== undefined) demolish.push({ parcelId, day: built });
    }
    made += count;
    cells.push(packTimedCell(`syn-tl-${String(c).padStart(4, '0')}`, items));
  }
  return { revision: 0, cells, removedCells: [], demolish };
}

/** One project's schedule; revision units and stories are filled in from its massings. */
function syntheticSchedule(projectId: string, parcelId: string, rnd: () => number): Schedule {
  const pathway = PATHWAYS[int(rnd, PATHWAYS.length)];
  const ppa = pathway !== 'streamlined' && rnd() < PPA_SHARE;
  const stages = pathwayStages(pathway).filter((s) => ppa || s !== 'preApplication');
  // Offsets from the first stage's day.
  const off = [0];
  for (let i = 1; i < stages.length; i++) {
    const g = stages[i] === 'complete' ? CONSTRUCTION_GAP : STAGE_GAP;
    off.push(off[i - 1] + g.min + int(rnd, g.span));
  }
  const r = rnd();
  const kind = r < EXIT_SHARE ? 'exit' : r < EXIT_SHARE + OPEN_SHARE ? 'open' : 'complete';

  let start: Day;
  let last: number; // stages[0..last] are entered
  let end: Schedule['end'];
  if (kind === 'open') {
    // The chain crosses the horizon: complete falls after it, the first stage at least
    // OPEN_LEAD days before it.
    const span = off[off.length - 1];
    start = SYNTHETIC_END - OPEN_LEAD - int(rnd, span - OPEN_LEAD);
    last = off.findLastIndex((o) => start + o <= SYNTHETIC_END);
    end = { kind: 'open' };
  } else if (kind === 'exit') {
    last = int(rnd, stages.length - 1); // any stage but complete
    const exitOff = off[last] + STAGE_GAP.min + int(rnd, STAGE_GAP.span);
    start = SYNTHETIC_START + int(rnd, SYNTHETIC_END - SYNTHETIC_START - exitOff + 1);
    const reason = EXIT_ORDER[int(rnd, EXIT_ORDER.length)];
    end = { kind: 'exit', stage: stages[last], reason, day: start + exitOff };
  } else {
    last = stages.length - 1;
    start = SYNTHETIC_START + int(rnd, SYNTHETIC_END - SYNTHETIC_START - off[last] + 1);
    end = { kind: 'complete', day: start + off[last] };
  }

  const entered: Partial<Record<Stage, Day>> = {};
  for (let i = 0; i <= last; i++) entered[stages[i]] = start + off[i];
  const revisions: Schedule['revisions'] = [{ day: start, units: 0, stories: null }];
  if (rnd() < REVISED_SHARE) {
    // Strictly after the first revision and before construction (T5), the exit or the horizon.
    const limit = Math.min(
      entered.construction ?? (end.kind === 'exit' ? end.day : SYNTHETIC_END),
      SYNTHETIC_END
    );
    revisions.push({ day: start + 1 + int(rnd, limit - start - 1), units: 0, stories: null });
  }
  return {
    projectId,
    origin: 'simulated',
    parcelIds: [parcelId],
    pathway,
    entered,
    end,
    revisions,
    existingUnits: int(rnd, 3),
    multiPhase: false,
    phase: null
  };
}
