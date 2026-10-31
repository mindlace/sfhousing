/**
 * The /sim policy document: what is autosaved, published and remixed. A `SimPolicy` plus the
 * dataset it was made against and an optional title, in a canonical text form with size limits.
 * Pure TS (the server validates published documents with it): no Svelte, no DOM.
 */
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import {
  FUTURE_SCHEMA_MESSAGE,
  MAX_PLAN_BYTES,
  OPS_MAX,
  PATH_MAX_POINTS,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  SF_BBOX,
  TITLE_MAX_CHARS,
  quantize,
  type PlanError,
  type PlanErrorCode,
  type Result
} from '$lib/plan';
import type { DocCodec } from '$lib/sharing/doc-codec';
import { normalizeTitle } from '$lib/sharing/title';
import {
  PolicyFormatError,
  canonicalJson,
  parseSimPolicy,
  policyFromLevers,
  type SimPolicy,
  type Stroke
} from './policy';

export const SIM_DOC_SCHEMA = 1;
/** The autosave key for the /sim policy. */
export const SIM_KEY = 'sfhousing:sim:v1';

export interface SimDoc {
  schema: 1;
  kind: 'sim';
  datasetVersion: string;
  title?: string;
  policy: SimPolicy;
}

export const DEFAULT_POLICY: SimPolicy = policyFromLevers(DEFAULT_LEVERS);

const withoutSnapshot = (p: SimPolicy): SimPolicy => ({
  ...p,
  timing: { ...p.timing, saved: null }
});

/** The policy equals the default one, ignoring the saved timing snapshot. */
export function isDefaultPolicy(p: SimPolicy): boolean {
  return canonicalJson(withoutSnapshot(p)) === canonicalJson(DEFAULT_POLICY);
}

// ---- limits ----

const MAX_PROBLEMS = 20;
const encoder = new TextEncoder();

function strokeLists(p: SimPolicy): { at: string; strokes: readonly Stroke[] }[] {
  const lists: { at: string; strokes: readonly Stroke[] }[] = [];
  p.brushes.forEach((b, i) => {
    if (b.kind === 'freehand' || b.kind === 'erase')
      lists.push({ at: `/policy/brushes/${i}/strokes`, strokes: b.strokes });
  });
  lists.push({ at: '/policy/protect/strokes', strokes: p.protect.strokes });
  return lists;
}

/** The size and range limits (Call 4) a parsed document must meet; the byte size comes last. */
export function simDocProblems(d: SimDoc): PlanError[] {
  const errors: PlanError[] = [];
  const bad = (path: string, code: PlanErrorCode, message: string) => {
    if (errors.length < MAX_PROBLEMS) errors.push({ path, code, message });
  };
  const lists = strokeLists(d.policy);
  const total = lists.reduce((n, l) => n + l.strokes.length, 0);
  if (total > OPS_MAX) {
    bad('/policy', 'too-many-ops', `A policy can have at most ${OPS_MAX} strokes.`);
    return errors;
  }
  for (const { at, strokes } of lists) {
    strokes.forEach((s, i) => {
      const sp = `${at}/${i}`;
      if (!Number.isInteger(s.radiusM) || s.radiusM < RADIUS_MIN_M || s.radiusM > RADIUS_MAX_M)
        bad(
          `${sp}/radiusM`,
          'out-of-bounds',
          `radiusM must be an integer ${RADIUS_MIN_M}–${RADIUS_MAX_M}.`
        );
      if (s.path.length === 0)
        return bad(`${sp}/path`, 'bad-field', 'path needs at least one point.');
      if (s.path.length > PATH_MAX_POINTS)
        return bad(
          `${sp}/path`,
          'too-many-points',
          `path has more than ${PATH_MAX_POINTS} points.`
        );
      s.path.forEach(([lng, lat], k) => {
        const x = quantize(lng);
        const y = quantize(lat);
        if (x < SF_BBOX[0] || y < SF_BBOX[1] || x > SF_BBOX[2] || y > SF_BBOX[3])
          bad(`${sp}/path/${k}`, 'out-of-bounds', 'The point is outside San Francisco.');
      });
    });
  }
  if (errors.length === 0 && encoder.encode(serializeSimDoc(d)).byteLength > MAX_PLAN_BYTES)
    bad('', 'too-large', `The policy is larger than ${MAX_PLAN_BYTES / 1024} KB.`);
  return errors;
}

// ---- parse and serialize ----

const fail = (path: string, code: PlanErrorCode, message: string): Result<never> => ({
  ok: false,
  errors: [{ path, code, message }]
});

