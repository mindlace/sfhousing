/**
 * T3: in-flight project records and the `scenarios/fzp/projects.json` file type, with a validator.
 *
 * Owned by project-records. The validator is shared by the pipeline invariant V20 (which adds the
 * serialised-size budget, measured on the file rather than the parsed value) and the runtime
 * consumers (timelapse-sim, fzp-mode). Relative imports only: the pipeline imports this file by
 * path. Worker-safe: no zod, no DOM. Cross-project phase rules are V24, not here.
 */
import type { ParcelId } from '../data/parcel';
import type { Day } from './time';
import { PATHWAYS, STAGE_ORDER, type Pathway, type Provenance, type Stage } from './types';

export interface InFlightProject {
  /** 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */
  id: string;
  /** street address from the records, if any */
  label: string | null;
  /** current mapblklot, mapped through retired-parcel lineage; [] only for a score-only last-resort master (multiPhase, phases null, quality includes 'pr.multiphase.score-only'): no free DA parcel (DQ-3) */
  parcelIds: ParcelId[];
  pathway: Pathway;
  stage: Stage;
  /** observed entry days */
  history: Partial<Record<Stage, Day>>;
  units: number;
  existingUnits: number;
  stories: number | null;
  /** 0 = recorded field, 3 = parsed from description text */
  storiesTier: 0 | 3 | null;
  /** PRX/DA remaining-phase row */
  multiPhase: boolean;
  /** multi-phase only: null until enriched, then each phase is simulated as its own sub-project */
  phases:
    | {
        units: number;
        parcelIds: ParcelId[];
        /** from the DA phasing schedule, if enriched */
        plannedPermitFiled: Day | null;
        source: { label: string; url: string; retrieved: string } | null;
      }[]
    | null;
  sources: {
    dataset: string;
    id: string;
    /** field to query, e.g. 'case_no'; absent = the dataset's record-id field */
    key?: string;
  }[];
  /** sorted T14 rule ids that changed or estimated a value of this project; [] if none */
  quality: string[];
}

/** One `qualityRules` entry: a T14 rule named by some project's `quality`. */
export interface QualityRuleRef {
  id: string;
  /** generic, about the rule, never naming a record */
  label: string;
  /** of the rule */
  tier: 2 | 3 | 4;
  /** of the value it writes; null if it writes none */
  valueTier: 0 | 1 | 2 | 3 | 4 | null;
}

/** The `scenarios/fzp/projects.json` object. Projects are new construction only. */
export type ProjectsFile = {
  schema: 1;
  asOf: Day;
  rhnaCompletedNet: {
    /** net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */
    units: number;
    /** 2022-06-30, RHNA projection period start */
    since: Day;
    provenance: Provenance;
  };
  /** every id used in any project's quality, sorted by id */
  qualityRules: QualityRuleRef[];
  projects: InFlightProject[];
};

export const PROJECT_ID_RE = /^(PRJ:[^:]+(:BP:[^:]+)?|BP:[^:]+|CASE:[^:]+|PPA:[^:]+)$/;

/** The `quality` id that marks a score-only master, the only project with empty `parcelIds`. */
export const SCORE_ONLY_QUALITY_ID = 'pr.multiphase.score-only';

/** Thrown at the first violation. `path` locates it, e.g. `projects[3].history.filed`. */
export class ProjectsFormatError extends Error {
  readonly path: string;

  constructor(path: string, problem: string) {
    super(`projects.json ${path}: ${problem}`);
    this.name = 'ProjectsFormatError';
    this.path = path;
  }
}

function fail(path: string, problem: string): never {
  throw new ProjectsFormatError(path, problem);
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) fail(path, 'must be an object');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'must be a string');
  return v;
}

function int(v: unknown, path: string, min?: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'must be an integer');
  if (min !== undefined && v < min) fail(path, `must be >= ${min}`);
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be an array');
  return v;
}

function checkProvenance(v: unknown, path: string): void {
  const p = obj(v, path);
  const tier = int(p.tier, `${path}.tier`);
  if (tier < 0 || tier > 4) fail(`${path}.tier`, 'must be an integer 0..4');
  for (const k of ['label', 'method'] as const) {
    if (str(p[k], `${path}.${k}`) === '') fail(`${path}.${k}`, 'must be non-empty');
  }
  const sources = arr(p.sources, `${path}.sources`);
  sources.forEach((s, i) => {
    const so = obj(s, `${path}.sources[${i}]`);
    str(so.label, `${path}.sources[${i}].label`);
    str(so.url, `${path}.sources[${i}].url`);
  });
  if (p.n !== undefined && (typeof p.n !== 'number' || !Number.isFinite(p.n))) {
    fail(`${path}.n`, 'must be a finite number');
  }
  if (p.window !== undefined) {
    const w = arr(p.window, `${path}.window`);
    if (w.length !== 2) fail(`${path}.window`, 'must have two entries');
    w.forEach((x, i) => str(x, `${path}.window[${i}]`));
  }
}

