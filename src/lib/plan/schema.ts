import { DATASET_VERSION_RE } from '../data/manifest';
import {
  CURRENT_SCHEMA,
  MAX_PLAN_BYTES,
  OPS_MAX,
  PATH_MAX_POINTS,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  SF_BBOX,
  STORIES_MAX,
  STORIES_MIN,
  TITLE_MAX_CHARS
} from './constants';
import { assertNever } from './geometry';
import type { Plan, PlanOp } from './types';

export type PlanErrorCode =
  | 'not-json'
  | 'not-object'
  | 'future-schema'
  | 'unknown-schema'
  | 'bad-field'
  | 'out-of-bounds'
  | 'too-many-ops'
  | 'too-many-points'
  | 'duplicate-id'
  | 'too-large';
export type PlanError = { path: string; code: PlanErrorCode; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: PlanError[] };
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const FUTURE_SCHEMA_MESSAGE =
  'This plan was made with a newer version of SF Housing Simulator. Reload the page to get the latest version.';

/** MIGRATIONS[n] maps raw schema n to n + 1. Empty in M1 (spec §4.8). */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

export function runMigrations(
  raw: Record<string, unknown>,
  registry: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = CURRENT_SCHEMA
): Record<string, unknown> {
  let cur = raw;
  while (typeof cur.schema === 'number' && Number.isInteger(cur.schema) && cur.schema < target) {
    const from = cur.schema;
    const step = registry[from];
    if (!step) break;
    cur = step(cur);
    if (cur.schema !== from + 1)
      throw new Error(`Migration ${from} must produce schema ${from + 1}`);
  }
  return cur;
}

export function quantize(deg: number): number {
  return Math.round(deg * 1e6) / 1e6;
}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const encoder = new TextEncoder();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function fail(path: string, code: PlanErrorCode, message: string): Result<never> {
  return { ok: false, errors: [{ path, code, message }] };
}

type Report = (path: string, code: PlanErrorCode, message: string) => void;

function validatePath(raw: unknown, at: string, bad: Report): [number, number][] {
  if (!Array.isArray(raw)) {
    bad(at, 'bad-field', 'path must be an array of [lng, lat] points.');
    return [];
  }
  if (raw.length === 0) {
    bad(at, 'bad-field', 'path needs at least one point.');
    return [];
  }
  if (raw.length > PATH_MAX_POINTS) {
    bad(at, 'too-many-points', `path has more than ${PATH_MAX_POINTS} points.`);
    return [];
  }
  const out: [number, number][] = [];
  raw.forEach((pt: unknown, j) => {
    const p = `${at}/${j}`;
    if (
      !Array.isArray(pt) ||
      pt.length !== 2 ||
      typeof pt[0] !== 'number' ||
      typeof pt[1] !== 'number'
    ) {
      bad(p, 'bad-field', 'Each point must be [lng, lat].');
      return;
    }
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
      bad(p, 'out-of-bounds', 'Point coordinates must be finite.');
      return;
    }
    const lng = quantize(pt[0]);
    const lat = quantize(pt[1]);
    if (lng < SF_BBOX[0] || lat < SF_BBOX[1] || lng > SF_BBOX[2] || lat > SF_BBOX[3]) {
      bad(p, 'out-of-bounds', 'The point is outside San Francisco.');
      return;
    }
    out.push([lng, lat]);
  });
  return out;
}

function validateOp(raw: unknown, at: string, report: Report, seen: Set<string>): PlanOp | null {
  if (!isPlainObject(raw)) {
    report(at, 'bad-field', 'Each op must be an object.');
    return null;
  }
  let ok = true;
  const bad: Report = (path, code, message) => {
    ok = false;
    report(path, code, message);
  };
  const { id, kind, stories, radiusM } = raw;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    bad(`${at}/id`, 'bad-field', 'id must be 1–32 characters of A–Z, a–z, 0–9, _ or -.');
  } else if (seen.has(id)) {
    bad(`${at}/id`, 'duplicate-id', `Duplicate op id "${id}".`);
  } else {
    seen.add(id);
  }
  if (kind !== 'paint' && kind !== 'erase')
    bad(`${at}/kind`, 'bad-field', 'kind must be paint or erase.');
  if (kind === 'paint') {
    if (typeof stories !== 'number') bad(`${at}/stories`, 'bad-field', 'A paint op needs stories.');
    else if (!Number.isInteger(stories) || stories < STORIES_MIN || stories > STORIES_MAX)
      bad(
        `${at}/stories`,
        'out-of-bounds',
        `stories must be an integer ${STORIES_MIN}–${STORIES_MAX}.`
      );
  }
  if (typeof radiusM !== 'number') bad(`${at}/radiusM`, 'bad-field', 'radiusM must be a number.');
  else if (!Number.isInteger(radiusM) || radiusM < RADIUS_MIN_M || radiusM > RADIUS_MAX_M)
    bad(
      `${at}/radiusM`,
      'out-of-bounds',
      `radiusM must be an integer ${RADIUS_MIN_M}–${RADIUS_MAX_M}.`
    );
  const path = validatePath(raw.path, `${at}/path`, bad);
  if (!ok) return null;
  return kind === 'paint'
    ? { id: id as string, kind, stories: stories as number, radiusM: radiusM as number, path }
    : { id: id as string, kind: 'erase', radiusM: radiusM as number, path };
}

