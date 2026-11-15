import { isValidId } from '$lib/ids/base58';
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
import { FIRST_DAY, LAST_DAY } from '$lib/sim/levers/finance';
import type { Day } from '$lib/timelapse/time';
import {
  BUILD_MAX,
  KEY_MAX,
  LABEL_MAX,
  LogFormatError,
  SOURCE_MAX,
  SOURCE_RE,
  type Change,
  type Commit,
  type CommitDraft,
  type CommitKind,
  type Restores
} from './types';

const KINDS = ['edit', 'restore', 'system'] as const;
const AS = ['undo', 'redo', 'jump'] as const;
const OPS = ['add', 'end', 'move', 'set', 'delete'] as const;
const DRAFT_KEYS = [
  'id',
  'parent',
  'kind',
  'label',
  'restores',
  'datasetVersion',
  'shapes',
  'build',
  'source',
  'changes'
] as const;
const COMMIT_KEYS = [...DRAFT_KEYS, 'seq', 'actor', 'at', 'hash'] as const;

function fail(path: string, message: string): never {
  throw new LogFormatError(path, message);
}
const j = (base: string, k: string) => (base === '' ? k : `${base}.${k}`);

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function rec(
  v: unknown,
  path: string,
  keys: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (!isPlain(v)) fail(path || '$', 'expected an object');
  for (const k of Object.keys(v)) {
    if (!keys.includes(k) && !optional.includes(k)) fail(j(path, k), 'unknown key');
  }
  for (const k of keys) if (!(k in v)) fail(j(path, k), 'missing');
  return v;
}
function str(v: unknown, path: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max)
    fail(path, `expected a string of ${min} to ${max} characters`);
  return v;
}
function int(v: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    fail(path, `expected a whole number from ${min} to ${max}`);
  return v;
}
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T))
    fail(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}
function after(v: unknown, path: string): string | null {
  return v === null ? null : str(v, path, 1, KEY_MAX);
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return isPlain(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function json(v: unknown, path: string): void {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail(path, 'expected a finite number');
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => json(x, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) json(v[k], j(path, k));
    return;
  }
  fail(path, 'expected a JSON value');
}

export function parseChange(v: unknown, path: string): Change {
  if (!isPlain(v)) fail(path, 'expected an object');
  const op = oneOf(v.op, j(path, 'op'), OPS);
  const key = (r: Record<string, unknown>) => str(r.key, j(path, 'key'), 1, KEY_MAX);
  switch (op) {
    case 'add': {
      const r = rec(v, path, ['op', 'key', 'shape', 'fields'], ['after']);
      const k = key(r);
      const shape = str(r.shape, j(path, 'shape'), 1, KEY_MAX);
      const fp = j(path, 'fields');
      if (!isPlainObject(r.fields)) fail(fp, 'expected an object');
      json(r.fields, fp);
      const c: Change = { op, key: k, shape, fields: r.fields };
      if ('after' in r) c.after = after(r.after, j(path, 'after'));
      return c;
    }
    case 'end': {
      const r = rec(v, path, ['op', 'key', 'to']);
      const k = key(r);
      const to: Day = int(r.to, j(path, 'to'), FIRST_DAY, LAST_DAY);
      return { op, key: k, to };
    }
    case 'move': {
      const r = rec(v, path, ['op', 'key', 'after']);
      return { op, key: key(r), after: after(r.after, j(path, 'after')) };
    }
    case 'set': {
      const r = rec(v, path, ['op', 'key', 'field', 'value']);
      const k = key(r);
      const field = str(r.field, j(path, 'field'), 1, KEY_MAX);
      const value = r.value;
      const ok =
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value));
      if (!ok) fail(j(path, 'value'), 'expected a string, finite number, boolean or null');
      return { op, key: k, field, value: value as string | number | boolean | null };
    }
    default: {
      const r = rec(v, path, ['op', 'key']);
      return { op, key: key(r) };
    }
  }
}

function parseRestores(v: unknown, path: string, parent: number): Restores {
  const r = rec(v, path, ['position', 'as']);
  return {
    position: int(r.position, j(path, 'position'), 0, parent),
    as: oneOf(r.as, j(path, 'as'), AS)
  };
}

function parseFields(r: Record<string, unknown>): CommitDraft {
  const id = r.id;
  if (typeof id !== 'string' || !isValidId(id)) fail('id', 'expected a valid id');
  const parent = int(r.parent, 'parent', 0);
  const kind: CommitKind = oneOf(r.kind, 'kind', KINDS);
  const label = str(r.label, 'label', 0, LABEL_MAX);
  let restores: Restores | null = null;
  if (kind === 'restore') {
    if (r.restores === null) fail('restores', 'required for a restore');
    restores = parseRestores(r.restores, 'restores', parent);
  } else if (r.restores !== null) fail('restores', 'only a restore has restores');
  const datasetVersion = r.datasetVersion;
  if (typeof datasetVersion !== 'string' || !DATASET_VERSION_RE.test(datasetVersion))
    fail('datasetVersion', 'expected a dataset version');
  const shapes = int(r.shapes, 'shapes', 1);
  const build = str(r.build, 'build', 1, BUILD_MAX);
  const source = r.source;
  if (typeof source !== 'string' || source.length > SOURCE_MAX || !SOURCE_RE.test(source))
    fail('source', 'expected a source code');
  if (!Array.isArray(r.changes) || r.changes.length === 0)
    fail('changes', 'expected a non-empty array');
  const changes = r.changes.map((c, i) => parseChange(c, `changes[${i}]`));
  return { id, parent, kind, label, restores, datasetVersion, shapes, build, source, changes };
}

export function parseCommitDraft(v: unknown): CommitDraft {
  return parseFields(rec(v, '', DRAFT_KEYS));
}

export function parseCommit(v: unknown): Commit {
  const r = rec(v, '', COMMIT_KEYS);
  const draft = parseFields(r);
  const seq = int(r.seq, 'seq', 1);
  if (draft.parent !== seq - 1) fail('parent', 'expected seq - 1');
  const actor = str(r.actor, 'actor', 1, 64);
  const at = int(r.at, 'at', 0);
  const hash = r.hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))
    fail('hash', 'expected 64 lowercase hex characters');
  return { ...draft, seq, actor, at, hash };
}