function checkParcelIds(
  v: unknown,
  path: string,
  nonEmpty: boolean,
  known: ReadonlySet<ParcelId> | undefined,
  ascending: boolean
): void {
  const ids = arr(v, path);
  if (nonEmpty && ids.length === 0) fail(path, 'must be non-empty');
  ids.forEach((id, i) => {
    const p = `${path}[${i}]`;
    str(id, p);
    if (ascending && i > 0 && !((ids[i - 1] as string) < (id as string))) {
      fail(p, 'must be strictly ascending');
    }
    if (known && !known.has(id as string)) fail(p, 'is not in the parcel set');
  });
}

function checkHistory(h: unknown, path: string, asOf: number, pathway: Pathway): Stage {
  const hist = obj(h, path);
  const keys = Object.keys(hist);
  if (keys.length === 0) fail(path, 'must be non-empty');
  for (const k of keys) {
    const p = `${path}.${k}`;
    if (!(STAGE_ORDER as readonly string[]).includes(k)) fail(p, 'is not a stage');
    if (int(hist[k], p) > asOf) fail(p, 'must be <= asOf');
    if (pathway === 'permitOnly' && (k === 'filed' || k === 'entitled')) {
      fail(p, 'is not a permitOnly stage');
    }
  }
  let last: Stage | null = null;
  let lastDay = -Infinity;
  for (const s of STAGE_ORDER) {
    if (!(s in hist)) continue;
    const day = hist[s] as number;
    if (day < lastDay) fail(`${path}.${s}`, `must not precede ${last}`);
    last = s;
    lastDay = day;
  }
  return last as Stage;
}

function checkPhase(v: unknown, path: string): void {
  const ph = obj(v, path);
  int(ph.units, `${path}.units`, 1);
  checkParcelIds(ph.parcelIds, `${path}.parcelIds`, false, undefined, false);
  if (ph.plannedPermitFiled !== null) int(ph.plannedPermitFiled, `${path}.plannedPermitFiled`);
  if (ph.source !== null) {
    const sp = `${path}.source`;
    const src = obj(ph.source, sp);
    for (const k of ['label', 'url', 'retrieved'] as const) str(src[k], `${sp}.${k}`);
  }
}

/** `prev` and `cur` are consecutive entries of a list that must be sorted and unique. */
function checkAfter(prev: string, cur: string, path: string): void {
  if (cur === prev) fail(path, `duplicate id ${cur}`);
  if (cur < prev) fail(path, 'must be sorted ascending');
}

/** A score-only last-resort master (DQ-3): the only project allowed empty `parcelIds`. */
function isScoreOnly(p: Obj): boolean {
  return (
    p.multiPhase === true &&
    p.phases === null &&
    Array.isArray(p.quality) &&
    p.quality.includes(SCORE_ONLY_QUALITY_ID)
  );
}

function checkQuality(v: unknown, path: string, ruleIds: ReadonlySet<string>): void {
  const ids = arr(v, path);
  ids.forEach((id, i) => {
    const p = `${path}[${i}]`;
    str(id, p);
    if (i > 0) checkAfter(ids[i - 1] as string, id as string, p);
    if (!ruleIds.has(id as string)) fail(p, 'is not in qualityRules');
  });
}

/** The file-level `qualityRules` checks; returns the listed ids. */
function checkQualityRules(v: unknown, projects: unknown[]): Set<string> {
  const used = new Set<string>();
  for (const p of projects) {
    if (!isObj(p) || !Array.isArray(p.quality)) continue;
    for (const id of p.quality) if (typeof id === 'string') used.add(id);
  }
  const rules = arr(v, 'qualityRules');
  const ids = new Set<string>();
  rules.forEach((r, i) => {
    const path = `qualityRules[${i}]`;
    const rule = obj(r, path);
    const id = str(rule.id, `${path}.id`);
    if (i > 0) checkAfter((rules[i - 1] as Obj).id as string, id, `${path}.id`);
    if (!used.has(id)) fail(`${path}.id`, 'is not used by any project');
    if (str(rule.label, `${path}.label`) === '') fail(`${path}.label`, 'must be non-empty');
    if (rule.tier !== 2 && rule.tier !== 3 && rule.tier !== 4) {
      fail(`${path}.tier`, 'must be 2, 3 or 4');
    }
    if (rule.valueTier !== null) {
      const vt = int(rule.valueTier, `${path}.valueTier`);
      if (vt < 0 || vt > 4) fail(`${path}.valueTier`, 'must be an integer 0..4 or null');
    }
    ids.add(id);
  });
  return ids;
}

