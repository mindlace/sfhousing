/**
 * deriveProjects (spec 2 internal types, 4.2-4.10): parse, link, per-project stages, ends, units
 * and population, the in-flight set, PRX master phasing, RHNA, then the ordered T3 file, the T4d
 * histories, the permits rows, report counts and the V21-V24 inputs. Pure and deterministic: raw
 * row order never matters (parseAll sorts canonically) and every iteration is over sorted keys.
 *
 * T14 (spec 4.11): each `pr.*` rule has one tally function below (`PR_TALLIES`), and each rule
 * that marks records adds its id to `Assessed.quality` where it acts; deriveProjects records every
 * tally once through `recordQuality` into the caller's counts.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import { recordQuality } from '../lib/quality';
import { PR, PR_RULES, type PrRuleId } from '../lib/quality-rules/pr';
import type { InFlightProject, ProjectsFile } from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '../../src/lib/timelapse/types';
import type {
  Pathway,
  ProjectHistoriesFile,
  ProjectHistory,
  Stage
} from '../../src/lib/timelapse/types';
import {
  cmp,
  descendantWarnings,
  historyQuality,
  inStageOrder,
  masterDa,
  orderHistoriesFile,
  orderProject,
  orderProjectsFile,
  permitRows,
  phaseMasters,
  projectQuality,
  qualityRulesOf,
  shareExisting,
  type PermitOut
} from './assemble';
import { REFERRAL_TOLERANCE_DAYS, pathwayOf } from './classify';
import { endOf } from './ends';
import {
  applyCapacity,
  baseStoriesAt,
  existingUnitsAt,
  grossUnits,
  inFlightStatus,
  isPopulation,
  labelOf,
  pipelineConflict,
  rollYearOf,
  sourcesOf,
  storiesDetail,
  unitsAt,
  type Capacity,
  type InFlightStatus
} from './inflight';
import type { V2xInputs } from './invariants';
import { linkProjects } from './link';
import { checkMultiphaseFile, netMasters, type Netting } from './multiphase';
import { linkNoDateRows, rowKey } from './nodate';
import { resolveParcels } from './parcels';
import { parseAll } from './parse';
import { rhnaCompletedNet } from './rhna';
import {
  PPA_UMBRELLA_DAYS,
  clampStages,
  filedEvidenceDay,
  pipelineOnlyHistory,
  rawStages
} from './stages';
import type { LinkedProject, Parsed, PipelineRow, ProjectRecordsInput } from './types';

export type { PermitOut } from './assemble';

export interface DeriveResult {
  histories: ProjectHistory[];
  file: ProjectsFile;
  permits: PermitOut[];
  /** The caller's `opts.counts` (else a fresh object), with this run's counts written into it. */
  counts: Record<string, number>;
  warnings: string[];
  checks: V2xInputs;
}

/** Minified `projects.json`: T3 key order, `history` in `STAGE_ORDER`. */
export function serializeProjects(f: ProjectsFile): string {
  return JSON.stringify(orderProjectsFile(f));
}

/** Minified `project-histories.json`: T4d key order, stage maps in `STAGE_ORDER`, end `kind` first. */
export function serializeHistories(f: ProjectHistoriesFile): string {
  return JSON.stringify(orderHistoriesFile(f));
}

type Entered = Partial<Record<Stage, Day>>;
type Status = InFlightStatus | 'noDates';

const STATUSES: readonly Status[] = [
  'inFlight',
  'staleOpen',
  'netDropped',
  'ended',
  'noUnits',
  'noParcels',
  'notPopulation',
  'noDates'
];

/** Above this, `rhna.xdhtLagDays` warns (spec 4.9). */
const XDHT_LAG_WARN_DAYS = 120;

/** One linked project after stages, end, units and the population / in-flight decision. */
interface Assessed {
  /** The project after `pr.units.capacity`: a failing permit has null units. */
  proj: LinkedProject;
  /** Spec 4.8 capacity: the permits checked and the ones that failed (original units). */
  capacity: Pick<Capacity, 'checked' | 'failing'>;
  pathway: Pathway | null;
  entered: Entered;
  /** Null for pipeline-only projects (they have no history). */
  end: ProjectHistory['end'] | null;
  clamped: Stage[];
  units: number | null;
  firstEntered: Day | null;
  rollYear: number;
  existingLatest: number;
  inPopulation: boolean;
  multiPhase: boolean;
  status: Status;
  /** Spec 4.8 stories, with the `pr.stories.parse-range` tally of the texts read. */
  stories: ReturnType<typeof storiesDetail>;
  /** T14 rule ids that changed or estimated one of this project's values (spec 4.11). */
  quality: Set<string>;
}

