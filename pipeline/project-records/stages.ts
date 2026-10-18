/**
 * Stage entry dates (spec 4.5): the per-permit and per-project raw dates, the forward clamp over
 * `STAGE_ORDER`, and the stage history of a pipeline-only row.
 */
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type { Pathway, Stage } from '../../src/lib/timelapse/types';
import type { Day } from '../../src/lib/timelapse/time';
import { DISCRETIONARY_CHILD_TYPES } from './classify';
import type { Completion, LinkedProject, Permit, PipelineRow } from './types';

/** Tier 4, made up (spec 4.5 filed (a)): one working week of intake lag around the exact match. */
export const PPA_UMBRELLA_DAYS = 7;

/** Spec 4.5 filed (b): child types that evidence a filing. */
const FILING_CHILD_TYPES: ReadonlySet<string> = new Set([
  'ENV',
  'CUA',
  'VAR',
  'DNX',
  'ENX',
  'OFA',
  'AHB',
  'PHA',
  'DVA',
  'COA',
  'PTA',
  'MAP',
  'PCA',
  'GPA',
  'CTZ'
]);

function minOf(days: Iterable<Day | null>): Day | null {
  let min: Day | null = null;
  for (const d of days) if (d !== null && (min === null || d < min)) min = d;
  return min;
}

function maxOf(days: Iterable<Day | null>): Day | null {
  let max: Day | null = null;
  for (const d of days) if (d !== null && (max === null || d > max)) max = d;
  return max;
}

/**
 * A permit's completion day: its first j67f TCO or CFC with units > 0 (a TCO before a CFC on the
 * same day), else `completed_date` when `status` is `complete`.
 */
export function permitCompletionDay(p: Permit, completions: Completion[]): Day | null {
  let best: { day: Day; kind: 'TCO' | 'CFC' } | null = null;
  for (const c of completions) {
    if (c.permit !== p.number || c.day === null || c.kind === null) continue;
    if (c.units === null || c.units <= 0) continue;
    if (
      best === null ||
      c.day < best.day ||
      (c.day === best.day && c.kind === 'TCO' && best.kind === 'CFC')
    ) {
      best = { day: c.day, kind: c.kind };
    }
  }
  if (best !== null) return best.day;
  return p.status === 'complete' ? p.completedDateDay : null;
}

/**
 * The unit-bearing set (spec 4.2): the live set, else (all permits dead) the non-superseded
 * permits. Units, stories and `unitsAt.permitFiled` read it (Task 7), and so do the
 * `permitIssued` and `construction` raw days (Ruling E1).
 */
export function unitBearingPermits(proj: LinkedProject): Permit[] {
  if (proj.live.length > 0) return proj.live;
  return proj.permits.filter((q) => !proj.superseded.has(q.number));
}

/** The §4.5 rules applied to one permit alone, without a clamp. */
export function permitDays(
  p: Permit,
  completions: Completion[]
): { filed: Day | null; issued: Day | null; construction: Day | null; complete: Day | null } {
  return {
    filed: p.filedDay,
    issued: p.issuedDay,
    construction: p.sitePermit ? p.fcdDay : p.issuedDay,
    complete: permitCompletionDay(p, completions)
  };
}

/** Min of filed evidence (a)-(d), or null. */
export function filedEvidenceDay(proj: LinkedProject): Day | null {
  const ppaOpens = proj.children
    .filter((c) => c.type === 'PPA' && c.openDay !== null)
    .map((c) => c.openDay as Day);
  const candidates: (Day | null)[] = [];
  for (const a of proj.anchors) {
    if (a.openDay === null) continue;
    const open = a.openDay;
    if (ppaOpens.some((ppa) => Math.abs(ppa - open) <= PPA_UMBRELLA_DAYS)) continue;
    candidates.push(open);
  }
  for (const c of proj.children) {
    if (FILING_CHILD_TYPES.has(c.type)) candidates.push(c.openDay);
  }
  for (const r of proj.reviews) candidates.push(r.startDay);
  for (const p of proj.permits) candidates.push(p.filedDay);
  return minOf(candidates);
}

function entitledDay(proj: LinkedProject): Day | null {
  const approvals = minOf(
    proj.reviews.filter((r) => r.endType === 'approval').map((r) => r.endDay)
  );
  if (approvals !== null) return approvals;
  const decided = minOf(
    proj.anchors.filter((a) => a.decision === 'Approved').map((a) => a.decisionDay)
  );
  if (decided !== null) return decided;
  // Not from a row linked under DQ-2 (spec 4.2 step 10).
  const planning = minOf(
    proj.pipelineRows.filter((r) => !r.linkedNoDate).map((r) => r.approvedDay)
  );
  if (planning !== null) return planning;
  return maxOf(
    proj.children
      .filter(
        (c) =>
          c.type !== 'PPA' &&
          DISCRETIONARY_CHILD_TYPES.has(c.type) &&
          c.status !== null &&
          /Approved/.test(c.status)
      )
      .map((c) => c.closeDay)
  );
}

