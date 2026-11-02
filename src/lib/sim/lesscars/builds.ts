// Initiative builds as drawable Schedules, and the /lesscars building card (Plan 2 Task 4). The
// playback host converts each stored `InitiativeBuild` into an ordinary Schedule (origin
// 'simulated', id prefix `lc-build:`) only inside the worker, for massing and packing; nothing
// outside the worker sees these Schedules. Worker-safe and pure (no transcendental Math).
import type { InitiativeBuild } from '$lib/data/lesscars/codec';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { fnv1a32, generate } from '$lib/generator';
import type { Day } from '$lib/timelapse/time';
import { blockLot, isVisible, revisionAt } from '../scenario/card';
import { footprintOf } from '../scenario/massing';
import type { Massing, Schedule } from '../scenario/types';
import type { PlaybackCard } from './types';

/** The one synthetic cell every freed-site build packs into (the MapLibre id `lc-sites` is taken). */
export const SITES_CELL = 'lc-sites-cell';
/** The project id prefix of an initiative build's Schedule. */
export const BUILD_PREFIX = 'lc-build:';

/**
 * A drawable Schedule for one initiative build: id BUILD_PREFIX + siteId, origin 'simulated',
 * parcelIds [parcelId], pathway 'permitOnly', entered { construction: startDay, complete:
 * completeDay } (complete only if <= horizon), end complete or open, one revision
 * { day: startDay, units, stories }, existingUnits = existing, multiPhase false, phase null.
 */
export function buildSchedule(b: InitiativeBuild, parcelId: ParcelId, horizon: Day): Schedule {
  const done = b.completeDay <= horizon;
  return {
    projectId: BUILD_PREFIX + b.siteId,
    origin: 'simulated',
    parcelIds: [parcelId],
    pathway: 'permitOnly',
    entered: done
      ? { construction: b.startDay, complete: b.completeDay }
      : { construction: b.startDay },
    end: done ? { kind: 'complete', day: b.completeDay } : { kind: 'open' },
    revisions: [{ day: b.startDay, units: b.units, stories: b.stories }],
    existingUnits: b.existing,
    multiPhase: false,
    phase: null
  };
}

/**
 * The freed-site building: gen(rec, { maxStories: b.stories }, fnv1a32(b.siteId), 'max'),
 * stamped source 'scenario'; a null or throwing generator gives the outline's footprint.
 */
export function freedMassing(b: InitiativeBuild, rec: ParcelRecord, gen: typeof generate): Massing {
  let built: ReturnType<typeof generate>;
  try {
    built = gen(rec, { maxStories: b.stories }, fnv1a32(b.siteId), 'max');
  } catch {
    built = null;
  }
  return built === null ? footprintOf(rec) : { ...built, source: 'scenario' };
}

export type CardEntry =
  | { kind: 'market'; schedule: Schedule }
  | { kind: 'freed' | 'parking'; schedule: Schedule; build: InitiativeBuild; planLabel: string };

function statusAt(s: Schedule, day: Day): PlaybackCard['status'] {
  if (s.end.kind === 'exit' && s.end.day <= day) return 'stopped';
  if (s.end.kind === 'complete' && s.end.day <= day) return 'complete';
  const c = s.entered.construction;
  if (c !== undefined && c <= day) return 'construction';
  return 'planning';
}

/** The card at `day`; null when the project is not visible then (`isVisible`). */
export function playbackCard(e: CardEntry, day: Day): PlaybackCard | null {
  const s = e.schedule;
  if (!isVisible(s, day)) return null;
  const rev = s.revisions[revisionAt(s, day)];
  const c = s.entered.construction;
  return {
    projectId: s.projectId,
    kind: e.kind,
    planLabel: e.kind === 'market' ? null : e.planLabel,
    where: e.kind === 'freed' ? e.build.siteId : blockLot(s.parcelIds[0]),
    units: rev.units,
    existingUnits: s.existingUnits,
    stories: rev.stories,
    status: statusAt(s, day),
    constructionDay: c !== undefined && c <= day ? c : null,
    completeDay: s.end.kind === 'complete' && s.end.day <= day ? s.end.day : null
  };
}