/** Short, bounded description of an untrusted value; never serialises or recurses into it. */
function describeSchema(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'string') return String(v).slice(0, 40);
  if (v === null) return 'null';
  return Array.isArray(v) ? 'array' : typeof v;
}

export function validatePlan(raw: unknown): Result<Plan> {
  if (!isPlainObject(raw)) return fail('', 'not-object', 'A plan must be a JSON object.');
  if (raw.schema === undefined)
    return fail('/schema', 'unknown-schema', 'The plan has no schema version.');
  if (typeof raw.schema === 'number' && Number.isInteger(raw.schema) && raw.schema > CURRENT_SCHEMA)
    return fail('/schema', 'future-schema', FUTURE_SCHEMA_MESSAGE);
  const m = runMigrations(raw);
  if (m.schema !== CURRENT_SCHEMA)
    return fail('/schema', 'unknown-schema', `Unknown plan schema ${describeSchema(m.schema)}.`);

  const errors: PlanError[] = [];
  const report: Report = (path, code, message) => errors.push({ path, code, message });

  const { datasetVersion } = m;
  if (typeof datasetVersion !== 'string' || !DATASET_VERSION_RE.test(datasetVersion))
    report('/datasetVersion', 'bad-field', 'datasetVersion is not a valid dataset version.');

  let title: string | undefined;
  if (m.title !== undefined) {
    if (typeof m.title !== 'string') report('/title', 'bad-field', 'title must be a string.');
    else {
      const t = m.title.trim();
      if (t.length > TITLE_MAX_CHARS)
        report('/title', 'bad-field', `title is over ${TITLE_MAX_CHARS} characters.`);
      else if (t.length > 0) title = t;
    }
  }

  const ops: PlanOp[] = [];
  if (!Array.isArray(m.ops)) report('/ops', 'bad-field', 'ops must be an array.');
  else if (m.ops.length > OPS_MAX)
    report('/ops', 'too-many-ops', `A plan can have at most ${OPS_MAX} ops.`);
  else {
    const seen = new Set<string>();
    m.ops.forEach((o: unknown, i) => {
      const op = validateOp(o, `/ops/${i}`, report, seen);
      if (op) ops.push(op);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  const plan: Plan = { schema: CURRENT_SCHEMA, datasetVersion: datasetVersion as string, ops };
  if (title !== undefined) plan.title = title;
  if (planByteSize(plan) > MAX_PLAN_BYTES)
    return fail('', 'too-large', `The plan is larger than ${MAX_PLAN_BYTES / 1024} KB.`);
  return { ok: true, value: plan };
}

export function parsePlan(text: string): Result<Plan> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('', 'not-json', 'The plan is not valid JSON.');
  }
  return validatePlan(raw);
}

function serializeOp(op: PlanOp): Record<string, unknown> {
  const path = op.path.map(([lng, lat]) => [quantize(lng), quantize(lat)]);
  switch (op.kind) {
    case 'paint':
      return { id: op.id, kind: op.kind, stories: op.stories, radiusM: op.radiusM, path };
    case 'erase':
      return { id: op.id, kind: op.kind, radiusM: op.radiusM, path };
    default:
      return assertNever(op);
  }
}

/** Canonical compact JSON; fixed key order (spec §4.7). */
export function serializePlan(plan: Plan): string {
  const root: Record<string, unknown> = {
    schema: plan.schema,
    datasetVersion: plan.datasetVersion
  };
  if (plan.title !== undefined) root.title = plan.title;
  root.ops = plan.ops.map(serializeOp);
  return JSON.stringify(root);
}

export function planByteSize(plan: Plan): number {
  return encoder.encode(serializePlan(plan)).byteLength;
}

function checkVersion(datasetVersion: string): void {
  if (!DATASET_VERSION_RE.test(datasetVersion))
    throw new TypeError(`Invalid datasetVersion: ${JSON.stringify(datasetVersion)}`);
}

export function rebasePlan(plan: Plan, datasetVersion: string): Plan {
  checkVersion(datasetVersion);
  return { ...plan, datasetVersion, ops: plan.ops.slice() };
}

export function emptyPlan(datasetVersion: string): Plan {
  checkVersion(datasetVersion);
  return { schema: CURRENT_SCHEMA, datasetVersion, ops: [] };
}