function firstDay(entered: Entered): Day | null {
  for (const s of STAGE_ORDER) if (entered[s] !== undefined) return entered[s] as Day;
  return null;
}

function lastStage(entered: Entered): Stage {
  let last: Stage | null = null;
  for (const s of STAGE_ORDER) if (entered[s] !== undefined) last = s;
  return last as Stage;
}

/** Every parsed record a project holds (spec 4.1: the records `pr.date.valid-range` marks). */
// Matched against `Parsed.clipped` by identity: linkProjects must pass the parsed objects through.
function heldRecords(proj: LinkedProject): object[] {
  return [
    ...proj.anchors,
    ...proj.satellites,
    ...proj.children,
    ...proj.sourceOnlyChildren,
    ...proj.reviews,
    ...proj.permits,
    ...proj.completions,
    ...proj.pipelineRows
  ];
}

/** Spec 4.7 in-flight decision; a population project with no entered stage is `noDates`. */
function statusOf(
  proj: LinkedProject,
  a: Pick<
    Assessed,
    'inPopulation' | 'end' | 'units' | 'existingLatest' | 'firstEntered' | 'multiPhase'
  >,
  pipelineCutoff: Day
): Status {
  if (a.inPopulation && a.firstEntered === null) return 'noDates';
  return inFlightStatus(proj, { ...a, pipelineCutoff });
}

function assess(
  cap: Capacity,
  input: ProjectRecordsInput,
  parsed: Parsed,
  ppaLag: number,
  pipelineCutoff: Day
): Assessed {
  const { proj } = cap;
  const pathway = pathwayOf(proj);
  const pipelineOnly = proj.kind === 'pipelineOnly';
  let entered: Entered;
  let clamped: Stage[] = [];
  if (pipelineOnly) {
    entered = pipelineOnlyHistory(proj.pipelineRows[0]) ?? {};
  } else {
    ({ entered, clamped } = clampStages(rawStages(proj, pathway)));
  }
  const end = pipelineOnly ? null : endOf(proj, entered, { asOf: input.asOf, ppaLag });
  const units = grossUnits(proj);
  const firstEntered = firstDay(entered);
  const rollYear =
    firstEntered === null ? input.latestRollYear : rollYearOf(firstEntered, input.latestRollYear);
  const existingAtFiling = existingUnitsAt(proj.parcelIds, rollYear, input.assessorUnits);
  const existingLatest = existingUnitsAt(proj.parcelIds, input.latestRollYear, input.assessorUnits);
  const inPopulation = isPopulation(proj, units, existingAtFiling);
  // A PRX row joined to a fetched permit is an ordinary graph project (Ruling F1).
  const multiPhase = pipelineOnly && proj.pipelineRows[0].prx;
  const status = statusOf(
    proj,
    { inPopulation, end, units, existingLatest, firstEntered, multiPhase },
    pipelineCutoff
  );
  const stories = storiesDetail(proj);
  const quality = new Set<string>();
  // `parsed.clipped` holds the records as parsed, so read them off the project as linked.
  if (heldRecords(cap.original).some((r) => parsed.clipped.has(r))) quality.add(PR.dateValidRange);
  if (clamped.length > 0) quality.add(PR.stagesForwardClamp);
  if (stories.discarded > 0) quality.add(PR.storiesParseRange);
  if (cap.failing.length > 0) quality.add(PR.unitsCapacity);
  return {
    proj,
    capacity: { checked: cap.checked, failing: cap.failing },
    pathway,
    entered,
    end,
    clamped,
    units,
    firstEntered,
    rollYear,
    existingLatest,
    inPopulation,
    multiPhase,
    status,
    stories,
    quality
  };
}

