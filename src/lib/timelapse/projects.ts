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
  /** current mapblklot, mapped through retired-parcel lineage */
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
  projects: InFlightProject[];
};

export const PROJECT_ID_RE = /^(PRJ:[^:]+(:BP:[^:]+)?|BP:[^:]+|CASE:[^:]+|PPA:[^:]+)$/;

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

function checkProject(
  v: unknown,
  path: string,
  asOf: number,
  seen: Set<string>,
  parcelIds: ReadonlySet<ParcelId> | undefined
): void {
  const p = obj(v, path);

  const id = str(p.id, `${path}.id`);
  if (!PROJECT_ID_RE.test(id)) fail(`${path}.id`, 'is not a valid project id');
  if (seen.has(id)) fail(`${path}.id`, `duplicate id ${id}`);
  seen.add(id);

  if (p.label !== null) str(p.label, `${path}.label`);

  checkParcelIds(p.parcelIds, `${path}.parcelIds`, true, parcelIds, true);

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
}

/**
 * Validates a parsed `projects.json`, throwing `ProjectsFormatError` at the first violation.
 * With `opts.asOf` the file's `asOf` must match it; with `opts.parcelIds` every parcel id must be
 * in the set. Returns the input, typed.
 */
export function parseProjectsFile(
  json: unknown,
  opts?: { asOf?: Day; parcelIds?: ReadonlySet<ParcelId> }
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

  const seen = new Set<string>();
  arr(root.projects, 'projects').forEach((proj, i) =>
    checkProject(proj, `projects[${i}]`, asOf, seen, opts?.parcelIds)
  );
  return json as ProjectsFile;
}