function checkProject(
  v: unknown,
  path: string,
  asOf: number,
  seen: Set<string>,
  parcelIds: ReadonlySet<ParcelId> | undefined,
  ruleIds: ReadonlySet<string>
): void {
  const p = obj(v, path);

  const id = str(p.id, `${path}.id`);
  if (!PROJECT_ID_RE.test(id)) fail(`${path}.id`, 'is not a valid project id');
  if (seen.has(id)) fail(`${path}.id`, `duplicate id ${id}`);
  seen.add(id);

  if (p.label !== null) str(p.label, `${path}.label`);

  checkParcelIds(p.parcelIds, `${path}.parcelIds`, !isScoreOnly(p), parcelIds, true);

  if (!(PATHWAYS as readonly unknown[]).includes(p.pathway)) {
    fail(`${path}.pathway`, 'is not a pathway');
  }
  const pathway = p.pathway as Pathway;

  const lastStage = checkHistory(p.history, `${path}.history`, asOf, pathway);
  if (p.stage !== lastStage)
    fail(`${path}.stage`, `must equal the last history stage ${lastStage}`);

  const units = int(p.units, `${path}.units`, 1);
  const existingUnits = int(p.existingUnits, `${path}.existingUnits`, 0);
  if (typeof p.multiPhase !== 'boolean') fail(`${path}.multiPhase`, 'must be a boolean');
  if (units - existingUnits < 1 && !p.multiPhase) {
    fail(`${path}.units`, 'must exceed existingUnits unless multiPhase');
  }

  if (p.stories !== null) {
    const stories = int(p.stories, `${path}.stories`);
    if (stories < 1 || stories > 80) fail(`${path}.stories`, 'must be an integer 1..80');
    if (p.storiesTier !== 0 && p.storiesTier !== 3) fail(`${path}.storiesTier`, 'must be 0 or 3');
  } else if (p.storiesTier !== null) {
    fail(`${path}.storiesTier`, 'must be null when stories is null');
  }

  if (!p.multiPhase) {
    if (p.phases !== null) fail(`${path}.phases`, 'must be null unless multiPhase');
  } else if (p.phases !== null) {
    arr(p.phases, `${path}.phases`).forEach((ph, i) => checkPhase(ph, `${path}.phases[${i}]`));
  }

  const sources = arr(p.sources, `${path}.sources`);
  if (sources.length === 0) fail(`${path}.sources`, 'must be non-empty');
  sources.forEach((s, i) => {
    const sp = `${path}.sources[${i}]`;
    const so = obj(s, sp);
    str(so.dataset, `${sp}.dataset`);
    str(so.id, `${sp}.id`);
    if (so.key !== undefined) str(so.key, `${sp}.key`);
  });

  checkQuality(p.quality, `${path}.quality`, ruleIds);
}

/**
 * Validates a parsed `projects.json`. With `opts.asOf` the file's `asOf` must match it; with
 * `opts.parcelIds` every parcel id must be in the set.
 *
 * File-level checks (`schema`, `asOf`, `rhnaCompletedNet`, `projects` being an array, and every
 * `qualityRules` check, whose "used by a project" check reads the input array) always throw
 * `ProjectsFormatError`, before any project is checked. Project-level checks cover one element
 * of `projects`; of two elements with the same id, the later is invalid.
 *
 * Without `opts.onInvalid` the first violation throws and the input is returned, typed (V20).
 * With it, each invalid project is reported once, with its first violation's path and message,
 * and left out; the result is a shallow copy of the input with the remaining `projects`, and
 * the input is not mutated.
 */
export function parseProjectsFile(
  json: unknown,
  opts?: {
    asOf?: Day;
    parcelIds?: ReadonlySet<ParcelId>;
    onInvalid?: (path: string, message: string) => void;
  }
): ProjectsFile {
  const root = obj(json, '$');
  if (root.schema !== 1) fail('schema', 'must be 1');
  const asOf = int(root.asOf, 'asOf');
  if (opts?.asOf !== undefined && asOf !== opts.asOf) {
    fail('asOf', `must equal the snapshot day ${opts.asOf}`);
  }

  const rhna = obj(root.rhnaCompletedNet, 'rhnaCompletedNet');
  int(rhna.units, 'rhnaCompletedNet.units');
  int(rhna.since, 'rhnaCompletedNet.since');
  checkProvenance(rhna.provenance, 'rhnaCompletedNet.provenance');

  const projects = arr(root.projects, 'projects');
  const ruleIds = checkQualityRules(root.qualityRules, projects);

  const seen = new Set<string>();
  const onInvalid = opts?.onInvalid;
  if (!onInvalid) {
    projects.forEach((proj, i) =>
      checkProject(proj, `projects[${i}]`, asOf, seen, opts?.parcelIds, ruleIds)
    );
    return json as ProjectsFile;
  }
  const kept = projects.filter((proj, i) => {
    try {
      checkProject(proj, `projects[${i}]`, asOf, seen, opts.parcelIds, ruleIds);
      return true;
    } catch (e) {
      if (!(e instanceof ProjectsFormatError)) throw e;
      onInvalid(e.path, e.message);
      return false;
    }
  });
  return { ...(root as ProjectsFile), projects: kept as InFlightProject[] };
}
