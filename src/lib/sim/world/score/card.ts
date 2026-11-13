// The project card from world 1 (spec rule 14, S15 `cardAt`): the lot's schedules read on `day`,
// today's choice and today's `projectCard`, unchanged; the lot-limits line from the frame passed
// in. Pure TS, worker-safe.
import type { ParcelId } from '$lib/data/parcel';
import { envelopeOf } from '$lib/data/scenario-codec';
import type { Lookups } from '$lib/sim/levers/apply';
import type { ParcelSummary } from '$lib/sim/protocol';
import { chooseProject, projectCard, revisionAt, type CardCtx } from '$lib/sim/scenario/card';
import type { Master } from '$lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { PolicyFrame } from '../policy/frame';
import { limitsOf } from '../policy/limits';
import { lookupsAt, newScale } from '../policy/lookups';
import { masterAt, scheduleAt } from '../read';
import type { Statics } from '../statics';
import { ORIGIN_MASTER, ORIGIN_PHASE, ORIGIN_PIPELINE, ORIGIN_SIM, type World } from '../types';
import type { CardDeps } from './types';

const ROWS = new WeakMap<Statics, Map<string, InFlightProject>>();
/** Per statics, per frame object (never the frame id: content-equal frames differ in owners). */
const INPUTS = new WeakMap<Statics, WeakMap<PolicyFrame, SimInput>>();

function rowsOf(statics: Statics): Map<string, InFlightProject> {
  let m = ROWS.get(statics);
  if (!m) {
    m = new Map(statics.projects.map((p) => [p.id, p]));
    ROWS.set(statics, m);
  }
  return m;
}

/** The input `projectCard` reads under `frame` (it reads `parcels` and the two scales). */
function inputOf(statics: Statics, frame: PolicyFrame): SimInput {
  let byFrame = INPUTS.get(statics);
  if (!byFrame) {
    byFrame = new WeakMap();
    INPUTS.set(statics, byFrame);
  }
  let input = byFrame.get(frame);
  if (!input) {
    input = {
      parcels: frame.view.parcels,
      projects: statics.projects,
      asOf: statics.asOf,
      districtMaxStories: statics.districtMaxStories,
      calibration: frame.calibration,
      inFlightScale: frame.speed,
      newProjects: { calibration: frame.newCalibration, scale: newScale(frame) }
    };
    byFrame.set(frame, input);
  }
  return input;
}

/** The schedules on `parcelId` read on `day`, by a linear scan of the world's rows. */
function schedulesOn(world: World, statics: Statics, parcelId: ParcelId, day: Day): Schedule[] {
  const p = world.projects;
  const out: Schedule[] = [];
  for (let r = 0; r < p.n; r++) {
    const o = p.origin[r];
    let on = false;
    if (o === ORIGIN_SIM) on = statics.parcelId[p.src[r]] === parcelId;
    else if (o === ORIGIN_PIPELINE) on = statics.projects[p.src[r]].parcelIds.includes(parcelId);
    else if (o === ORIGIN_PHASE) {
      const ph = statics.projects[p.src[r]].phases?.[p.sub[r] - 1];
      on = ph !== undefined && ph.parcelIds.includes(parcelId);
    }
    if (!on) continue;
    const s = scheduleAt(world, statics, r, day);
    if (s !== null) out.push(s);
  }
  return out;
}

/** The chosen phase's master read on `day` (none for any other schedule). */
function mastersFor(world: World, statics: Statics, s: Schedule, day: Day): Map<string, Master> {
  const out = new Map<string, Master>();
  if (s.phase === null) return out;
  const p = world.projects;
  for (let r = 0; r < p.n; r++) {
    if (p.origin[r] !== ORIGIN_MASTER) continue;
    if (statics.projects[p.src[r]].id !== s.phase.masterId) continue;
    const m = masterAt(world, statics, r, day);
    if (m !== null) out.set(m.masterId, m);
  }
  return out;
}

/**
 * World 1's answer to `parcelSummary`: the lot's record, its envelope and limits under `frame`,
 * and the project chosen on `day` with its card and the frame's stage tables for its cohort.
 * The caller passes `frame = timeline.frameAt(max(1, monthOfDay(asOf, day)))` of the timeline in
 * use, and checks `deps.record(parcelId)` first: a missing record throws.
 */
export function cardAt(
  world: World,
  statics: Statics,
  frame: PolicyFrame,
  deps: CardDeps,
  parcelId: ParcelId,
  day: Day,
  projectId?: string
): { summary: ParcelSummary; lookups: Lookups | null } {
  const rec = deps.record(parcelId);
  if (rec === null) throw new Error(`cardAt: no record for ${parcelId}`);
  const parcels = frame.view.parcels;
  const i = parcels.index.get(parcelId);
  const envelope = i === undefined ? null : envelopeOf(parcels, i);
  const summary: ParcelSummary = {
    parcelId,
    neighborhood: rec.neighborhood,
    landUse: rec.landUse,
    eligible: rec.eligible,
    ...(rec.underwater ? { underwater: true as const } : {}),
    existingUnits: i === undefined ? rec.existingUnits : parcels.existingUnits[i],
    envelope: envelope && envelope.maxStories > 0 ? envelope : null,
    generated: null
  };

  // The lot-limits line, as the host's: an eligible lot with plan stories; owner and protection
  // from the frame's attribution (a protected lot reads FZP, nothing buildable).
  if (i !== undefined && rec.eligible && summary.envelope) {
    const allowed = summary.envelope.maxStories;
    const fl = limitsOf(frame, parcelId);
    const ownerField = fl ? { owner: fl.owner } : {};
    summary.limits = fl?.protected
      ? { allowed, buildable: null, protected: true, ...ownerField }
      : {
          allowed,
          buildable: deps.buildable(parcelId, allowed, summary.existingUnits),
          protected: false,
          ...ownerField
        };
  }

  const chosen = chooseProject(schedulesOn(world, statics, parcelId, day), day, projectId);
  if (chosen === null) return { summary, lookups: null };
  const ctx: CardCtx = {
    asOf: statics.asOf,
    input: inputOf(statics, frame),
    rows: rowsOf(statics),
    masters: mastersFor(world, statics, chosen, day),
    qualityRules: deps.qualityRules,
    building: deps.building,
    logOnce: deps.logOnce
  };
  const card = projectCard(chosen, day, ctx);
  summary.project = card;
  // A footprint fallback has no building to describe.
  const m = deps.building(chosen, revisionAt(chosen, day));
  if (!('footprint' in m))
    summary.generated = { typology: m.typology, stories: m.stories, units: m.units };
  return { summary, lookups: lookupsAt(frame)[card.lookups] };
}
