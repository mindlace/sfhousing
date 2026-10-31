// TimedPackedCell → per-part GPU attributes (spec §4.1 "Validation", "Encoding", §4.2.1). Pure.
import { TYPOLOGY_ORDER, type TimedPackedCell } from '../types';
import type { PartAttrs, TimelineLookups } from './types';
import { FTF_M, GROUND_FTF_M } from '$lib/generator/constants';
import { MONTH_DAYS, OPEN_DAY } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Pathway, type Stage } from '$lib/timelapse/types';

/** The ghost tint of each stage (spec §5: the one table addenda sub-stages extend). */
export const TINT_GROUP: Record<Stage, 'planning' | 'permit' | 'ready'> = {
  preApplication: 'planning',
  filed: 'planning',
  entitled: 'permit',
  permitFiled: 'permit',
  permitIssued: 'ready',
  construction: 'ready',
  complete: 'ready'
};

const NS = STAGE_ORDER.length;
const PERMIT_STAGES = STAGE_ORDER.map((s, j) => (TINT_GROUP[s] === 'permit' ? j : -1)).filter(
  (j) => j >= 0
);
const PERMIT_ISSUED = STAGE_ORDER.indexOf('permitIssued');
const CONSTRUCTION = STAGE_ORDER.indexOf('construction');
const TALL_GROUND = new Set(
  (['podium', 'midrise', 'tower'] as const).map((t) => TYPOLOGY_ORDER.indexOf(t))
);

/** Throws a `TypeError` naming the cell for each §4.1 validation rule. */
export function validateTimedCell(c: TimedPackedCell): void {
  const slots = c.parcelIds.length;
  const fail = (why: string): never => {
    throw new TypeError(`timeline cell ${c.cellId}: ${why}`);
  };
  const len = (name: string, actual: number, expected: number) => {
    if (actual !== expected) fail(`${name} has length ${actual}, expected ${expected}`);
  };
  len('slotProjectIds', c.slotProjectIds.length, slots);
  len('partWindow', c.partWindow.length, 2 * c.partCount);
  len('slotStages', c.slotStages.length, NS * slots);
  len('slotEnd', c.slotEnd.length, 2 * slots);
  len('slotPathway', c.slotPathway.length, slots);
  len('slotCohort', c.slotCohort.length, slots);
  for (let s = 0; s < slots; s++) {
    if (c.slotPathway[s] > 2) fail(`slot ${s} has pathway index ${c.slotPathway[s]}`);
    if (c.slotCohort[s] > 1) fail(`slot ${s} has cohort ${c.slotCohort[s]}`);
    const kind = c.slotEnd[2 * s + 1];
    if (kind !== 0 && kind !== 1 && kind !== 2) fail(`slot ${s} has end kind ${kind}`);
  }
}

/**
 * Typical days in a stage: months · MONTH_DAYS, floored at 1 day so a fill or floor progress is
 * never 0/0 (ruling R8), or OPEN_DAY if missing, negative or non-finite (progress stays at 0).
 * The bar (`evalBar`) and the floors (`evalPart`, via `encodeParts`) read typical days only here.
 * Cohort 1 (in flight) reads `l.inFlight`, or the fresh set when it is absent (Call 15).
 */
export function typicalDays(
  l: TimelineLookups | null,
  pathway: Pathway,
  stage: Exclude<Stage, 'complete'>,
  cohort: 0 | 1
): number {
  const set = cohort === 1 ? (l?.inFlight ?? l) : l;
  const months = set?.typicalMonths[pathway]?.[stage];
  if (months === undefined || !Number.isFinite(months) || months < 0) return OPEN_DAY;
  return Math.max(months * MONTH_DAYS, 1);
}

export interface EncodedParts {
  tlA: Float32Array; // per part: partFrom, partTo, ghostFrom, endDay
  tlB: Float32Array; // per part: permitDay, readyDay, constructionDay, completeDay
  tlC: Float32Array; // per part: endKind, constructionTypicalDays, stories, groundFtfM
}

const day = (d: number) => (Number.isNaN(d) ? OPEN_DAY : d);

/** Validates the cell, then encodes every part (§4.2.1). NaN days become OPEN_DAY. */
export function encodeParts(c: TimedPackedCell, l: TimelineLookups | null): EncodedParts {
  validateTimedCell(c);
  const slots = c.parcelIds.length;
  // Per-slot values, computed once.
  const slotA = new Float64Array(2 * slots); // ghostFrom, endDay
  const slotB = new Float64Array(4 * slots); // permitDay, readyDay, constructionDay, completeDay
  const slotC = new Float64Array(3 * slots); // endKind, constructionTypicalDays, stories
  for (let s = 0; s < slots; s++) {
    const stage = (j: number) => day(c.slotStages[NS * s + j]);
    let ghostFrom = OPEN_DAY;
    for (let j = 0; j < NS; j++) ghostFrom = Math.min(ghostFrom, stage(j));
    let permitDay = OPEN_DAY;
    for (const j of PERMIT_STAGES) permitDay = Math.min(permitDay, stage(j));
    const endDay = day(c.slotEnd[2 * s]);
    const endKind = c.slotEnd[2 * s + 1];
    slotA.set([ghostFrom, endDay], 2 * s);
    slotB.set(
      [permitDay, stage(PERMIT_ISSUED), stage(CONSTRUCTION), endKind === 1 ? endDay : OPEN_DAY],
      4 * s
    );
    slotC.set(
      [
        endKind,
        typicalDays(l, PATHWAYS[c.slotPathway[s]], 'construction', c.slotCohort[s] as 0 | 1),
        c.parcelMeta[4 * s + 2]
      ],
      3 * s
    );
  }
  const n = c.partCount;
  const tlA = new Float32Array(4 * n);
  const tlB = new Float32Array(4 * n);
  const tlC = new Float32Array(4 * n);
  for (let k = 0; k < n; k++) {
    const s = c.partSlot[k];
    tlA.set(
      [day(c.partWindow[2 * k]), day(c.partWindow[2 * k + 1]), slotA[2 * s], slotA[2 * s + 1]],
      4 * k
    );
    tlB.set(slotB.subarray(4 * s, 4 * s + 4), 4 * k);
    tlC.set(slotC.subarray(3 * s, 3 * s + 3), 4 * k);
    tlC[4 * k + 3] = TALL_GROUND.has(c.partTypology[k]) ? GROUND_FTF_M : FTF_M;
  }
  return { tlA, tlB, tlC };
}

/** Part `k`'s attributes as numbers (the Float32 values the GPU sees). */
export function partAttrs(e: EncodedParts, k: number): PartAttrs {
  const o = 4 * k;
  const { tlA: a, tlB: b, tlC: c } = e;
  return {
    partFrom: a[o],
    partTo: a[o + 1],
    ghostFrom: a[o + 2],
    endDay: a[o + 3],
    permitDay: b[o],
    readyDay: b[o + 1],
    constructionDay: b[o + 2],
    completeDay: b[o + 3],
    endKind: c[o],
    constructionTypicalDays: c[o + 1],
    stories: c[o + 2],
    groundFtfM: c[o + 3]
  };
}
