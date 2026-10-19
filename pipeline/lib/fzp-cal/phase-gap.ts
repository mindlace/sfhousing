/**
 * `phaseGap`: empirical gaps in days between successive phases' permit filings in past
 * multi-phase projects (stage-calibration spec §4.7a, partner rulings round 3, DQ-1).
 */
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import type { Calibration, Day, Provenance } from '../../../src/lib/timelapse/types';
import { datasf } from './provenance';
import type { CalProfile, PermitRow } from './types';
import { PHASE_GAP_START } from './window';

/** Rung 3's made-up gap, in days. */
const LAST_RESORT_DAYS = 730;

const WINDOW_SENTENCE =
  'window 1989-01-01 on, decoupled from the transition windows (2007-01-01 on, set by the first assessor roll): phase gaps use permit filing days only, not existing units';

/** The gaps of one group's filing days: distinct days (same-day = one phase), ascending. */
function gapsOf(days: Day[]): number[] {
  const distinct = [...new Set(days)].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) gaps.push(distinct[i] - distinct[i - 1]);
  return gaps;
}

/** Gaps over every group with at least two phases: `groups` counts those that contribute. */
function collect(byGroup: Iterable<Day[]>): { days: number[]; groups: number } {
  const days: number[] = [];
  let groups = 0;
  for (const filed of byGroup) {
    const gaps = gapsOf(filed);
    if (gaps.length === 0) continue;
    groups++;
    days.push(...gaps);
  }
  days.sort((a, b) => a - b);
  return { days, groups };
}

/** Linear-interpolated quantile of an ascending list. */
function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const fmt = (x: number) => String(Math.round(x * 10) / 10);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function summary(days: number[]): string {
  return `median ${fmt(quantile(days, 0.5))} days, IQR ${fmt(quantile(days, 0.25))} to ${fmt(quantile(days, 0.75))} days`;
}

/**
 * Walks the spec's ladder: DA groups (tier 2), else projects with at least two qualifying permits
 * (tier 2, not DA-specific), else `[730]` (tier 4). A rung passes with `phaseMinGaps` gaps.
 */
export function phaseGap(
  permits: PermitRow[],
  asOf: Day,
  cal: CalProfile
): { phaseGap: Calibration['phaseGap']; rung: 1 | 2 | 3; groups: number } {
  const from = isoToDay(PHASE_GAP_START);
  const qualifying = permits.filter(
    (p) =>
      p.proposed_units !== null &&
      p.proposed_units >= cal.phaseMinUnits &&
      p.filed_day !== null &&
      p.filed_day >= from &&
      p.filed_day <= asOf &&
      p.superseded !== true
  );
  const window: [string, string] = [PHASE_GAP_START, isoOf(asOf)];
  const sources = [datasf('permits'), datasf('planningRecords')];
  const minGaps = Math.max(1, cal.phaseMinGaps);
  const rule = `phases are permits of at least ${cal.phaseMinUnits} units (tier 4) that are not superseded, same-day filings merged into one phase`;

  // Rung 1: one group per DA key = coalesce(prx_case_no, dva_record_id, da).
  const byDa = new Map<string, Day[]>();
  for (const p of qualifying) {
    const key = p.prx_case_no ?? p.dva_record_id ?? p.da;
    if (key === null) continue;
    const list = byDa.get(key);
    if (list) list.push(p.filed_day as Day);
    else byDa.set(key, [p.filed_day as Day]);
  }
  const rung1 = collect(byDa.values());
  if (rung1.days.length >= minGaps) {
    const provenance: Provenance = {
      tier: 2,
      label: 'Gaps between phase permit filings in past SF Development Agreement projects (tier 2)',
      sources,
      method: `${plural(rung1.groups, 'DA group')} with at least two phases, ${plural(rung1.days.length, 'gap')}, ${summary(rung1.days)}; ${rule}; ${WINDOW_SENTENCE}`,
      n: rung1.days.length,
      window
    };
    return { phaseGap: { days: rung1.days, provenance }, rung: 1, groups: rung1.groups };
  }

  // Rung 2: projects with at least two qualifying permits, DA or not.
  const byProject = new Map<string, Day[]>();
  for (const p of qualifying) {
    if (p.project_id === null) continue;
    const list = byProject.get(p.project_id);
    if (list) list.push(p.filed_day as Day);
    else byProject.set(p.project_id, [p.filed_day as Day]);
  }
  const multi = [...byProject.values()].filter((filed) => filed.length >= 2);
  const rung2 = collect(multi);
  if (rung2.days.length >= minGaps) {
    const provenance: Provenance = {
      tier: 2,
      label:
        'Gaps between phase permit filings in past SF multi-building projects (tier 2, not DA-specific)',
      sources,
      method: `not DA-specific: fewer than ${minGaps} gaps from DA groups, so all projects with at least two qualifying permits are used; ${plural(rung2.groups, 'project')} with at least two phases, ${plural(rung2.days.length, 'gap')}, ${summary(rung2.days)}; ${rule}; ${WINDOW_SENTENCE}`,
      n: rung2.days.length,
      window
    };
    return { phaseGap: { days: rung2.days, provenance }, rung: 2, groups: rung2.groups };
  }

  // Rung 3: made up.
  const provenance: Provenance = {
    tier: 4,
    label: `Phase gap of ${LAST_RESORT_DAYS} days (tier 4, made up)`,
    sources,
    method: `made up: no multi-phase history found; every phase with no published schedule waits ${LAST_RESORT_DAYS} days (tier 4)`
  };
  return { phaseGap: { days: [LAST_RESORT_DAYS], provenance }, rung: 3, groups: 0 };
}
