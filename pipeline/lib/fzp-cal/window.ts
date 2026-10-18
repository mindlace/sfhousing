/**
 * Fitting windows (stage-calibration spec §4.4 "Fitting windows", OD-T3 as refined by partner
 * rulings round 3 and DQ-1). Evidence comes from probes verified 2026-10-16 and ruling DQ-1.
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import type { Day } from '../../../src/lib/timelapse/types';
import { CalibrationError, type CalStage, type CoverageRow, type Spell } from './types';

/** Planning-side window start, and every stage's pathway-level start (ruling). */
export const PLANNING_START = '2015-01-01';
/** Permit-side pooled window start: the first assessor roll's lien day (DQ-1). */
export const PERMIT_POOLED_START = '2007-01-01';
/** `phaseGap` keeps its own window: it reads permit filing days only (spec §4.7a). */
export const PHASE_GAP_START = '1989-01-01';
/** Last PPA record date in `y673-d69b`. */
export const PPA_SERIES_END = '2023-07-07';
/** The initiation panel's first and last month (assessor roll years 2007..2025). */
export const PANEL_FIRST_MONTH = '2007-01';
export const PANEL_LAST_MONTH = '2025-12';
/** The Family Zoning Plan's effective date. */
export const LOCAL_PROGRAM_START = '2026-01-12';

const PERMIT_EVIDENCE = (field: string, dense: string) =>
  `first assessor roll's lien day (DQ-1); \`${field}\` dense from ${dense}`;

/** The six rows of the §4.4 window table; the report reprints it. */
export const COVERAGE: readonly CoverageRow[] = [
  {
    stage: 'preApplication',
    side: 'planning',
    pooledStart: PLANNING_START,
    pathwayStart: PLANNING_START,
    entryEnd: PPA_SERIES_END,
    evidence:
      'PPA records `y673-d69b`, 2011-02-11 to **2023-07-07** (`entryEnd`); Planning span from 2015 (ruling)'
  },
  {
    stage: 'filed',
    side: 'planning',
    pooledStart: PLANNING_START,
    pathwayStart: PLANNING_START,
    evidence: 'PRJs with net units ≥ 1: 71 (2013), 158 (2014), 398 (2015)'
  },
  {
    stage: 'entitled',
    side: 'planning',
    pooledStart: PLANNING_START,
    pathwayStart: PLANNING_START,
    evidence: 'approvals `d4jk-jw33`: 182 (2014), 1,328 (2015)'
  },
  {
    stage: 'permitFiled',
    side: 'permit',
    pooledStart: PERMIT_POOLED_START,
    pathwayStart: PLANNING_START,
    evidence: PERMIT_EVIDENCE('filed_date', '1981')
  },
  {
    stage: 'permitIssued',
    side: 'permit',
    pooledStart: PERMIT_POOLED_START,
    pathwayStart: PLANNING_START,
    evidence: PERMIT_EVIDENCE('issued_date', '1981')
  },
  {
    stage: 'construction',
    side: 'permit',
    pooledStart: PERMIT_POOLED_START,
    pathwayStart: PLANNING_START,
    evidence: PERMIT_EVIDENCE('first_construction_document_date', '2000')
  }
];

/** The first day a stage's spells are fitted from, at the pooled or the pathway level. */
export function windowStart(stage: CalStage, level: 'pooled' | 'pathway'): Day {
  const row = COVERAGE.find((r) => r.stage === stage);
  if (!row) throw new CalibrationError(`no fitting window for stage ${stage}`);
  return isoToDay(level === 'pooled' ? row.pooledStart : row.pathwayStart);
}

/**
 * Entries per calendar year of `stage` spells, from `from` to `asOf` (an entry counts in the year
 * of max(e, from); entries after `asOf` are not counted). When `on`, a year with no entry throws
 * `CalibrationError('coverage gap: <stage> <year>')`; when off the counts are still returned.
 */
export function coverageGuard(
  spells: Spell[],
  stage: CalStage,
  from: Day,
  asOf: Day,
  on: boolean
): { perYear: Record<number, number> } {
  const yearOf = (d: Day) => Number(isoOf(d).slice(0, 4));
  const first = yearOf(from);
  const last = yearOf(asOf);
  const perYear: Record<number, number> = {};
  for (let y = first; y <= last; y++) perYear[y] = 0;
  for (const s of spells) {
    if (s.stage !== stage || s.e > asOf) continue;
    const y = yearOf(Math.max(s.e, from));
    if (y in perYear) perYear[y]++;
  }
  if (on) {
    for (let y = first; y <= last; y++) {
      if (perYear[y] === 0) throw new CalibrationError(`coverage gap: ${stage} ${y}`);
    }
  }
  return { perYear };
}