/** `timing.saved.set.preset` and `brushes[0].id` as `/timing/saved/set/preset`, `/brushes/0/id`. */
function pointer(policyPath: string): string {
  const segs = policyPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s && s !== '$');
  return segs.map((s) => `/${s}`).join('');
}

/**
 * Parse a stored (`'reconcile'`, lenient: the preset layer is re-derived later) or published
 * (`'strict'`) document. A schema above 1 is `future-schema` in both modes.
 */
export function parseSimDoc(text: string, mode: 'strict' | 'reconcile'): Result<SimDoc> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('', 'not-json', 'The policy is not valid JSON.');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return fail('', 'not-object', 'A policy must be a JSON object.');
  const r = json as Record<string, unknown>;
  if (typeof r.schema === 'number' && Number.isInteger(r.schema) && r.schema > SIM_DOC_SCHEMA)
    return fail('/schema', 'future-schema', FUTURE_SCHEMA_MESSAGE);
  if (r.schema !== SIM_DOC_SCHEMA)
    return fail('/schema', 'unknown-schema', 'The policy has an unknown schema version.');
  if (r.kind !== 'sim') return fail('/kind', 'unknown-schema', 'This is not a policy document.');

  if (typeof r.datasetVersion !== 'string' || !DATASET_VERSION_RE.test(r.datasetVersion))
    return fail('/datasetVersion', 'bad-field', 'datasetVersion is not a valid dataset version.');
  let title: string | undefined;
  if (r.title !== undefined) {
    if (typeof r.title !== 'string') return fail('/title', 'bad-field', 'title must be a string.');
    const t = r.title.trim();
    if (t.length > TITLE_MAX_CHARS)
      return fail('/title', 'bad-field', `title is over ${TITLE_MAX_CHARS} characters.`);
    if (t.length > 0) title = t;
  }

  let policy: SimPolicy;
  try {
    policy = parseSimPolicy(r.policy, {
      presetLayer: mode === 'strict' ? 'strict' : 'reconcile'
    });
  } catch (e) {
    if (e instanceof PolicyFormatError)
      return fail(`/policy${pointer(e.path)}`, 'bad-field', e.message);
    throw e;
  }
  const d: SimDoc = { schema: 1, kind: 'sim', datasetVersion: r.datasetVersion, policy };
  if (title !== undefined) d.title = title;
  const problems = simDocProblems(d);
  return problems.length > 0 ? { ok: false, errors: problems } : { ok: true, value: d };
}

const quantizeStroke = <S extends Stroke>(s: S): S => ({
  ...s,
  path: s.path.map(([lng, lat]) => [quantize(lng), quantize(lat)] as [number, number])
});

/** Canonical compact JSON: keys sorted, coordinates quantized to 6 decimals. */
export function serializeSimDoc(d: SimDoc): string {
  const p = d.policy;
  const policy: SimPolicy = {
    ...p,
    brushes: p.brushes.map((b) =>
      b.kind === 'freehand' || b.kind === 'erase'
        ? { ...b, strokes: b.strokes.map(quantizeStroke) }
        : b
    ),
    protect: { ...p.protect, strokes: p.protect.strokes.map(quantizeStroke) }
  };
  return canonicalJson({ ...d, policy });
}

export const SIM_CODEC: DocCodec<SimDoc> = {
  kind: 'sim',
  api: '/api/policies',
  path: (id) => `/s/${id}`,
  storageKey: SIM_KEY,
  corruptKey: (iso) => `sfhousing:sim:corrupt:${iso}`,
  parse: (text) => parseSimDoc(text, 'strict'),
  load: (text) => parseSimDoc(text, 'reconcile'),
  serialize: serializeSimDoc,
  publishable: (d) => ({ ...d, policy: withoutSnapshot(d.policy) }),
  schema: (d) => d.schema,
  datasetVersion: (d) => d.datasetVersion,
  rebase: (d, version) => ({ ...d, datasetVersion: version }),
  empty: (version) => ({ schema: 1, kind: 'sim', datasetVersion: version, policy: DEFAULT_POLICY }),
  isEmpty: (d) => isDefaultPolicy(d.policy),
  opCount: (d) => d.policy.brushes.length + d.policy.protect.strokes.length,
  title: (d) => d.title,
  withTitle: (d, t) => {
    const { title: _old, ...rest } = d;
    void _old;
    const n = normalizeTitle(t);
    return n === undefined ? rest : { ...rest, title: n };
  }
};
