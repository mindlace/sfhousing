// Readers (spec S8, rule 22): a world's rows as today's `Schedule` and `Master`, as seen by a
// reader standing on `day` (nothing dated after it). Pipeline, phase and master rows for now.
import type { Master } from '$lib/sim/scenario/simulate';
import type { Schedule } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { EXIT_ORDER, PATHWAYS, STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { revisionsOf } from './columns';
import type { Statics } from './statics';
import {
  END_ALIVE,
  END_COMPLETE,
  END_ENTITLED,
  END_EXIT,
  NO_DAY,
  ORIGIN_MASTER,
  ORIGIN_PHASE,
  ORIGIN_PIPELINE,
  type World
} from './types';

const S = STAGE_ORDER.length;
const PERMIT_FILED = STAGE_ORDER.indexOf('permitFiled');

function enteredOf(w: World, row: number, day: Day): Partial<Record<Stage, Day>> {
  const p = w.projects;
  const out: Partial<Record<Stage, Day>> = {};
  for (let s = 0; s < S; s++) {
    const d = p.entered[row * S + s];
    if (d !== NO_DAY && d <= day) out[STAGE_ORDER[s]] = d;
  }
  return out;
}

/** The first day of a schedule row: its earliest entered day. */
function firstDay(w: World, row: number): Day {
  const p = w.projects;
  let first = Infinity;
  for (let s = 0; s < S; s++) {
    const d = p.entered[row * S + s];
    if (d !== NO_DAY && d < first) first = d;
  }
  return first;
}

function endOf(w: World, row: number, day: Day): Schedule['end'] | Master['end'] {
  const p = w.projects;
  const kind = p.endKind[row];
  const d = p.endDay[row];
  if (kind === END_ALIVE || d > day) return { kind: 'open' };
  if (kind === END_COMPLETE) return { kind: 'complete', day: d };
  if (kind === END_EXIT) {
    return {
      kind: 'exit',
      stage: STAGE_ORDER[p.endStage[row]],
      reason: EXIT_ORDER[p.outcome[row] - 1],
      day: d
    };
  }
  if (kind === END_ENTITLED) return { kind: 'entitled', day: d };
  throw new Error(`row ${row} has end kind ${kind}`);
}

/** A pipeline or phase row as today's `Schedule`; null for a master or before the row began. */
export function scheduleAt(w: World, statics: Statics, row: number, day: Day): Schedule | null {
  const p = w.projects;
  const origin = p.origin[row];
  if (origin === ORIGIN_MASTER) return null;
  if (origin !== ORIGIN_PIPELINE && origin !== ORIGIN_PHASE) {
    throw new Error(`scheduleAt: row ${row} has origin ${origin}, not read yet`);
  }
  if (firstDay(w, row) > day) return null;
  const ip = statics.projects[p.src[row]];
  const end = endOf(w, row, day) as Schedule['end'];
  const base = {
    origin: 'pipeline' as const,
    pathway: PATHWAYS[p.pathway[row]],
    entered: enteredOf(w, row, day),
    end,
    revisions: revisionsOf(p, row, day),
    existingUnits: p.existing[row]
  };
  if (origin === ORIGIN_PIPELINE) {
    const s: Schedule = {
      projectId: ip.id,
      ...base,
      parcelIds: [...ip.parcelIds],
      multiPhase: ip.multiPhase,
      phase: null
    };
    if (p.isNew[row] === 0) s.inFlight = true;
    return s;
  }
  const i = p.sub[row];
  const phases = ip.phases ?? [];
  const ph = phases[i - 1];
  const filed = p.entered[row * S + PERMIT_FILED];
  const plan = ph.plannedPermitFiled;
  const scheduled = plan !== null && plan > statics.asOf && filed === plan;
  return {
    projectId: `${ip.id}:phase:${i}`,
    ...base,
    parcelIds: [...ph.parcelIds],
    multiPhase: true,
    phase: {
      masterId: ip.id,
      index: i,
      of: phases.length,
      start: scheduled ? 'scheduled' : 'estimated'
    },
    inFlight: true
  };
}

/** A master row as today's `Master`; null for every other row. */
export function masterAt(w: World, statics: Statics, row: number, day: Day): Master | null {
  const p = w.projects;
  if (p.origin[row] !== ORIGIN_MASTER) return null;
  const k = p.src[row];
  const ip = statics.projects[k];
  const phases = ip.phases ?? [];
  const phaseFiled: (Day | null)[] = phases.map(() => null);
  for (let r = row + 1; r < p.n; r++) {
    if (p.origin[r] !== ORIGIN_PHASE || p.src[r] !== k) continue;
    const d = p.entered[r * S + PERMIT_FILED];
    if (d <= day) phaseFiled[p.sub[r] - 1] = d;
  }
  return {
    masterId: ip.id,
    pathway: PATHWAYS[p.pathway[row]],
    entered: enteredOf(w, row, day),
    end: endOf(w, row, day) as Master['end'],
    phaseUnits: phases.map((ph) => ph.units),
    phaseFiled
  };
}
