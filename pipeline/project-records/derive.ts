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
  carriedFiledUnits,
  unitsAt,
  type Capacity,
  type InFlightStatus
} from './inflight';
import type { V2xInputs } from './invariants';
import { isSplitPart, linkProjects } from './link';
import { checkMultiphaseFile, netMasters, type Netting } from './multiphase';
import { linkNoDateRows, rowKey } from './nodate';
import { resolveParcels } from './parcels';
import { supersessions } from './supersede';
import { parseAll } from './parse';
import { rhnaCompletedNet } from './rhna';
import {
  completeAt,
  evidenceApplies,
  evidenceDay,
  expiryApplies,
  expiryExit,
  expiryTest,
  indexHousing,
  verdictEnd,
  type AssessorCtx,
  type HousingIndex
} from './stale';
import {
  PPA_UMBRELLA_DAYS,
  clampStages,
  entitledDay,
  filedEvidenceDay,
  pipelineOnlyHistory,
  rawStages
} from './stages';
import type { ConstructionVerdict } from '../enrichment/construction-schema';
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
  'suspended',
  'superseded',
  'noDates'
];

/** Above this, `rhna.xdhtLagDays` warns (spec 4.9). */
const XDHT_LAG_WARN_DAYS = 120;

/** One linked project after stages, end, units and the population / in-flight decision. */
interface Assessed {
  /** The project after the capacity rules: a failing permit has null units, or its lot capacity. */
  proj: LinkedProject;
  /** Spec 4.8 capacity: the permits checked and the ones that failed (original units). */
  capacity: Pick<Capacity, 'checked' | 'failing' | 'skipped' | 'capped'>;
  pathway: Pathway | null;
  entered: Entered;
  /**
   * The spec 4.6 end; null for pipeline-only projects (they have no history). The in-flight
   * decision, DQ-2, V21 and the masters' exclusions read it.
   */
  end: ProjectHistory['end'] | null;
  /**
   * The T4d history's stage map and end: `entered` and `end`, then the stale-open rulings of spec
   * 4.6 (complete-from-evidence, statutory expiry, curated verdicts), which never touch an
   * in-flight project's history (T3 unchanged).
   */
  histEntered: Entered;
  histEnd: ProjectHistory['end'] | null;
  /** What the stale-open rulings saw and did (their T14 tallies). */
  stale: StaleState;
  /** Spec 4.7: an open end's `lastObserved` was raised to the latest entered day. */
  lastObservedRaised: boolean;
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

/** Per history: which stale-open rule examined it (`*Of`) and which acted. */
interface StaleState {
  evidenceOf: boolean;
  evidence: 'xdht' | 'assessor' | null;
  /** The `bpa` ids of the xdht rows that dated an evidence completion (listed in `sources`). */
  evidenceBpas: string[];
  expiryOf: boolean;
  /** Excluded from the expiry test: a unit-bearing permit has a completion day (ruling 2). */
  expiryExcludedComplete: boolean;
  /** Unit-bearing permits whose deadline read a Table B bracket; those with no valuation. */
  expiryPermits: number;
  expiryNoValuation: number;
  expired: boolean;
  verdict: boolean;
}

const NO_STALE: StaleState = {
  evidenceOf: false,
  evidence: null,
  evidenceBpas: [],
  expiryOf: false,
  expiryExcludedComplete: false,
  expiryPermits: 0,
  expiryNoValuation: 0,
  expired: false,
  verdict: false
};

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
  let end = pipelineOnly ? null : endOf(proj, entered, { asOf: input.asOf, ppaLag });
  // Spec 4.7: a forward clamp or an undated source can enter a stage after the latest date
  // `lastObserved` reads; an open history's `lastObserved` is raised to its latest entered day.
  let lastObservedRaised = false;
  if (end !== null && end.kind === 'open') {
    const latest = Math.max(...Object.values(entered));
    const raised = Math.min(input.asOf, Math.max(end.lastObserved, latest));
    if (raised > end.lastObserved) {
      end = { kind: 'open', lastObserved: raised };
      lastObservedRaised = true;
    }
  }
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
  // Main's ruling 4: a project holding a permit whose placeholder valuation was replaced.
  if (cap.original.permits.some((q) => parsed.placeholderPermits.has(q.number))) {
    quality.add(PR.permitsPlaceholderValuation);
  }
  if (clamped.length > 0) quality.add(PR.stagesForwardClamp);
  if (lastObservedRaised) quality.add(PR.stagesLastObservedClamp);
  if (stories.discarded > 0) quality.add(PR.storiesParseRange);
  if (proj.crossBlock.dropped.length > 0) quality.add(PR.parcelsCrossBlock);
  if (cap.failing.length > 0) quality.add(cap.capped ? PR.unitsCapacityCap : PR.unitsCapacity);
  // Ruling S2: a split part holds only its own permits, so the whole PRJ's proposed units are not
  // its filing-stage size; its history's `unitsAt.filed` is its next recorded count, or omitted
  // when it has none (Ruling U1; T4d only, see T4D_ONLY_QUALITY).
  if (isSplitPart(proj.id) && filedUnitsSource(proj)) quality.add(PR.unitsSplitFiled);
  // Ruling F1a: a primary PRJ `number_of_units_prop` of 0 is not a recorded size (spec 4.8 units
  // rule 2 needs > 0); the history's `unitsAt.filed` is its next recorded count, or omitted when it
  // has none (Ruling U1; T4d only). A split part is counted under
  // pr.units.split-filed only, which is checked first.
  else if (proj.primary?.unitsProp === 0) quality.add(PR.unitsFiledZero);
  return {
    proj,
    capacity: {
      checked: cap.checked,
      failing: cap.failing,
      skipped: cap.skipped,
      capped: cap.capped
    },
    pathway,
    entered,
    end,
    histEntered: entered,
    histEnd: end,
    stale: { ...NO_STALE },
    lastObservedRaised,
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

/** Spec 4.8 `unitsAt.filed` has a source: the primary PRJ's `number_of_units_prop` is recorded. */
function filedUnitsSource(proj: LinkedProject): boolean {
  return (proj.primary?.unitsProp ?? null) !== null;
}

/** The history's end (and stage map) replaced by a stale-open rule, which the history carries. */
function replaceEnd(a: Assessed, end: ProjectHistory['end'], entered: Entered, id: string): void {
  a.histEnd = end;
  a.histEntered = entered;
  a.quality.add(id);
  // The raised lastObserved value is gone with the open end.
  a.quality.delete(PR.stagesLastObservedClamp);
}

/**
 * Spec 4.6 statutory expiry (Ruling E2) on an open history, in flight or not (Ruling I4): true
 * when it exited `expired`.
 */
function applyExpiry(a: Assessed, asOf: Day): boolean {
  const st = a.stale;
  if (a.histEnd === null || !expiryApplies(a.histEntered, a.histEnd)) return false;
  st.expiryOf = true;
  const t = expiryTest(a.proj, asOf);
  st.expiryPermits = t.permits;
  st.expiryNoValuation = t.noValuation;
  st.expiryExcludedComplete = t.excludedComplete;
  const end = t.day === null ? null : expiryExit(a.histEntered, t.day);
  if (end === null) return false;
  st.expired = true;
  replaceEnd(a, end, a.histEntered, PR.stagesStatutoryExpiry);
  return true;
}

/**
 * Spec 4.6 stale open histories, in order, on a history whose project is not in flight: (1)
 * completion from construction evidence (Ruling C2), (2) the statutory permit expiry exit (Ruling
 * E2; a building shown finished is not expired), (3) the curated verdict for its id (Ruling C3),
 * taken from `verdicts` when it meets an open history. A replaced open end drops
 * `pr.stages.last-observed-clamp` (its value is gone). A completion here sets `entered.complete`
 * but never `unitsAt.complete` (no units were certified; see `history`). An in-flight project's
 * history gets (2) only (`applyExpiry`, Ruling I4).
 */
function applyStale(
  a: Assessed,
  ctx: { asOf: Day; housing: HousingIndex; assessor: AssessorCtx },
  verdicts: Map<string, ConstructionVerdict>,
  warnings: string[]
): void {
  const st = a.stale;
  const replace = (end: ProjectHistory['end'], entered: Entered, id: string) =>
    replaceEnd(a, end, entered, id);
  const clampedComplete = () => {
    a.clamped = [...a.clamped, 'complete'];
    a.quality.add(PR.stagesForwardClamp);
  };
  const complete = (day: Day, id: string) => {
    const c = completeAt(a.histEntered, day);
    if (c.clamped) clampedComplete();
    replace({ kind: 'complete', day: c.entered.complete as Day }, c.entered, id);
  };
  if (a.histEnd === null) return;
  if (evidenceApplies(a.proj, a.histEntered, a.histEnd)) {
    st.evidenceOf = true;
    const ev = evidenceDay(a.proj, a.histEntered, a.units ?? 0, ctx);
    if (ev !== null) {
      st.evidence = ev.source;
      st.evidenceBpas = ev.bpas;
      complete(ev.day, PR.stagesCompleteFromEvidence);
    }
  }
  applyExpiry(a, ctx.asOf);
  const v = verdicts.get(a.proj.id);
  if (v === undefined || a.histEnd.kind !== 'open') return;
  verdicts.delete(a.proj.id);
  const r = verdictEnd(a.histEntered, v, ctx.asOf);
  if (r === null) return;
  if ('skip' in r) {
    warnings.push(`construction-verified.json: ${v.id}: ${r.skip}; not applied`);
    return;
  }
  st.verdict = true;
  if (r.clamped) clampedComplete();
  replace(r.end, r.entered, PR.stagesVerifiedConstruction);
}

/**
 * A history's `sources` plus the xdht-4php rows that dated its evidence completion (Ruling C2),
 * as `{ dataset: 'xdht-4php', id: <bpa>, key: 'bpa' }`; sorted and unique, as `sourcesOf`.
 */
function withEvidenceSources(
  sources: ProjectHistory['sources'],
  bpas: readonly string[]
): ProjectHistory['sources'] {
  if (bpas.length === 0) return sources;
  const all = [...sources, ...bpas.map((id) => ({ dataset: 'xdht-4php', id, key: 'bpa' }))];
  const seen = new Map(all.map((s) => [`${s.dataset}\0${s.id}\0${s.key ?? ''}`, s]));
  return [...seen.values()].sort(
    (x, y) => cmp(x.dataset, y.dataset) || cmp(x.id, y.id) || cmp(x.key ?? '', y.key ?? '')
  );
}

function history(a: Assessed, input: ProjectRecordsInput): ProjectHistory {
  const at = unitsAt(a.proj);
  // A completion from evidence or a verdict certifies no units, so it sets no unitsAt.complete.
  const ruled = a.stale.evidence !== null || a.stale.verdict;
  if (a.histEntered.complete === undefined || ruled) delete at.complete;
  if (a.quality.has(PR.unitsSplitFiled) || a.quality.has(PR.unitsFiledZero)) {
    // Ruling U1: the Planning value is not this history's size at filing; carry the next
    // recorded count (its own permits, else its certified completion) backwards, if any.
    delete at.filed;
    const carried = carriedFiledUnits(at);
    if (carried !== null) at.filed = carried;
  }
  return {
    id: a.proj.id,
    pathway: a.pathway,
    parcelIds: [...a.proj.parcelIds],
    entered: inStageOrder(a.histEntered),
    end: a.histEnd as ProjectHistory['end'],
    unitsAt: inStageOrder(at),
    existingUnits: existingUnitsAt(a.proj.parcelIds, a.rollYear, input.assessorUnits),
    storiesProposed: a.stories.stories,
    baseStoriesAtFiling: baseStoriesAt(a.proj.parcelIds, a.rollYear, input.baseStories),
    sources: withEvidenceSources(sourcesOf(a.proj), a.stale.evidenceBpas),
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
  /** Entries in construction-verified.json (spec 4.6, Ruling C3). */
  verdictEntries: number;
  /** Ruling SP1: the in-flight PRJ-anchored projects tested and the superseded ids. */
  supersede: { tested: number; superseded: readonly string[] };
}

/** Σ of the positive values; null and negative count as 0. */
function positiveSum(xs: Iterable<number | null>): number {
  let s = 0;
  for (const x of xs) if (x !== null && x > 0) s += x;
  return s;
}

/** The capacity tallies: failing permits of the projects on one branch, of all checked permits. */
function capacityTally(assessed: readonly Assessed[], capped: boolean): Tally {
  const checked = assessed.flatMap((a) => a.capacity.checked);
  const on = assessed.filter((a) => a.capacity.capped === capped);
  const failing = on.flatMap((a) => a.capacity.failing);
  return {
    fired: failing.length,
    of: checked.length,
    units: positiveSum(failing.map((q) => q.proposedUnits)),
    unitsOf: positiveSum(checked.map((q) => q.proposedUnits)),
    sample: on.filter((a) => a.capacity.failing.length > 0).map((a) => a.proj.id)
  };
}

/**
 * One tally per `pr.*` rule (spec 4.11 `of` column and on-records text). A later task that gives a
 * rule its behaviour replaces that rule's entry; the record ids it marks go in `Assessed.quality`.
 */
const PR_TALLIES: Record<PrRuleId, (t: TallyInput) => Tally> = {
  // Spec 4.1: non-empty date values parsed; values treated as missing; source record ids.
  [PR.dateValidRange]: ({ parsed }) => ({ ...parsed.dates }),
  // Spec 4.1 valuation (main's ruling 4): permits with a revised_cost; the placeholders under
  // $1,000 replaced by estimated_cost; their permit numbers (the projects holding one carry it).
  [PR.permitsPlaceholderValuation]: ({ parsed }) => ({ ...parsed.placeholderValuation }),
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
  // Spec 4.7: open histories; the ones whose `lastObserved` was raised (they and their T3
  // project carry the id); their ids.
  [PR.stagesLastObservedClamp]: ({ withHistory }) => {
    const open = withHistory.filter((a) => a.histEnd?.kind === 'open');
    const sample = open.filter((a) => a.lastObservedRaised).map((a) => a.proj.id);
    return { fired: sample.length, of: open.length, sample };
  },
  // Spec 4.6 Ruling C2 (main's ruling 1): of the histories that entered construction; the ones
  // completed from evidence (they carry the id); their ids.
  [PR.stagesCompleteFromEvidence]: ({ withHistory }) => {
    const of = withHistory.filter((a) => a.entered.construction !== undefined);
    const sample = of.filter((a) => a.stale.evidence !== null).map((a) => a.proj.id);
    return { fired: sample.length, of: of.length, sample };
  },
  // Spec 4.6 Ruling E2 (main's ruling 1): of the histories that entered permitIssued (or
  // construction, which a site permit's FCD can enter without an issue day); the ones exited
  // expired, in flight or not (they carry the id); their ids.
  [PR.stagesStatutoryExpiry]: ({ withHistory }) => {
    const of = withHistory.filter(
      (a) => a.entered.permitIssued !== undefined || a.entered.construction !== undefined
    );
    const sample = of.filter((a) => a.stale.expired).map((a) => a.proj.id);
    return { fired: sample.length, of: of.length, sample };
  },
  // Ruling E2 (observe; no record carries it): the unit-bearing permits of those histories whose
  // deadline read a Table B bracket; the ones with no valuation (middle bracket); their history
  // ids.
  [PR.stagesExpiryNoValuation]: ({ withHistory }) => {
    const of = withHistory.filter((a) => a.stale.expiryOf);
    return {
      fired: of.reduce((n, a) => n + a.stale.expiryNoValuation, 0),
      of: of.reduce((n, a) => n + a.stale.expiryPermits, 0),
      sample: of.filter((a) => a.stale.expiryNoValuation > 0).map((a) => a.proj.id)
    };
  },
  // Spec 4.6 Ruling C3: the entries of construction-verified.json; the verdicts applied to an
  // open history (they carry the id); their ids.
  [PR.stagesVerifiedConstruction]: ({ withHistory, verdictEntries }) => {
    const sample = withHistory.filter((a) => a.stale.verdict).map((a) => a.proj.id);
    return { fired: sample.length, of: verdictEntries, sample };
  },
  // Spec 4.7 Ruling SP1 (no record carries it): of the in-flight PRJ-anchored projects tested; the
  // ones superseded by a later refiling; their ids.
  [PR.projectsSuperseded]: ({ supersede }) => ({
    fired: supersede.superseded.length,
    of: supersede.tested,
    sample: [...supersede.superseded]
  }),
  // Spec 4.8 capacity: permits with recorded stories and units on a project with parcels; the
  // ones above their lot's physical limit on a project with a fallback unit source (voided); both
  // weighted by their proposed units. The sample is the affected project ids (a rule acting after
  // linking, spec 2), so it is never longer than `fired`.
  [PR.unitsCapacity]: ({ assessed }) => capacityTally(assessed, false),
  // Spec 4.8 capacity cap: the same denominator; the failing permits of projects with no fallback
  // unit source (replaced by their lot capacity), with their original units.
  [PR.unitsCapacityCap]: ({ assessed }) => capacityTally(assessed, true),
  // Spec 4.8 capacity, unmapped lots (observe; no record carries it): the same denominator
  // (skipped permits stay in it); the permits not checked because none of their own address lots is
  // among the project's parcels; their project ids.
  [PR.unitsCapacityUnmapped]: ({ assessed }) => {
    const skipped = assessed.filter((a) => a.capacity.skipped.length > 0);
    return {
      fired: skipped.reduce((n, a) => n + a.capacity.skipped.length, 0),
      of: assessed.reduce((n, a) => n + a.capacity.checked.length, 0),
      sample: skipped.map((a) => a.proj.id)
    };
  },
  // Spec 4.8 `unitsAt`, Ruling S2: of the histories whose primary PRJ records proposed units
  // (the histories `unitsAt.filed` would come from); the split parts among them, whose
  // `unitsAt.filed` is carried from their next recorded count, or omitted (Ruling U1; they carry
  // the id); their ids. The ruling's narrower `of` (split
  // parts only) would make the share 1 and fail V30 wherever one split exists.
  // Ruling F1a: of the same histories; the ones whose primary PRJ records 0 (not split parts,
  // which split-filed counts), whose `unitsAt.filed` is carried from their next recorded count, or
  // omitted (Ruling U1; they carry the id); their ids.
  [PR.unitsFiledZero]: ({ withHistory }) => {
    const sourced = withHistory.filter((a) => filedUnitsSource(a.proj));
    const sample = sourced.filter((a) => a.quality.has(PR.unitsFiledZero)).map((a) => a.proj.id);
    return { fired: sample.length, of: sourced.length, sample };
  },
  [PR.unitsSplitFiled]: ({ withHistory }) => {
    const sourced = withHistory.filter((a) => filedUnitsSource(a.proj));
    const sample = sourced.filter((a) => a.quality.has(PR.unitsSplitFiled)).map((a) => a.proj.id);
    return { fired: sample.length, of: sourced.length, sample };
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
  // Spec 4.2 Parcels: of the linked projects that became a record (T3 or history) with at least
  // one resolved permit address parcel; the ones that lost a PRJ-only parcel on another block
  // (they carry the id); their ids.
  [PR.parcelsCrossBlock]: ({ withHistory, inFlight }) => {
    const recorded = new Set<Assessed>([...withHistory, ...inFlight.map((x) => x.a)]);
    const applies = [...recorded].filter((a) => a.proj.crossBlock.applies);
    const sample = applies
      .filter((a) => a.proj.crossBlock.dropped.length > 0)
      .map((a) => a.proj.id);
    return { fired: sample.length, of: applies.length, sample };
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
    'projects.inFlightUnits': 0,
    'projects.excludedStatutory': 0,
    'projects.excludedStatutoryUnits': 0,
    'projects.excludedSuspended': 0,
    'projects.excludedSuspendedUnits': 0,
    'projects.excludedSuperseded': 0,
    'projects.excludedSupersededUnits': 0,
    'histories.statutoryExpiry.excludedCompletePermit': 0,
    'histories.unitsFiledCarried': 0,
    'histories.unitsFiledOmitted': 0,
    'parse.named.kept': 0,
    'parse.named.unnamed': 0,
    'parse.named.inNewcon': 0
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
  // Ruling L2: a BP-only project joins the PRJ on its lot; the PRJ's anchor day is its entitled
  // day, else its filing-evidence day, both known at link time.
  const link = linkProjects(parsed, {
    resolve,
    filedDay: filedEvidenceDay,
    anchorDay: (p) => entitledDay(p) ?? filedEvidenceDay(p),
    // Ruling L2b: a target whose history (spec 4.6 rules 1-6) exited before the BP was filed.
    exitDay: (p) => {
      const end = endOf(p, clampStages(rawStages(p, pathwayOf(p))).entered, {
        asOf,
        ppaLag: Infinity
      });
      return end.kind === 'exit' ? end.day : null;
    }
  });
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
  const capped = link.projects.map((p) => applyCapacity(p, input.areaM2, resolve));
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
  // The stale-open rulings (spec 4.6) rewrite histories here, after DQ-2 and before DA netting:
  // all three on a project not in flight (a `suspended` one included, so one past its deadline
  // still expires), and the statutory exit alone on an in-flight one, which then leaves flight
  // (Ruling I4). Netting changes masters only, which have no history.
  const histories: ProjectHistory[] = [];
  const withHistory: Assessed[] = [];
  const staleCtx = {
    asOf,
    housing: indexHousing(parsed.housing, resolve),
    assessor: {
      assessorUnits: input.assessorUnits,
      yearBuilt: input.yearBuilt,
      lienDay: input.lienDay,
      latestRollYear: input.latestRollYear,
      panelImputed: input.panelImputed
    }
  };
  const verdicts = new Map(input.constructionVerified.projects.map((v) => [v.id, v]));
  const verdictWarnings: string[] = [];
  const inFlightHistories = new Set<string>();
  const leftFlight: string[] = [];
  for (const a of assessed) {
    if (a.status === 'suspended') {
      // Main's ruling 5 (Ruling I4): every unit-bearing permit suspended, so it leaves flight. Its
      // history stays open unless the history rules below end it: `suspend` does not block the
      // statutory exit, so a suspended project past its deadline still expires.
      counts['projects.excludedSuspended']++;
      counts['projects.excludedSuspendedUnits'] += a.units ?? 0;
      leftFlight.push(`${a.proj.id}: every permit suspended; left flight`);
    }
    if (a.proj.kind === 'pipelineOnly' || !a.inPopulation) continue;
    if (a.firstEntered === null) {
      counts['histories.droppedNoDates']++;
      continue;
    }
    withHistory.push(a);
    if (a.status === 'inFlight') {
      // Ruling I4: the statutory exit ends an in-flight project's history too, so it leaves
      // flight here, before DA netting, phasing and shared parcels read the in-flight set.
      if (applyExpiry(a, asOf)) {
        a.status = 'ended';
        counts['projects.excludedStatutory']++;
        counts['projects.excludedStatutoryUnits'] += a.units ?? 0;
        leftFlight.push(`${a.proj.id}: past statutory completion deadline; expired, left flight`);
      } else {
        inFlightHistories.add(a.proj.id);
      }
    } else {
      applyStale(a, staleCtx, verdicts, verdictWarnings);
    }
    if (a.stale.expiryExcludedComplete) {
      counts['histories.statutoryExpiry.excludedCompletePermit']++;
    }
    const h = history(a, input);
    histories.push(h);
    // Ruling U1: of the histories the two filing rules fire on, those that carried a later count
    // back to filing and those left with no `unitsAt.filed`.
    if (a.quality.has(PR.unitsSplitFiled) || a.quality.has(PR.unitsFiledZero)) {
      counts[
        h.unitsAt.filed === undefined
          ? 'histories.unitsFiledOmitted'
          : 'histories.unitsFiledCarried'
      ]++;
    }
  }
  // Partner ruling 3, Ruling SP1: after every other in-flight decision and before DA netting, an
  // in-flight PRJ-anchored project refiled under a later Planning record (same address, a shared
  // block, units within 25%) leaves flight; the later one stays. T3 only: histories unchanged.
  const supersedeTested = assessed.filter(
    (a) => a.status === 'inFlight' && a.proj.kind === 'graph' && a.proj.primary !== null
  );
  const supersede = supersessions(
    supersedeTested.map((a) => ({
      id: a.proj.id,
      recordId: (a.proj.primary as NonNullable<typeof a.proj.primary>).recordId,
      address: a.proj.primary?.address ?? null,
      label: labelOf(a.proj, null),
      parcelIds: a.proj.parcelIds,
      units: a.units ?? 0,
      openDay: a.proj.primary?.openDay ?? null
    }))
  );
  for (const a of supersedeTested) {
    const keeper = supersede.superseded.get(a.proj.id);
    if (keeper === undefined) continue;
    a.status = 'superseded';
    counts['projects.excludedSuperseded']++;
    counts['projects.excludedSupersededUnits'] += a.units ?? 0;
    leftFlight.push(
      `${a.proj.id}: superseded by ${keeper} (same address, block and units); left flight`
    );
  }
  warnings.push(...leftFlight.sort(cmp));
  // Ruling C3: an entry that met no open history (an unknown verdict there is simply unused).
  for (const v of verdicts.values()) {
    verdictWarnings.push(
      inFlightHistories.has(v.id)
        ? `construction-verified.json: ${v.id} is in flight; not applied (T3 is unchanged)`
        : `construction-verified.json: ${v.id} names no open history; not applied`
    );
  }
  warnings.push(...verdictWarnings.sort(cmp));

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
  // Spec 4.6 ends only: a stale-open completion (T4d only) must not move a master's phases (T3).
  for (const a of withHistory) {
    if (a.end?.kind === 'complete') for (const id of a.proj.parcelIds) excluded.add(id);
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
    // Rows of projects whose history ended are excluded, a stale-open end included (Ruling I4),
    // and so are a superseded project's rows: its keeper covers the same project (Ruling SP1).
    const ended = a.histEnd ?? a.end;
    if (ended !== null && ended.kind !== 'open') continue;
    if (a.status === 'superseded') continue;
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
    netting,
    verdictEntries: input.constructionVerified.projects.length,
    supersede: { tested: supersede.tested, superseded: [...supersede.superseded.keys()] }
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
