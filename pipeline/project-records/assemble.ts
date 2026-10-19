/**
 * Assembly helpers for deriveProjects: PRX master phasing in id order (spec 4.10.2-4.10.3),
 * canonical key order for the T3 and T4d objects (rebuilt explicitly, so the bytes never depend
 * on how an object was built) and the `permits.parquet` rows (spec 4.9 Outputs).
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type {
  InFlightProject,
  ProjectsFile,
  QualityRuleRef
} from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type {
  ProjectHistoriesFile,
  ProjectHistory,
  Provenance,
  Stage
} from '../../src/lib/timelapse/types';
import type { MultiphaseFile } from '../enrichment/schema';
import { qualityRule } from '../lib/quality';
import { PR } from '../lib/quality-rules/pr';
import { isNewConstructionPermit } from './classify';
import { buildPhases, isoToDay, median } from './multiphase';
import { permitCompletionDay, permitDays } from './stages';
import type { Completion, LinkedProject, PipelineRow, ProjectRecordsInput } from './types';

/**
 * Ruling B1: the record ids a PRX case's base-case PRJ may carry, the case without its trailing
 * 'PRX' (old format: `2007.0946PRX` → `2007.0946`) and that plus 'PRJ' (dash format:
 * `2018-007883PRX` → `2018-007883PRJ`). [] for a case that does not end in 'PRX'.
 */
export function baseCaseIds(caseNo: string): string[] {
  if (!caseNo.endsWith('PRX')) return [];
  const base = caseNo.slice(0, -'PRX'.length);
  return [base, `${base}PRJ`];
}

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

/**
 * The rules that act only on T3 values (spec §4.8 T4d `quality`): a history never carries them.
 */
export const T3_ONLY_QUALITY: ReadonlySet<string> = new Set([
  PR.parcelsSharedExisting,
  PR.multiphaseDaNetting
]);

/**
 * The rules that act only on T4d values (spec §4.8 `unitsAt`, Ruling S2; spec §4.6 stale open
 * histories, Rulings C2, E2 and C3): a T3 project never carries them, so they never reach
 * `qualityRules`.
 */
export const T4D_ONLY_QUALITY: ReadonlySet<string> = new Set([
  PR.unitsSplitFiled,
  PR.unitsFiledZero,
  PR.stagesCompleteFromEvidence,
  PR.stagesStatutoryExpiry,
  PR.stagesVerifiedConstruction
]);

function sortedIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(cmp);
}

/** T3 `quality`: the rule ids carried by a project, sorted and unique, without T4d-only rules. */
export function projectQuality(ids: Iterable<string>): string[] {
  return sortedIds(ids).filter((id) => !T4D_ONLY_QUALITY.has(id));
}

/** T4d `quality`: the rule ids, sorted and unique, without the rules that act only on T3. */
export function historyQuality(ids: Iterable<string>): string[] {
  return sortedIds(ids).filter((id) => !T3_ONLY_QUALITY.has(id));
}

/**
 * Spec 4.8 `existingUnits` for T3, rule `pr.parcels.shared-existing`: each parcel's assessor units
 * count once across the in-flight projects. A parcel's holder is the project on it whose `history`
 * has the earliest first day (ties to the smallest id); a non-holder gets 0 from it. Every project
 * on a parcel with two or more projects and units > 0 carries the rule id, the holder included.
 * Run once, after the set, DA netting and phasing are final: `parcelIds` already hold a master's
 * phase parcels, and a score-only master has none. It only lowers values, so net >= 1 (V20) holds
 * for the non-master projects and multiPhase rows are exempt. Pure; unchanged projects are
 * returned as they are.
 */
export function shareExisting(
  projects: readonly InFlightProject[],
  unitsOf: (id: ParcelId) => number
): InFlightProject[] {
  const firstDay = (p: InFlightProject): number => Math.min(...Object.values(p.history));
  const on = new Map<ParcelId, InFlightProject[]>();
  for (const p of projects) {
    for (const id of p.parcelIds) {
      const list = on.get(id);
      if (list) list.push(p);
      else on.set(id, [p]);
    }
  }
  const holder = new Map<ParcelId, string>();
  for (const [id, list] of on) {
    const best = list.reduce((a, b) => {
      const d = firstDay(a) - firstDay(b);
      return d < 0 || (d === 0 && cmp(a.id, b.id) <= 0) ? a : b;
    });
    holder.set(id, best.id);
  }
  return projects.map((p) => {
    let existing = 0;
    let shared = false;
    for (const id of p.parcelIds) {
      const units = unitsOf(id);
      if (holder.get(id) === p.id) existing += units;
      if (units > 0 && (on.get(id)?.length ?? 0) >= 2) shared = true;
    }
    if (existing === p.existingUnits && !shared) return p;
    return {
      ...p,
      existingUnits: existing,
      quality: shared ? projectQuality([...p.quality, PR.parcelsSharedExisting]) : p.quality
    };
  });
}

