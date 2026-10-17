/**
 * deriveProjects (spec 2 internal types, 4.2-4.10): parse, link, per-project stages, ends, units
 * and population, the in-flight set, PRX master phasing, RHNA, then the ordered T3 file, the T4d
 * histories, the permits rows, report counts and the V21-V24 inputs. Pure and deterministic: raw
 * row order never matters (parseAll sorts canonically) and every iteration is over sorted keys.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
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
  inStageOrder,
  orderHistoriesFile,
  orderProject,
  orderProjectsFile,
  permitRows,
  phaseMasters,
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
  storiesOf,
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
import type { LinkedProject, ProjectRecordsInput } from './types';

export type { PermitOut } from './assemble';

export interface DeriveResult {
  histories: ProjectHistory[];
  file: ProjectsFile;
  permits: PermitOut[];
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

function assess(
  proj: LinkedProject,
  input: ProjectRecordsInput,
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
    status
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
    storiesProposed: storiesOf(a.proj).stories,
    baseStoriesAtFiling: baseStoriesAt(a.proj.parcelIds, a.rollYear, input.baseStories),
    sources: sourcesOf(a.proj)
  };
}

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
    'projects.pipelineConflicts',
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
  for (const s of STAGE_ORDER) c[`histories.clamped.${s}`] = 0;
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

export function deriveProjects(input: ProjectRecordsInput): DeriveResult {
  const { asOf } = input;
  const warnings: string[] = [];
  const parsed = parseAll(input.raw, asOf);
  const resolve = (blklots: string[]) => resolveParcels(blklots, input).ids;
  const link = linkProjects(parsed, { resolve, filedDay: filedEvidenceDay });
  const counts = zeroCounts();

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

  const assessed = link.projects.map((p) => assess(p, input, link.ppaLag.days, pipelineCutoff));

  // Histories: population projects that are not pipeline-only, with at least one entered stage.
  const histories: ProjectHistory[] = [];
  for (const a of assessed) {
    if (a.proj.kind === 'pipelineOnly' || !a.inPopulation) continue;
    if (a.firstEntered === null) {
      counts['histories.droppedNoDates']++;
      continue;
    }
    for (const s of a.clamped) counts[`histories.clamped.${s}`]++;
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
    if (pipelineConflict(a.proj, a.end)) counts['projects.pipelineConflicts']++;
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
  const entries = new Map(input.multiphase.projects.map((e) => [e.caseNo, e]));
  for (const a of inFlight) {
    const m = masterOut.byId.get(a.proj.id);
    const parcelIds = m ? m.parcelIds : [...a.proj.parcelIds];
    const caseNo = a.proj.pipelineRows[0]?.caseNo ?? null;
    const curated = a.multiPhase && caseNo !== null ? (entries.get(caseNo)?.label ?? null) : null;
    const pathway = a.pathway ?? 'discretionary';
    if (a.pathway === null) counts['projects.pathwayDefaulted']++;
    const { stories, tier } = storiesOf(a.proj);
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
      sources: sourcesOf(a.proj)
    });
    projects.push(p);
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

  const file: ProjectsFile = {
    schema: 1,
    asOf,
    rhnaCompletedNet: rhna.value,
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
