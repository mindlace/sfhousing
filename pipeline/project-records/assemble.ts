/**
 * Assembly helpers for deriveProjects: PRX master phasing in id order (spec 4.10.2-4.10.3),
 * canonical key order for the T3 and T4d objects (rebuilt explicitly, so the bytes never depend
 * on how an object was built) and the `permits.parquet` rows (spec 4.9 Outputs).
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { InFlightProject, ProjectsFile } from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type {
  ProjectHistoriesFile,
  ProjectHistory,
  Provenance,
  Stage
} from '../../src/lib/timelapse/types';
import type { MultiphaseFile } from '../enrichment/schema';
import { buildPhases, isoToDay, median } from './multiphase';
import { permitCompletionDay, permitDays } from './stages';
import type { Completion, LinkedProject, PipelineRow, ProjectRecordsInput } from './types';

/** One `permits.parquet` row (spec 4.9): one per linked type 1/2 permit. */
export interface PermitOut {
  permit_number: string;
  project_id: string;
  prj_record_id: string | null;
  dva_record_id: string | null;
  prx_case_no: string | null;
  da: string | null;
  parcel_ids: string[];
  proposed_units: number | null;
  site_permit: boolean;
  status: string;
  live: boolean;
  superseded: boolean;
  filed_day: number | null;
  issued_day: number | null;
  construction_day: number | null;
  complete_day: number | null;
  status_day: number | null;
}

type Source = InFlightProject['sources'][number];
type Phase = NonNullable<InFlightProject['phases']>[number];

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A stage-keyed map rebuilt in `STAGE_ORDER`. */
export function inStageOrder<T>(m: Partial<Record<Stage, T>>): Partial<Record<Stage, T>> {
  const out: Partial<Record<Stage, T>> = {};
  for (const s of STAGE_ORDER) if (m[s] !== undefined) out[s] = m[s];
  return out;
}

function orderSource(s: Source): Source {
  return s.key === undefined
    ? { dataset: s.dataset, id: s.id }
    : { dataset: s.dataset, id: s.id, key: s.key };
}

function orderPhase(p: Phase): Phase {
  return {
    units: p.units,
    parcelIds: [...p.parcelIds],
    plannedPermitFiled: p.plannedPermitFiled,
    source:
      p.source === null
        ? null
        : { label: p.source.label, url: p.source.url, retrieved: p.source.retrieved }
  };
}

/** T3 declaration order. */
export function orderProject(p: InFlightProject): InFlightProject {
  return {
    id: p.id,
    label: p.label,
    parcelIds: [...p.parcelIds],
    pathway: p.pathway,
    stage: p.stage,
    history: inStageOrder(p.history),
    units: p.units,
    existingUnits: p.existingUnits,
    stories: p.stories,
    storiesTier: p.storiesTier,
    multiPhase: p.multiPhase,
    phases: p.phases === null ? null : p.phases.map(orderPhase),
    sources: p.sources.map(orderSource)
  };
}

function orderProvenance(p: Provenance): Provenance {
  const out: Provenance = {
    tier: p.tier,
    label: p.label,
    sources: p.sources.map((s) => ({ label: s.label, url: s.url })),
    method: p.method
  };
  if (p.n !== undefined) out.n = p.n;
  if (p.window !== undefined) out.window = [p.window[0], p.window[1]];
  return out;
}

export function orderProjectsFile(f: ProjectsFile): ProjectsFile {
  return {
    schema: f.schema,
    asOf: f.asOf,
    rhnaCompletedNet: {
      units: f.rhnaCompletedNet.units,
      since: f.rhnaCompletedNet.since,
      provenance: orderProvenance(f.rhnaCompletedNet.provenance)
    },
    projects: f.projects.map(orderProject)
  };
}

/** `kind` first, then the T4d member order. */
function orderEnd(e: ProjectHistory['end']): ProjectHistory['end'] {
  if (e.kind === 'complete') return { kind: e.kind, day: e.day };
  if (e.kind === 'exit') return { kind: e.kind, stage: e.stage, reason: e.reason, day: e.day };
  return { kind: e.kind, lastObserved: e.lastObserved };
}

/** T4d declaration order. */
export function orderHistory(h: ProjectHistory): ProjectHistory {
  return {
    id: h.id,
    pathway: h.pathway,
    parcelIds: [...h.parcelIds],
    entered: inStageOrder(h.entered),
    end: orderEnd(h.end),
    unitsAt: inStageOrder(h.unitsAt),
    existingUnits: h.existingUnits,
    storiesProposed: h.storiesProposed,
    baseStoriesAtFiling: h.baseStoriesAtFiling,
    sources: h.sources.map(orderSource)
  };
}

