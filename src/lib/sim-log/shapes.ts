import { SIM_TITLE_MAX } from '$lib/members/copy';
import type { Effect, PolicyKind, Selector } from '$lib/timeline/policy4';
import { LogFormatError } from './types';

export type Fields = Record<string, unknown>;
export interface ShapeVersion {
  /** Exact keys and primitive types; throws LogFormatError at `path`. */
  parse(fields: unknown, path: string): Fields;
  /** Field name to its value check; only these may be `set`. */
  settable: Readonly<Record<string, (value: unknown, path: string) => unknown>>;
  /** To the next version; absent on the newest. */
  up?: {
    fields(f: Fields): Fields;
    set?(field: string, value: unknown): { field: string; value: unknown };
  };
}
export interface Registry {
  current: number;
  /** Revision to shape name to version (1-based). */
  revisions: Readonly<Record<number, Readonly<Record<string, number>>>>;
  /** Shape name to its versions, index 0 is version 1. Never shortened. */
  shapes: Readonly<Record<string, readonly ShapeVersion[]>>;
}

export const SHAPES_REVISION = 1;
export const DEFAULT_SIM_NAME = 'Untitled sim';

/** The rows of revision 1, frozen: a policy's kind, its selector tag and its effect tag. */
export const WHERE_ROWS: readonly {
  kind: PolicyKind;
  where: Selector['tag'];
  what: Effect['tag'];
}[] = [
  { kind: 'zoning', where: 'transit', what: 'bands' },
  { kind: 'zoning', where: 'painted', what: 'brushes' },
  { kind: 'zoning', where: 'category', what: 'protect' },
  { kind: 'permitting', where: 'routes', what: 'timing' },
  { kind: 'money', where: 'baseline', what: 'scales' },
  { kind: 'money', where: 'fund', what: 'fund' },
  { kind: 'money', where: 'terms', what: 'terms' }
];

const POLICY_ID_MAX = 80;
const LABEL_MAX = 80;

function fail(path: string, message: string): never {
  throw new LogFormatError(path, message);
}
const j = (base: string, k: string) => (base === '' ? k : `${base}.${k}`);
const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function exact(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!isPlain(v)) fail(path, 'expected an object');
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(j(path, k), 'unknown key');
  for (const k of keys) if (!(k in v)) fail(j(path, k), 'missing');
  return v;
}
function text(v: unknown, path: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max)
    fail(path, `expected a string of ${min} to ${max} characters`);
  return v;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}
function day(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'expected a day');
  return v;
}
function finite(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}
/** An object with the given tag; with `keys`, those are the only other keys it may have. */
function tagged(v: unknown, path: string, tag: string, keys?: readonly string[]): Fields {
  if (!isPlain(v)) fail(path, 'expected an object');
  if (v.tag !== tag) fail(j(path, 'tag'), `expected ${tag}`);
  if (keys)
    for (const k of Object.keys(v))
      if (k !== 'tag' && !keys.includes(k)) fail(j(path, k), 'unknown key');
  return { ...v };
}

/** The sim name check (R42): a string, trimmed, 1 to SIM_TITLE_MAX characters. */
export function checkName(v: unknown, path: string): string {
  const s = text(v, path, 1, SIM_TITLE_MAX);
  if (s !== s.trim()) fail(path, 'expected a name without leading or trailing whitespace');
  return s;
}

const simShape: ShapeVersion = {
  parse(fields, path) {
    const r = exact(fields, path, ['name']);
    return { name: checkName(r.name, j(path, 'name')) };
  },
  settable: { name: checkName }
};

function policyShape(row: (typeof WHERE_ROWS)[number]): ShapeVersion {
  return {
    parse(fields, path) {
      const r = exact(fields, path, ['id', 'kind', 'where', 'label', 'preset', 'on']);
      const preset =
        r.preset === null ? null : text(r.preset, j(path, 'preset'), 0, Number.MAX_SAFE_INTEGER);
      if (r.kind !== row.kind) fail(j(path, 'kind'), `expected ${row.kind}`);
      return {
        id: text(r.id, j(path, 'id'), 1, POLICY_ID_MAX),
        kind: row.kind,
        where: tagged(r.where, j(path, 'where'), row.where),
        label: text(r.label, j(path, 'label'), 0, LABEL_MAX),
        preset,
        on: bool(r.on, j(path, 'on'))
      };
    },
    settable: {
      label: (v, p) => text(v, p, 0, LABEL_MAX),
      on: bool
    }
  };
}

function spanShape(row: (typeof WHERE_ROWS)[number]): ShapeVersion {
  return {
    parse(fields, path) {
      const r = exact(fields, path, ['policy', 'from', 'to', 'what']);
      const wp = j(path, 'what');
      const what = tagged(r.what, wp, row.what, row.what === 'brushes' ? [] : undefined);
      return {
        policy: text(r.policy, j(path, 'policy'), 1, POLICY_ID_MAX),
        from: day(r.from, j(path, 'from')),
        to: r.to === null ? null : day(r.to, j(path, 'to')),
        what
      };
    },
    settable: {}
  };
}

const strokeShape: ShapeVersion = {
  parse(fields, path) {
    const r = exact(fields, path, ['span', 'brush', 'kind', 'stories', 'path', 'radiusM']);
    if (r.kind !== 'paint' && r.kind !== 'erase') fail(j(path, 'kind'), 'expected paint or erase');
    let stories: number | null;
    if (r.kind === 'paint') {
      if (typeof r.stories !== 'number' || !Number.isInteger(r.stories))
        fail(j(path, 'stories'), 'expected a whole number for a paint stroke');
      stories = r.stories;
    } else {
      if (r.stories !== null) fail(j(path, 'stories'), 'expected null for an erase stroke');
      stories = null;
    }
    const pp = j(path, 'path');
    if (!Array.isArray(r.path)) fail(pp, 'expected an array');
    const pts = r.path.map((pt, i): [number, number] => {
      if (!Array.isArray(pt) || pt.length !== 2) fail(`${pp}[${i}]`, 'expected a pair of numbers');
      return [finite(pt[0], `${pp}[${i}][0]`), finite(pt[1], `${pp}[${i}][1]`)];
    });
    return {
      span: text(r.span, j(path, 'span'), 1, Number.MAX_SAFE_INTEGER),
      brush: text(r.brush, j(path, 'brush'), 1, Number.MAX_SAFE_INTEGER),
      kind: r.kind,
      stories,
      path: pts,
      radiusM: finite(r.radiusM, j(path, 'radiusM'))
    };
  },
  settable: {}
};

const shapes: Record<string, readonly ShapeVersion[]> = { sim: [simShape], stroke: [strokeShape] };
for (const row of WHERE_ROWS) {
  shapes[`policy.${row.where}`] = [policyShape(row)];
  shapes[`span.${row.where}`] = [spanShape(row)];
}

export const REGISTRY: Registry = {
  current: SHAPES_REVISION,
  revisions: { 1: Object.fromEntries(Object.keys(shapes).map((n) => [n, 1])) },
  shapes
};