function history(a: Assessed, input: ProjectRecordsInput): ProjectHistory {
  const at = unitsAt(a.proj);
  if (a.entered.complete === undefined) delete at.complete;
  return {
    id: a.proj.id,
    pathway: a.pathway,
    parcelIds: [...a.proj.parcelIds],
    entered: inStageOrder(a.entered),
    end: a.end as ProjectHistory['end'],
    unitsAt: inStageOrder(at),
    existingUnits: existingUnitsAt(a.proj.parcelIds, a.rollYear, input.assessorUnits),
    storiesProposed: a.stories.stories,
    baseStoriesAtFiling: baseStoriesAt(a.proj.parcelIds, a.rollYear, input.baseStories),
    sources: sourcesOf(a.proj),
    quality: historyQuality(a.quality)
  };
}

/** One rule's `recordQuality` input; `sample` is the affected ids (recordQuality sorts them). */
interface Tally {
  fired: number;
  of: number;
  units?: number;
  unitsOf?: number;
  sample: string[];
}

/** What the tallies read: the run's parse, assessed projects and outputs. */
interface TallyInput {
  parsed: Parsed;
  assessed: readonly Assessed[];
  /** Assessed projects that became a history. */
  withHistory: readonly Assessed[];
  /** Assessed projects that became a T3 project, with it. */
  inFlight: readonly { a: Assessed; p: InFlightProject }[];
  /**
   * DQ-2 (spec 4.2 step 10): the no-date rows joined to a project (by the joined project's id)
   * and the ones dropped (by their `CASE:` id).
   */
  noDate: {
    linked: readonly { id: string; row: PipelineRow }[];
    dropped: readonly { id: string; row: PipelineRow }[];
  };
  /** Spec 4.10.2 DA netting of every master in flight before netting, in id order. */
  netting: readonly Netting[];
}

/** Σ of the positive values; null and negative count as 0. */
function positiveSum(xs: Iterable<number | null>): number {
  let s = 0;
  for (const x of xs) if (x !== null && x > 0) s += x;
  return s;
}

/**
 * One tally per `pr.*` rule (spec 4.11 `of` column and on-records text). A later task that gives a
 * rule its behaviour replaces that rule's entry; the record ids it marks go in `Assessed.quality`.
 */