/**
 * Raw stage dates (valid dates only). `pathway === null` is treated as discretionary; `permitOnly`
 * has no `filed` or `entitled`.
 */
export function rawStages(
  proj: LinkedProject,
  pathway: Pathway | null
): Partial<Record<Stage, Day>> {
  const raw: Partial<Record<Stage, Day>> = {};
  const permitOnly = pathway === 'permitOnly';

  const filed = permitOnly ? null : filedEvidenceDay(proj);
  const ppa = minOf(proj.children.filter((c) => c.type === 'PPA').map((c) => c.openDay));
  if (ppa !== null && (filed === null || ppa < filed)) raw.preApplication = ppa;
  if (filed !== null) raw.filed = filed;

  const entitled = permitOnly ? null : entitledDay(proj);
  if (entitled !== null) raw.entitled = entitled;

  // Ruling E1: a project whose permits all died still enters permitIssued and construction from
  // its non-superseded permits, so its permit exit (spec 4.6 rule 2) lands at that stage.
  const bearing = unitBearingPermits(proj);
  const issued = minOf(bearing.map((p) => p.issuedDay));
  const permitFiled = minOf(proj.permits.map((p) => p.filedDay));
  // A permit filed in parallel with Planning review leaves a discretionary project at `filed`.
  if (permitFiled !== null && (permitOnly || entitled !== null || issued !== null)) {
    raw.permitFiled = permitFiled;
  }
  if (issued !== null) raw.permitIssued = issued;

  const construction = minOf(bearing.map((p) => permitDays(p, proj.completions).construction));
  if (construction !== null) raw.construction = construction;

  if (proj.live.length > 0) {
    const days = proj.live.map((p) => permitCompletionDay(p, proj.completions));
    if (days.every((d) => d !== null)) raw.complete = maxOf(days) as Day;
  }

  const ordered: Partial<Record<Stage, Day>> = {};
  for (const s of STAGE_ORDER) if (raw[s] !== undefined) ordered[s] = raw[s];
  return ordered;
}

/**
 * Forward clamp: walk `STAGE_ORDER` and set `entered[s] = max(raw[s], max earlier entered)`.
 * `clamped` lists the stages whose value moved up.
 */
export function clampStages(raw: Partial<Record<Stage, Day>>): {
  entered: Partial<Record<Stage, Day>>;
  clamped: Stage[];
} {
  const entered: Partial<Record<Stage, Day>> = {};
  const clamped: Stage[] = [];
  let floor: Day | null = null;
  for (const s of STAGE_ORDER) {
    const day = raw[s];
    if (day === undefined) continue;
    if (floor !== null && day < floor) {
      entered[s] = floor;
      clamped.push(s);
    } else {
      entered[s] = day;
      floor = day;
    }
  }
  return { entered, clamped };
}

const PIPELINE_STAGE: Record<string, Stage> = {
  'PL Filed': 'filed',
  'PL Approved': 'entitled',
  'BP Filed': 'permitFiled',
  'BP Approved': 'permitFiled',
  'BP Issued': 'permitIssued',
  'BP BP Issued': 'permitIssued',
  Construction: 'construction'
};

/** The stage a pipeline `current_status` maps to (spec 4.5); null for any other status. */
export function pipelineStage(status: string | null): Stage | null {
  if (status === null) return null;
  const s = status.trim();
  // Own keys only: a status such as 'constructor' must not hit Object.prototype.
  return Object.hasOwn(PIPELINE_STAGE, s) ? PIPELINE_STAGE[s] : null;
}

/** Stage history of a pipeline-only row; null when the row is dropped. */
export function pipelineOnlyHistory(row: PipelineRow): Partial<Record<Stage, Day>> | null {
  if (row.statusDay === null) return null;
  const stage = pipelineStage(row.status);
  if (stage === null) return null;
  const history: Partial<Record<Stage, Day>> = {};
  const approved = row.approvedDay;
  const entitledOk = approved !== null && approved <= row.statusDay;
  if (stage === 'entitled') {
    history.entitled = entitledOk ? approved : row.statusDay;
  } else {
    if (entitledOk && STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf('entitled')) {
      history.entitled = approved;
    }
    history[stage] = row.statusDay;
  }
  return history;
}
