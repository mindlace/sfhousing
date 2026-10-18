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
  historyQuality,
  inStageOrder,
  orderHistoriesFile,
  orderProject,
  orderProjectsFile,
  permitRows,
  phaseMasters,
  projectQuality,
  qualityRulesOf,
  type PermitOut
} from './assemble';
import { REFERRAL_TOLERANCE_DAYS, pathwayOf } from './classify';
import { endOf } from './ends';
import {
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
  type InFlightStatus
} from './inflight';
import type { V2xInputs } from './invariants';
import { linkProjects } from './link';
import { checkMultiphaseFile } from './multiphase';
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
  proj: LinkedProject;
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

function assess(
  proj: LinkedProject,
  input: ProjectRecordsInput,
  parsed: Parsed,
  ppaLag: number,
  pipelineCutoff: Day
): Assessed {
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
  const status: Status =
    inPopulation && firstEntered === null
      ? 'noDates'
      : inFlightStatus(proj, {
          inPopulation,
          end,
          units,
          existingLatest,
          firstEntered,
          pipelineCutoff,
          multiPhase
        });
  const stories = storiesDetail(proj);
  const quality = new Set<string>();
  if (heldRecords(proj).some((r) => parsed.clipped.has(r))) quality.add(PR.dateValidRange);
  if (clamped.length > 0) quality.add(PR.stagesForwardClamp);
  if (stories.discarded > 0) quality.add(PR.storiesParseRange);
  return {
    proj,
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
}

/** Σ of the positive values; null and negative count as 0. */
function positiveSum(xs: Iterable<number | null>): number {
  let s = 0;
  for (const x of xs) if (x !== null && x > 0) s += x;
  return s;
}

const rowId = (r: PipelineRow) => r.caseNo ?? r.bpaNo;

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
  // Spec 4.8 capacity (behaviour lands with its task): permits with recorded stories and units on
  // a project with parcels, weighted by their proposed units.
  [PR.unitsCapacity]: ({ assessed }) => {
    const checked = assessed
      .filter((a) => a.proj.kind === 'graph' && a.proj.parcelIds.length > 0)
      .flatMap((a) => a.proj.permits)
      .filter((q) => q.stories !== null && q.proposedUnits !== null);
    return {
      fired: 0,
      of: checked.length,
      units: 0,
      unitsOf: positiveSum(checked.map((q) => q.proposedUnits)),
      sample: []
    };
  },
  // Spec 4.2 step 10 (behaviour lands with its task): pipeline rows, weighted by new units.
  [PR.pipelineStatusDateLinked]: ({ parsed }) => ({
    fired: 0,
    of: parsed.pipeline.length,
    units: 0,
    unitsOf: positiveSum(parsed.pipeline.map((r) => r.newUnits)),
    sample: []
  }),
  // Spec 4.2 step 10: a pipeline-only row with no valid status date is dropped (today every such
  // row; DQ-2 linking lands with its task). Of pipeline rows, weighted by new units.
  [PR.pipelineNoStatusDate]: ({ parsed, assessed }) => {
    const dropped = assessed
      .filter((a) => a.proj.kind === 'pipelineOnly' && a.proj.pipelineRows[0].statusDay === null)
      .map((a) => a.proj.pipelineRows[0]);
    return {
      fired: dropped.length,
      of: parsed.pipeline.length,
      units: positiveSum(dropped.map((r) => r.newUnits)),
      unitsOf: positiveSum(parsed.pipeline.map((r) => r.newUnits)),
      sample: dropped.map(rowId).filter((id): id is string => id !== null)
    };
  },
  // Spec 4.7 (observe; no record carries it): population projects matching at least one pipeline
  // row (pipeline-only projects are rows, not matches); conflicts per `pipelineConflict`.
  [PR.pipelineRecordsWin]: ({ assessed }) => {
    const matched = assessed.filter(
      (a) => a.inPopulation && a.proj.kind !== 'pipelineOnly' && a.proj.pipelineRows.length > 0
    );
    const sample = matched
      .filter((a) => pipelineConflict(a.proj, a.end, a.entered))
      .map((a) => a.proj.id);
    return { fired: sample.length, of: matched.length, sample };
  },
  // Spec 4.8 shared parcels (behaviour lands with its task): of in-flight projects.
  [PR.parcelsSharedExisting]: ({ inFlight }) => ({ fired: 0, of: inFlight.length, sample: [] }),
  // Spec 4.10.2 DQ-3 (behaviour lands with its task): in-flight PRX masters after netting,
  // weighted by their R after netting.
  [PR.multiphaseScoreOnly]: ({ inFlight }) => {
    const masters = inFlight.filter((x) => x.p.multiPhase);
    return {
      fired: 0,
      of: masters.length,
      units: 0,
      unitsOf: positiveSum(masters.map((x) => x.p.units)),
      sample: []
    };
  },
  // Spec 4.10.2 DA netting (behaviour lands with its task): in-flight PRX masters before netting,
  // weighted by R before netting (the row's new units).
  [PR.multiphaseDaNetting]: ({ assessed }) => {
    const masters = assessed.filter((a) => a.status === 'inFlight' && a.multiPhase);
    return {
      fired: 0,
      of: masters.length,
      units: 0,
      unitsOf: positiveSum(masters.map((a) => a.units)),
      sample: []
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
    'multiphase.phases.enriched',
    'multiphase.phases.fallback'
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

  const assessed = link.projects.map((p) =>
    assess(p, input, parsed, link.ppaLag.days, pipelineCutoff)
  );

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

  // Population / in-flight bookkeeping.
  let excludedAlterationUnits = 0;
  for (const r of link.excludedRows) excludedAlterationUnits += r.newUnits ?? 0;
  for (const a of assessed) {
    counts[`projects.status.${a.status}`]++;
    if (!a.inPopulation) {
      for (const r of a.proj.pipelineRows) excludedAlterationUnits += r.newUnits ?? 0;
      continue;
    }
    if (a.status === 'staleOpen') {
      counts['projects.staleOpen']++;
      counts['projects.staleOpenUnits'] += a.units ?? 0;
    }
    if (a.status === 'netDropped') counts['projects.netDropped']++;
  }
  counts['projects.excludedAlterationUnits'] = excludedAlterationUnits;

  // Masters are phased after the non-master in-flight set is fixed.
  const inFlight = assessed.filter((a) => a.status === 'inFlight');
  const excluded = new Set<ParcelId>();
  for (const a of inFlight) if (!a.multiPhase) for (const id of a.proj.parcelIds) excluded.add(id);
  for (const h of histories) {
    if (h.end.kind === 'complete') for (const id of h.parcelIds) excluded.add(id);
  }
  const masterOut = phaseMasters({
    masters: inFlight
      .filter((a) => a.multiPhase)
      .map((a) => ({ proj: a.proj, entitled: a.entered.entitled ?? null })),
    excluded,
    projects: link.projects,
    pipeline: parsed.pipeline,
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
    const { stories, tier } = a.stories;
    const p: InFlightProject = orderProject({
      id: a.proj.id,
      label: labelOf(a.proj, curated),
      parcelIds,
      pathway,
      stage: lastStage(a.entered),
      history: a.entered,
      units: a.units as number,
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

  // V21 coverage: pipeline rows of population projects, rows of projects that ended excluded.
  const coverage = { matchedUnits: 0, rowUnits: 0, rows: 0 };
  for (const a of assessed) {
    if (!a.inPopulation || a.proj.pipelineRows.length === 0) continue;
    if (a.end !== null && a.end.kind !== 'open') continue;
    for (const r of a.proj.pipelineRows) {
      coverage.rows++;
      coverage.rowUnits += r.newUnits ?? 0;
    }
    if (a.status === 'inFlight') coverage.matchedUnits += a.units ?? 0;
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
  const tallyInput: TallyInput = { parsed, assessed, withHistory, inFlight: t3 };
  for (const r of PR_RULES) recordQuality(counts, r.id, PR_TALLIES[r.id as PrRuleId](tallyInput));

  const file: ProjectsFile = {
    schema: 1,
    asOf,
    rhnaCompletedNet: rhna.value,
    qualityRules: qualityRulesOf(projects),
    projects
  };
  const permits = permitRows(link.projects, parsed.pipeline, parsed.completions, resolve);

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
        scales: masterOut.scales
      }
    }
  };
}