/** `qualityRules` (spec §4.9 Outputs): one registry entry per id the projects use, by id. */
export function qualityRulesOf(projects: readonly InFlightProject[]): QualityRuleRef[] {
  return projectQuality(projects.flatMap((p) => p.quality)).map((id) => {
    const r = qualityRule(id);
    return { id, label: r.label, tier: r.tier, valueTier: r.valueTier };
  });
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
    sources: p.sources.map(orderSource),
    quality: [...p.quality]
  };
}

function orderQualityRule(r: QualityRuleRef): QualityRuleRef {
  return { id: r.id, label: r.label, tier: r.tier, valueTier: r.valueTier };
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
    qualityRules: f.qualityRules.map(orderQualityRule),
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
    sources: h.sources.map(orderSource),
    quality: [...h.quality]
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
  // PRX rows by base-case PRJ (Ruling B1) and by da; the lowest case number wins.
  const prxRows = pipeline
    .filter((r): r is PipelineRow & { caseNo: string } => r.prx && r.caseNo !== null)
    .sort((a, b) => cmp(a.caseNo, b.caseNo));
  const prxByBase = new Map<string, string>();
  const prxByDa = new Map<string, string>();
  for (const r of prxRows) {
    for (const base of baseCaseIds(r.caseNo)) {
      if (!prxByBase.has(base)) prxByBase.set(base, r.caseNo);
    }
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
      // T4d: one row per linked type 1/2 permit; a named alteration (Ruling L1) is not one.
      if (!isNewConstructionPermit(q)) continue;
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
export function completedUnits(
  projects: Iterable<LinkedProject>,
  keep: (units: number, day: Day) => boolean = () => true
): number[] {
  const out: number[] = [];
  for (const proj of projects) {
    for (const q of proj.permits) {
      // Phase sizes are new buildings: a named alteration (Ruling L1) is not one.
      if (q.proposedUnits === null || !isNewConstructionPermit(q)) continue;
      const d = permitCompletionDay(q, proj.completions);
      if (d !== null && keep(q.proposedUnits, d)) out.push(q.proposedUnits);
    }
  }
  return out;
}

export interface MasterOut {
  phases: InFlightProject['phases'];
  /** The master's final parcels: free DA parcels plus phase parcels; [] when score-only. */
  parcelIds: ParcelId[];
  /** DQ-3: a last resort with no free DA parcel. */
  scoreOnly: boolean;
}

/** A master's DA parcels and tracking parcels (spec 4.10.2), and its project phase size. */
export interface MasterDa {
  daParcels: ParcelId[];
  trackingParcels: ParcelId[];
  /** Median proposed units of the completed buildings of its base-case and same-`da` projects. */
  projectU: { u: number; n: number } | null;
  /** `descendants(tracking blklot)`, for every master ([] with no tracking blklot). */
  descendants: ParcelId[];
  /** The projects holding the base-case PRJ and those holding a row with the same `da`. */
  daProjects: ReadonlySet<LinkedProject>;
}

/**
 * Spec 4.10.2 DA parcels of a master (a pipeline-only PRX project): the resolved tracking blklot,
 * the blklots of every pipeline row with the same non-null `da`, of every project holding the
 * base-case PRJ (`baseCaseIds`, Ruling B1) and of every phase in its `multiphase.json` entry.
 * When the entry has `schedule: null`, or there is no entry, they also hold every current parcel
 * descended from the tracking blklot (main's ruling 3, Ruling D1 revised). The phase size u is the
 * median over completed permits of those base-case projects and of projects holding a row with
 * the same `da`. `projects` are the linked projects after DQ-2, so a linked row counts as the
 * project's.
 */
export function masterDa(
  proj: LinkedProject,
  o: {
    projects: readonly LinkedProject[];
    pipeline: readonly PipelineRow[];
    multiphase: MultiphaseFile;
    resolve: (blklots: string[]) => ParcelId[];
    descendants: ProjectRecordsInput['descendants'];
  }
): MasterDa {
  const master = proj.pipelineRows[0];
  const caseNo = master.caseNo as string;
  const baseIds = new Set(baseCaseIds(caseNo));
  const entry = o.multiphase.projects.find((e) => e.caseNo === caseNo) ?? null;
  const da = master.da;
  const baseProjects = o.projects.filter((p) =>
    [...p.anchors, ...p.satellites].some((r) => baseIds.has(r.recordId))
  );
  const daProjects =
    da === null ? [] : o.projects.filter((p) => p.pipelineRows.some((r) => r.da === da));
  const blklots = new Set<string>();
  if (master.blklot !== null) blklots.add(master.blklot);
  for (const r of o.pipeline) if (da !== null && r.da === da && r.blklot) blklots.add(r.blklot);
  for (const p of baseProjects) for (const b of p.blklots) blklots.add(b);
  for (const ph of entry?.phases ?? []) for (const b of ph.blklots) blklots.add(b);
  const descendants = master.blklot === null ? [] : o.descendants(master.blklot);
  const daParcels = o.resolve([...blklots].sort(cmp));
  // Main's ruling 3: a schedule-null (or uncurated) master's DA parcels add the descendants.
  const unenriched = entry === null || entry.schedule === null;
  const related = new Set([...baseProjects, ...daProjects]);
  return {
    daParcels: unenriched ? [...new Set([...daParcels, ...descendants])].sort(cmp) : daParcels,
    trackingParcels: master.blklot === null ? [] : o.resolve([master.blklot]),
    projectU: medianOf(completedUnits(related)),
    descendants,
    daProjects: related
  };
}

/**
 * Main's ruling 3 flag (no effect on netting), emitted after netting (Ruling B2): one warning per
 * descendant parcel of a master held by an in-flight project that is not a master, holds no
 * pipeline row with the master's `da`, does not hold the base-case PRJ and did not net this
 * master (`nettedBy`, project ids). `inFlight` are the in-flight non-master projects, in id
 * order; warnings come in (parcel, project id) order.
 */
export function descendantWarnings(
  caseNo: string,
  da: MasterDa,
  inFlight: readonly LinkedProject[],
  nettedBy: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  for (const id of da.descendants) {
    for (const p of inFlight) {
      if (da.daProjects.has(p) || nettedBy.has(p.id) || !p.parcelIds.includes(id)) continue;
      out.push(`${caseNo}: descendant parcel ${id} is held by ${p.id}, which is not a DA project`);
    }
  }
  return out;
}

/**
 * Phases every in-flight PRX master (after DA netting: a master netted to 0 is not passed) in the
 * given (id) order, each with its netted R as `units` and its `masterDa`. `excluded` starts as
 * the parcels of every non-master in-flight project and of every history ending complete; each
 * master's final parcels are added before the next master, and each master also excludes every
 * other given master's tracking parcels. The phase size u is the master's project median, else the
 * citywide median (>= 50 units, completed since 2015-01-01); `multiphase.u.<caseNo>` reports the u
 * buildPhases used (fallback only). A last resort with no free DA parcel is score-only (DQ-3),
 * counted in `multiphase.scoreOnly` and named in a warning. Adds the `multiphase.*` counts and
 * the buildPhases warnings to `counts` and `warnings`.
 */
export function phaseMasters(o: {
  masters: readonly { proj: LinkedProject; entitled: Day | null; units: number; da: MasterDa }[];
  excluded: Set<ParcelId>;
  projects: readonly LinkedProject[];
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

  for (const { proj, entitled, units, da } of o.masters) {
    const master = proj.pipelineRows[0];
    const caseNo = master.caseNo as string;
    // Every other in-flight master's tracking parcels are another in-flight project's parcels.
    const mine = new Set(excluded);
    for (const other of o.masters) {
      if (other.proj !== proj) for (const id of other.da.trackingParcels) mine.add(id);
    }

    const r = buildPhases({
      master,
      entry: entries.get(caseNo) ?? null,
      masterEntitled: entitled,
      units,
      daParcels: da.daParcels,
      excluded: mine,
      trackingParcels: da.trackingParcels,
      projectU: da.projectU,
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
    if (r.scoreOnly) {
      counts['multiphase.scoreOnly']++;
      o.warnings.push(`${caseNo}: no free DA parcel; score-only`);
    }
    if (r.u !== null) {
      counts[`multiphase.u.${caseNo}`] = r.u.u;
      counts[`multiphase.u.${caseNo}.n`] = r.u.n;
    }
    if (r.scale !== null) {
      counts[`multiphase.scale.${caseNo}`] = r.scale;
      scales[caseNo] = r.scale;
    }
    byId.set(proj.id, { phases: r.phases, parcelIds: r.parcelIds, scoreOnly: r.scoreOnly });
    for (const id of r.parcelIds) excluded.add(id);
  }
  return { byId, problems, lastResort, scales };
}