const PR_TALLIES: Record<PrRuleId, (t: TallyInput) => Tally> = {
  // Spec 4.1: non-empty date values parsed; values treated as missing; source record ids.
  [PR.dateValidRange]: ({ parsed }) => ({ ...parsed.dates }),
  // Spec 4.8: story values parsed from text, over the projects that became a record; values
  // outside 1..80 discarded; their project ids.
  [PR.storiesParseRange]: ({ withHistory, inFlight }) => {
    const recorded = new Set<Assessed>([...withHistory, ...inFlight.map((x) => x.a)]);
    let fired = 0;
    let of = 0;
    const sample: string[] = [];
    for (const a of recorded) {
      of += a.stories.parsed;
      fired += a.stories.discarded;
      if (a.stories.discarded > 0) sample.push(a.proj.id);
    }
    return { fired, of, sample };
  },
  // Spec 4.5: histories with at least one clamped stage, of histories.total.
  [PR.stagesForwardClamp]: ({ withHistory }) => {
    const sample = withHistory.filter((a) => a.clamped.length > 0).map((a) => a.proj.id);
    return { fired: sample.length, of: withHistory.length, sample };
  },
  // Spec 4.8 capacity: permits with recorded stories and units on a project with parcels; the
  // ones above their lot's physical limit; both weighted by their proposed units. The sample is
  // the affected project ids (a rule acting after linking, spec 2), so it is never longer than
  // `fired`.
  [PR.unitsCapacity]: ({ assessed }) => {
    const checked = assessed.flatMap((a) => a.capacity.checked);
    const failing = assessed.flatMap((a) => a.capacity.failing);
    return {
      fired: failing.length,
      of: checked.length,
      units: positiveSum(failing.map((q) => q.proposedUnits)),
      unitsOf: positiveSum(checked.map((q) => q.proposedUnits)),
      sample: assessed.filter((a) => a.capacity.failing.length > 0).map((a) => a.proj.id)
    };
  },
  // Spec 4.2 step 10: no-date rows linked to the Planning record on their lot, those whose
  // project has no units included. Of pipeline rows, weighted by new units; the sample is the
  // joined project ids (one linked row per project, so never longer than `fired`).
  [PR.pipelineStatusDateLinked]: ({ parsed, noDate }) => ({
    fired: noDate.linked.length,
    of: parsed.pipeline.length,
    units: positiveSum(noDate.linked.map((x) => x.row.newUnits)),
    unitsOf: positiveSum(parsed.pipeline.map((r) => r.newUnits)),
    sample: [...new Set(noDate.linked.map((x) => x.id))]
  }),
  // Spec 4.2 step 10: no-date rows dropped (no candidate, or the winner already holds a row). Of
  // pipeline rows, weighted by new units; the sample is their `CASE:` ids.
  [PR.pipelineNoStatusDate]: ({ parsed, noDate }) => ({
    fired: noDate.dropped.length,
    of: parsed.pipeline.length,
    units: positiveSum(noDate.dropped.map((x) => x.row.newUnits)),
    unitsOf: positiveSum(parsed.pipeline.map((r) => r.newUnits)),
    sample: noDate.dropped.map((x) => x.id)
  }),
  // Spec 4.7 (observe; no record carries it): population projects matching at least one pipeline
  // row (pipeline-only projects are rows, not matches); conflicts are matched projects whose
  // history ends complete or exit (`pipelineConflict`).
  [PR.pipelineRecordsWin]: ({ assessed }) => {
    const matched = assessed.filter(
      (a) => a.inPopulation && a.proj.kind !== 'pipelineOnly' && a.proj.pipelineRows.length > 0
    );
    const sample = matched.filter((a) => pipelineConflict(a.proj, a.end)).map((a) => a.proj.id);
    return { fired: sample.length, of: matched.length, sample };
  },
  // Spec 4.8 shared parcels: of in-flight projects; the ones on a parcel with units > 0 that
  // another in-flight project is also on (they carry the id); their ids.
  [PR.parcelsSharedExisting]: ({ inFlight }) => {
    const sample = inFlight
      .filter((x) => x.p.quality.includes(PR.parcelsSharedExisting))
      .map((x) => x.p.id);
    return { fired: sample.length, of: inFlight.length, sample };
  },
  // Spec 4.10.2 DQ-3: in-flight PRX masters after netting; the score-only ones (they carry the
  // id); both weighted by R after netting (their T3 units); their ids.
  [PR.multiphaseScoreOnly]: ({ inFlight }) => {
    const masters = inFlight.filter((x) => x.p.multiPhase);
    const scoreOnly = masters.filter((x) => x.p.quality.includes(PR.multiphaseScoreOnly));
    return {
      fired: scoreOnly.length,
      of: masters.length,
      units: positiveSum(scoreOnly.map((x) => x.p.units)),
      unitsOf: positiveSum(masters.map((x) => x.p.units)),
      sample: scoreOnly.map((x) => x.p.id)
    };
  },
  // Spec 4.10.2 DA netting: in-flight PRX masters before netting; the ones with a reduction > 0
  // (they carry the id); units netted, of Σ R before netting; their ids.
  [PR.multiphaseDaNetting]: ({ netting }) => {
    const netted = netting.filter((n) => n.after < n.before);
    return {
      fired: netted.length,
      of: netting.length,
      units: positiveSum(netted.map((n) => n.before - n.after)),
      unitsOf: positiveSum(netting.map((n) => n.before)),
      sample: netted.map((n) => n.id)
    };
  }
};

function zeroCounts(): Record<string, number> {
  const c: Record<string, number> = {
    'projects.inFlight': 0,
    'projects.inFlightUnits': 0
  };
  for (const p of PATHWAYS) c[`projects.byPathway.${p}`] = 0;
  for (const s of STAGE_ORDER) c[`projects.byStage.${s}`] = 0;
  for (const s of STATUSES) c[`projects.status.${s}`] = 0;
  for (const k of [
    'projects.staleOpen',
    'projects.staleOpenUnits',
    'projects.pathwayDefaulted',
    'projects.excludedAlterationUnits',
    'projects.excludedNoUnits',
    'projects.netDropped',
    'projects.stories.tier0',
    'projects.stories.tier3',
    'projects.stories.null',
    'projects.parcels.mapped',
    'projects.parcels.unmapped',
    'histories.total',
    'histories.droppedNoDates'
  ]) {
    c[k] = 0;
  }
  for (const k of [
    'multiphase.enriched',
    'multiphase.fallback',
    'multiphase.lastResort',
    'multiphase.merged',
    'multiphase.nettedOut',
    'multiphase.phases.enriched',
    'multiphase.phases.fallback',
    'multiphase.scoreOnly'
  ]) {
    c[k] = 0;
  }
  return c;
}