export function orderHistoriesFile(f: ProjectHistoriesFile): ProjectHistoriesFile {
  return { schema: f.schema, asOf: f.asOf, histories: f.histories.map(orderHistory) };
}

/** Nulls last, then ascending. */
function cmpNullable<T extends string | number>(a: T | null, b: T | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * The `permits.parquet` rows (spec 4.9) for every permit of every graph project, sorted by
 * `(prx_case_no, dva_record_id, filed_day, permit_number)` with nulls last.
 */
export function permitRows(
  projects: readonly LinkedProject[],
  pipeline: readonly PipelineRow[],
  completions: readonly Completion[],
  resolve: (blklots: string[]) => ParcelId[]
): PermitOut[] {
  const completionsByPermit = new Map<string, Completion[]>();
  for (const c of completions) {
    const list = completionsByPermit.get(c.permit);
    if (list) list.push(c);
    else completionsByPermit.set(c.permit, [c]);
  }
  // da of the first pipeline row (canonical order) naming each permit.
  const daOf = new Map<string, string>();
  for (const r of pipeline) {
    if (r.bpaNo !== null && r.da !== null && !daOf.has(r.bpaNo)) daOf.set(r.bpaNo, r.da);
  }
  // PRX rows by base case and by da; the lowest case number wins.
  const prxRows = pipeline
    .filter((r): r is PipelineRow & { caseNo: string } => r.prx && r.caseNo !== null)
    .sort((a, b) => cmp(a.caseNo, b.caseNo));
  const prxByBase = new Map<string, string>();
  const prxByDa = new Map<string, string>();
  for (const r of prxRows) {
    const base = r.caseNo.slice(0, -'PRX'.length);
    if (!prxByBase.has(base)) prxByBase.set(base, r.caseNo);
    if (r.da !== null && !prxByDa.has(r.da)) prxByDa.set(r.da, r.caseNo);
  }

  const out: PermitOut[] = [];
  for (const proj of projects) {
    if (proj.kind !== 'graph') continue;
    const prj = proj.primary?.recordId ?? null;
    const anchorIds = new Set(proj.anchors.map((a) => a.recordId));
    const dva =
      proj.children
        .filter((c) => c.type === 'DVA' && c.parentId !== null && anchorIds.has(c.parentId))
        .map((c) => c.recordId)
        .sort(cmp)[0] ?? null;
    const live = new Set(proj.live.map((q) => q.number));
    for (const q of proj.permits) {
      const da = daOf.get(q.number) ?? null;
      const prx =
        (prj !== null ? prxByBase.get(prj) : undefined) ??
        (da !== null ? prxByDa.get(da) : undefined) ??
        null;
      const days = permitDays(q, completionsByPermit.get(q.number) ?? []);
      const blklots = [
        ...new Set(q.rows.map((r) => r.blklot).filter((b): b is string => b !== null))
      ];
      out.push({
        permit_number: q.number,
        project_id: proj.id,
        prj_record_id: prj,
        dva_record_id: dva,
        prx_case_no: prx,
        da,
        parcel_ids: resolve(blklots.sort(cmp)),
        proposed_units: q.proposedUnits,
        site_permit: q.sitePermit,
        status: q.status,
        live: live.has(q.number),
        superseded: proj.superseded.has(q.number),
        filed_day: days.filed,
        issued_day: days.issued,
        construction_day: days.construction,
        complete_day: days.complete,
        status_day: q.statusDay
      });
    }
  }
  return out.sort(
    (a, b) =>
      cmpNullable(a.prx_case_no, b.prx_case_no) ||
      cmpNullable(a.dva_record_id, b.dva_record_id) ||
      cmpNullable<Day>(a.filed_day, b.filed_day) ||
      cmp(a.permit_number, b.permit_number)
  );
}

/** Spec 4.10.2 citywide fallback: completed permits of at least 50 units since 2015-01-01. */
const CITYWIDE_MIN_UNITS = 50;
const CITYWIDE_SINCE = isoToDay('2015-01-01');

/** Median and count; null when empty. */
function medianOf(units: number[]): { u: number; n: number } | null {
  const u = median(units);
  return u === null ? null : { u, n: units.length };
}

/** Proposed units of the completed permits (completion day from the project's own j67f rows). */
function completedUnits(
  projects: Iterable<LinkedProject>,
  keep: (units: number, day: Day) => boolean = () => true
): number[] {
  const out: number[] = [];
  for (const proj of projects) {
    for (const q of proj.permits) {
      if (q.proposedUnits === null) continue;
      const d = permitCompletionDay(q, proj.completions);
      if (d !== null && keep(q.proposedUnits, d)) out.push(q.proposedUnits);
    }
  }
  return out;
}

export interface MasterOut {
  phases: InFlightProject['phases'];
  /** The master's final parcels: available DA parcels plus phase parcels. */
  parcelIds: ParcelId[];
}

/**
 * Phases every in-flight PRX master in the given (id) order. `excluded` starts as the parcels of
 * every non-master in-flight project and of every history ending complete; each master's final
 * parcels are added before the next master. Per master, the DA parcels are the resolved tracking
 * blklot, the blklots of every pipeline row with the same non-null `da`, of every project holding
 * the base-case PRJ (case number without 'PRX') and of every phase in the entry. The phase size u
 * is the median over completed permits of those base-case projects and of projects holding a row
 * with the same `da`, else the citywide median (>= 50 units, completed since 2015-01-01).
 * Adds the `multiphase.*` counts and the buildPhases warnings to `counts` and `warnings`.
 */
export function phaseMasters(o: {
  masters: readonly { proj: LinkedProject; entitled: Day | null }[];
  excluded: Set<ParcelId>;
  projects: readonly LinkedProject[];
  pipeline: readonly PipelineRow[];
  multiphase: MultiphaseFile;
  areaM2: ProjectRecordsInput['areaM2'];
  resolve: (blklots: string[]) => ParcelId[];
  counts: Record<string, number>;
  warnings: string[];
}): {
  byId: Map<string, MasterOut>;
  problems: string[];
  lastResort: string[];
  scales: Record<string, number>;
} {
  const { excluded, counts, resolve } = o;
  const byId = new Map<string, MasterOut>();
  const problems: string[] = [];
  const lastResort: string[] = [];
  const scales: Record<string, number> = {};
  if (o.masters.length === 0) return { byId, problems, lastResort, scales };

  const citywide = medianOf(
    completedUnits(
      o.projects.filter((p) => p.kind === 'graph'),
      (u, d) => u >= CITYWIDE_MIN_UNITS && d >= CITYWIDE_SINCE
    )
  );
  const entries = new Map(o.multiphase.projects.map((e) => [e.caseNo, e]));

  for (const { proj, entitled } of o.masters) {
    const master = proj.pipelineRows[0];
    const caseNo = master.caseNo as string;
    const baseCase = caseNo.slice(0, -'PRX'.length);
    const entry = entries.get(caseNo) ?? null;
    const da = master.da;

    const baseProjects = o.projects.filter((p) =>
      [...p.anchors, ...p.satellites].some((r) => r.recordId === baseCase)
    );
    const daProjects =
      da === null ? [] : o.projects.filter((p) => p.pipelineRows.some((r) => r.da === da));
    const blklots = new Set<string>();
    if (master.blklot !== null) blklots.add(master.blklot);
    for (const r of o.pipeline) if (da !== null && r.da === da && r.blklot) blklots.add(r.blklot);
    for (const p of baseProjects) for (const b of p.blklots) blklots.add(b);
    for (const ph of entry?.phases ?? []) for (const b of ph.blklots) blklots.add(b);

    const projectU = medianOf(completedUnits(new Set([...baseProjects, ...daProjects])));
    const chosen = [projectU, citywide].find((x) => x !== null && x.u > 0) ?? null;
    if (chosen !== null) {
      counts[`multiphase.u.${caseNo}`] = chosen.u;
      counts[`multiphase.u.${caseNo}.n`] = chosen.n;
    }

    const r = buildPhases({
      master,
      entry,
      masterEntitled: entitled,
      daParcels: resolve([...blklots].sort(cmp)),
      excluded,
      trackingParcels: master.blklot === null ? [] : resolve([master.blklot]),
      projectU,
      citywideU: citywide,
      resolve,
      areaM2: o.areaM2
    });
    problems.push(...r.problems);
    o.warnings.push(...r.warnings);
    counts[`multiphase.${r.mode}`]++;
    counts['multiphase.merged'] += r.merged;
    if (r.mode === 'lastResort') lastResort.push(proj.id);
    else counts[`multiphase.phases.${r.mode}`] += r.phases?.length ?? 0;
    if (r.scale !== null) {
      counts[`multiphase.scale.${caseNo}`] = r.scale;
      scales[caseNo] = r.scale;
    }
    byId.set(proj.id, { phases: r.phases, parcelIds: r.parcelIds });
    for (const id of r.parcelIds) excluded.add(id);
  }
  return { byId, problems, lastResort, scales };
}