/**
 * `opts.counts` is the build's single report counts (T14): every count of this run, the `pr.*`
 * rules' `recordQuality` rows included, is written into it. Each rule is recorded once per counts
 * object, so a rerun needs a fresh one.
 */
export function deriveProjects(
  input: ProjectRecordsInput,
  opts: { counts?: Record<string, number> } = {}
): DeriveResult {
  const { asOf } = input;
  const warnings: string[] = [];
  const parsed = parseAll(input.raw, asOf);
  const resolve = (blklots: string[]) => resolveParcels(blklots, input).ids;
  const link = linkProjects(parsed, { resolve, filedDay: filedEvidenceDay });
  const counts = Object.assign(opts.counts ?? {}, zeroCounts());

  // A curated entry for a PRX row that joined its permit's project is valid but unused.
  const curatedCases = new Set(input.multiphase.projects.map((e) => e.caseNo));
  const joinedPrx: string[] = [];
  for (const proj of link.projects) {
    if (proj.kind !== 'graph') continue;
    for (const r of proj.pipelineRows) {
      if (r.prx && r.caseNo !== null && curatedCases.has(r.caseNo)) {
        joinedPrx.push(`${r.caseNo}: PRX row joins permit ${r.bpaNo}; multiphase entry unused`);
      }
    }
  }
  warnings.push(...joinedPrx.sort(cmp));

  // Parcels: per distinct candidate block-lot across all projects.
  const candidates = new Set<string>();
  for (const proj of link.projects) for (const b of proj.blklots) candidates.add(b);
  const parcelStats = resolveParcels([...candidates].sort(cmp), input);
  counts['projects.parcels.mapped'] = parcelStats.mapped;
  counts['projects.parcels.unmapped'] = parcelStats.unmapped;

  // pipelineCutoff: max valid status day over all pipeline rows (asOf when there is none).
  let cutoff: Day | null = null;
  for (const r of parsed.pipeline) {
    if (r.statusDay !== null && (cutoff === null || r.statusDay > cutoff)) cutoff = r.statusDay;
  }
  if (cutoff === null) warnings.push('pipeline has no valid current_status_date; cutoff = asOf');
  const pipelineCutoff = cutoff ?? asOf;

  // Spec 4.8 capacity, once per permit before anything reads units: units rule 1, unitsAt, the
  // phase-size medians and the permits rows all see `capped`, never `link.projects`.
  const capped = link.projects.map((p) => applyCapacity(p, input.areaM2));
  const linked = capped.map((c) => c.proj);
  const all = capped.map((c) => assess(c, input, parsed, link.ppaLag.days, pipelineCutoff));

  // DQ-2 (spec 4.2 step 10), once every graph project's end is known: each pipeline-only row
  // with no valid status date joins the open PRJ on its lot, or is dropped. A linked row leaves
  // `assessed`; its project keeps its id, dates, units, label and parcels, and is re-decided with
  // the row as a pipeline match (4.7). Units and population stay those of 4.8 rules 1-2: a winner
  // holds no other row, so rule 3 had nothing to read.
  const noDateRows = all
    .filter((a) => a.proj.kind === 'pipelineOnly' && a.proj.pipelineRows[0].statusDay === null)
    .map((a) => ({ id: a.proj.id, row: a.proj.pipelineRows[0] }));
  const dq2 = linkNoDateRows(
    noDateRows,
    all.map((a) => ({ a, proj: a.proj, open: a.end?.kind === 'open' })),
    resolve
  );
  const linkedIds = new Set(dq2.linked.map((x) => x.from.id));
  const assessed = all.filter((a) => !linkedIds.has(a.proj.id));
  const dq2Warnings = dq2.dropped.map((x) => x.warning);
  for (const { from, target, recordId } of dq2.linked) {
    const { a } = target;
    const row: PipelineRow = { ...from.row, linkedNoDate: true };
    a.proj = { ...a.proj, pipelineRows: [...a.proj.pipelineRows, row] };
    a.status = statusOf(a.proj, a, pipelineCutoff);
    a.quality.add(PR.pipelineStatusDateLinked);
    // The row is held now, so a date the parse clipped from it marks the project (spec 4.1).
    if (parsed.clipped.has(from.row)) a.quality.add(PR.dateValidRange);
    const caseNo = rowKey(from.row);
    if (!a.inPopulation) {
      dq2Warnings.push(`${caseNo}: linked to ${recordId} with no units; excluded`);
    }
    if (from.row.prx && curatedCases.has(caseNo)) {
      dq2Warnings.push(`${caseNo}: linked to ${recordId}; multiphase entry unused`);
    }
  }
  warnings.push(...dq2Warnings.sort(cmp));
  const noDate = {
    linked: dq2.linked.map((x) => ({ id: x.target.a.proj.id, row: x.from.row })),
    dropped: dq2.dropped.map((x) => x.from)
  };

  // Histories: population projects that are not pipeline-only, with at least one entered stage.
  const histories: ProjectHistory[] = [];
  const withHistory: Assessed[] = [];
  for (const a of assessed) {
    if (a.proj.kind === 'pipelineOnly' || !a.inPopulation) continue;
    if (a.firstEntered === null) {
      counts['histories.droppedNoDates']++;
      continue;
    }
    withHistory.push(a);
    histories.push(history(a, input));
  }

  // Spec 4.10.2 DA netting, before phasing, in master id order (assessed is in id order). The
  // netting projects are in-flight non-masters matching no pipeline row once DQ-2 has run (a
  // linked row is a match). A master netted to 0 fails the has-units test (4.7): it leaves flight
  // with status noUnits, and its parcels exclude nothing.
  const postDq2 = assessed.map((a) => a.proj);
  const daCtx = {
    projects: postDq2,
    pipeline: parsed.pipeline,
    multiphase: input.multiphase,
    resolve,
    descendants: input.descendants
  };
  const masters = assessed
    .filter((a) => a.status === 'inFlight' && a.multiPhase)
    .map((a) => ({ a, da: masterDa(a.proj, daCtx) }));
  // Main's ruling 3: per-master descendant counts.
  const nonMasters = assessed.filter((a) => a.status === 'inFlight' && !a.multiPhase);
  for (const { a, da } of masters) {
    const caseNo = a.proj.pipelineRows[0].caseNo as string;
    counts[`multiphase.descendants.${caseNo}`] = da.descendants.length;
  }
  const netting = netMasters(
    masters.map(({ a, da }) => ({ id: a.proj.id, units: a.units ?? 0, daParcels: da.daParcels })),
    nonMasters
      .filter((a) => a.proj.pipelineRows.length === 0)
      .map((a) => ({ id: a.proj.id, units: a.units ?? 0, parcelIds: a.proj.parcelIds }))
  );
  // Main's ruling 3 flag, after netting (Ruling B2): descendants held by non-DA projects, skipping
  // the projects that netted the master (they are DA-related by construction).
  const holders = nonMasters.map((x) => x.proj);
  masters.forEach(({ a, da }, k) => {
    const caseNo = a.proj.pipelineRows[0].caseNo as string;
    warnings.push(...descendantWarnings(caseNo, da, holders, new Set(netting[k].by)));
  });
  const nettedR = new Map(netting.map((n) => [n.id, n.after]));
  const nettedOut = new Set<string>();
  masters.forEach(({ a }, k) => {
    const n = netting[k];
    const caseNo = a.proj.pipelineRows[0].caseNo as string;
    counts[`multiphase.netted.${caseNo}`] = n.before - n.after;
    if (n.after < n.before) a.quality.add(PR.multiphaseDaNetting);
    if (n.after === 0) {
      nettedOut.add(a.proj.id);
      a.status = 'noUnits';
      counts['multiphase.nettedOut']++;
      warnings.push(`${caseNo}: netted to 0 by ${n.by.join(', ')}; not in flight`);
    }
  });

  // Population / in-flight bookkeeping.
  let excludedAlterationUnits = 0;
  let excludedNoUnits = 0;
  for (const r of link.excludedRows) excludedAlterationUnits += r.newUnits ?? 0;
  for (const a of assessed) {
    counts[`projects.status.${a.status}`]++;
    if (!a.inPopulation) {
      // A DQ-2 linked row on a project outside the population counts apart (spec 4.3).
      for (const r of a.proj.pipelineRows) {
        if (r.linkedNoDate) excludedNoUnits += r.newUnits ?? 0;
        else excludedAlterationUnits += r.newUnits ?? 0;
      }
      continue;
    }
    if (a.status === 'staleOpen') {
      counts['projects.staleOpen']++;
      counts['projects.staleOpenUnits'] += a.units ?? 0;
    }
    if (a.status === 'netDropped') counts['projects.netDropped']++;
  }
  counts['projects.excludedAlterationUnits'] = excludedAlterationUnits;
  counts['projects.excludedNoUnits'] = excludedNoUnits;

  // Masters are phased after the non-master in-flight set is fixed.
  const inFlight = assessed.filter((a) => a.status === 'inFlight');
  const excluded = new Set<ParcelId>();
  for (const a of inFlight) if (!a.multiPhase) for (const id of a.proj.parcelIds) excluded.add(id);
  for (const h of histories) {
    if (h.end.kind === 'complete') for (const id of h.parcelIds) excluded.add(id);
  }
  const inFlightMasters = masters.filter(({ a }) => !nettedOut.has(a.proj.id));
  const masterOut = phaseMasters({
    masters: inFlightMasters.map(({ a, da }) => ({
      proj: a.proj,
      entitled: a.entered.entitled ?? null,
      units: nettedR.get(a.proj.id) as number,
      da
    })),
    excluded,
    projects: postDq2,
    multiphase: input.multiphase,
    areaM2: input.areaM2,
    resolve,
    counts,
    warnings
  });

  // T3 projects (assessed is in id order).
  const projects: InFlightProject[] = [];
  const t3: { a: Assessed; p: InFlightProject }[] = [];
  const entries = new Map(input.multiphase.projects.map((e) => [e.caseNo, e]));
  for (const a of inFlight) {
    const m = masterOut.byId.get(a.proj.id);
    const parcelIds = m ? m.parcelIds : [...a.proj.parcelIds];
    const caseNo = a.proj.pipelineRows[0]?.caseNo ?? null;
    const curated = a.multiPhase && caseNo !== null ? (entries.get(caseNo)?.label ?? null) : null;
    const pathway = a.pathway ?? 'discretionary';
    if (a.pathway === null) counts['projects.pathwayDefaulted']++;
    if (m?.scoreOnly) a.quality.add(PR.multiphaseScoreOnly);
    const { stories, tier } = a.stories;
    const p: InFlightProject = orderProject({
      id: a.proj.id,
      label: labelOf(a.proj, curated),
      parcelIds,
      pathway,
      stage: lastStage(a.entered),
      history: a.entered,
      units: nettedR.get(a.proj.id) ?? (a.units as number),
      existingUnits: m
        ? existingUnitsAt(parcelIds, input.latestRollYear, input.assessorUnits)
        : a.existingLatest,
      stories,
      storiesTier: tier,
      multiPhase: a.multiPhase,
      phases: m ? m.phases : null,
      sources: sourcesOf(a.proj),
      quality: projectQuality(a.quality)
    });
    projects.push(p);
    t3.push({ a, p });
    counts['projects.inFlight']++;
    counts['projects.inFlightUnits'] += p.units;
    counts[`projects.byPathway.${p.pathway}`]++;
    counts[`projects.byStage.${p.stage}`]++;
    counts[`projects.stories.${tier === null ? 'null' : `tier${tier}`}`]++;
  }

  // Spec 4.8 shared parcels, once the set, DA netting and phasing are final: each parcel's
  // assessor units count once, for the project that entered it first. Histories keep their
  // at-filing value and never carry the rule.
  const shared = shareExisting(
    projects,
    (id) => input.assessorUnits(id, input.latestRollYear) ?? 0
  );
  for (let i = 0; i < projects.length; i++) {
    projects[i] = shared[i];
    t3[i] = { a: t3[i].a, p: shared[i] };
  }

  // V21 coverage: pipeline rows of population projects, rows of projects that ended excluded. A
  // master covers its rows with R before netting, even when netted out of flight (the netted units
  // are in flight as other projects). Ruling V1: a row DQ-2 dropped has no project and leaves V21
  // (its T14 rule counts it).
  const droppedIds = new Set(noDate.dropped.map((x) => x.id));
  const coverage = { matchedUnits: 0, rowUnits: 0, rows: 0 };
  for (const a of assessed) {
    if (!a.inPopulation || a.proj.pipelineRows.length === 0) continue;
    if (droppedIds.has(a.proj.id)) continue;
    if (a.end !== null && a.end.kind !== 'open') continue;
    for (const r of a.proj.pipelineRows) {
      coverage.rows++;
      coverage.rowUnits += r.newUnits ?? 0;
    }
    if (a.status === 'inFlight' || nettedOut.has(a.proj.id)) coverage.matchedUnits += a.units ?? 0;
  }

  // RHNA completed net.
  const rhna = rhnaCompletedNet(parsed.housing, asOf);
  counts['rhna.units'] = rhna.value.units;
  for (const y of Object.keys(rhna.byYear)) {
    if (Object.hasOwn(input.hiNet, y)) counts[`rhna.crossCheck.${y}`] = rhna.byYear[Number(y)];
  }
  counts['rhna.xdhtLagDays'] = rhna.lagDays ?? -1;
  if (rhna.lagDays === null) {
    warnings.push('rhna.xdhtLagDays: xdht-4php has no valid first_completion_date');
  } else if (rhna.lagDays > XDHT_LAG_WARN_DAYS) {
    warnings.push(
      `rhna.xdhtLagDays ${rhna.lagDays} > ${XDHT_LAG_WARN_DAYS}: xdht-4php completions look stale`
    );
  }

  counts['histories.total'] = histories.length;
  counts['histories.ppaLagDays'] = Number.isFinite(link.ppaLag.days) ? link.ppaLag.days : -1;
  counts['histories.ppaLagN'] = link.ppaLag.n;
  counts['params.ppaUmbrellaDays'] = PPA_UMBRELLA_DAYS;
  counts['params.ppaUmbrellaDays.tier'] = 4;
  counts['params.referralToleranceDays'] = REFERRAL_TOLERANCE_DAYS;
  counts['params.referralToleranceDays.tier'] = 4;
  counts['pipeline.cutoffDay'] = pipelineCutoff;
  for (const k of Object.keys(link.counts).sort(cmp)) counts[k] = link.counts[k];
  for (const k of Object.keys(parsed.counts).sort(cmp)) counts[k] = parsed.counts[k];

  // T14: every pr.* rule, zeros included, once into the caller's counts (spec 4.11 Counting).
  const tallyInput: TallyInput = {
    parsed,
    assessed,
    withHistory,
    inFlight: t3,
    noDate,
    netting
  };
  for (const r of PR_RULES) recordQuality(counts, r.id, PR_TALLIES[r.id as PrRuleId](tallyInput));

  const file: ProjectsFile = {
    schema: 1,
    asOf,
    rhnaCompletedNet: rhna.value,
    qualityRules: qualityRulesOf(projects),
    projects
  };
  const permits = permitRows(linked, parsed.pipeline, parsed.completions, resolve);

  return {
    histories,
    file,
    permits,
    counts,
    warnings,
    checks: {
      asOf,
      file,
      histories,
      coverage,
      rhna: { byYear: rhna.byYear, total: rhna.value.units },
      multiphase: {
        problems: masterOut.problems,
        fileProblems: checkMultiphaseFile(
          input.multiphase,
          parsed.pipeline.filter((r) => r.prx),
          asOf
        ),
        lastResort: masterOut.lastResort,
        scales: masterOut.scales,
        masters: Object.fromEntries(
          inFlightMasters.map(({ a, da }) => [
            a.proj.id,
            { daParcels: da.daParcels, trackingParcels: da.trackingParcels }
          ])
        )
      }
    }
  };
}
