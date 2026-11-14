/**
 * The server's /sim policy codec (timeline-ui Task 15, R-4): `/api/policies`, the `/s/<id>` server
 * load and the e2e seed. The server validates; the page opens. It has no dataset, so it never
 * upgrades or reconciles: publish takes schema 4 only (`parseSimDoc4` without the month checks),
 * and a stored row of schema 2, 3 or 4 loads as its own text, validated, for the page to open with
 * `openShared`. Pure TS.
 */
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
import { FUTURE_SCHEMA_MESSAGE, TITLE_MAX_CHARS, type PlanErrorCode, type Result } from '$lib/plan';
import type { DocCodec } from '$lib/sharing/doc-codec';
import { normalizeTitle } from '$lib/sharing/title';
import { PolicyFormatError, canonicalJson } from '$lib/sim-page/policy';
import { SIM_CODEC, isDefaultPolicy, parseSimDoc } from '$lib/sim-page/sim-doc';
import { parsePolicy4 } from './parse4';
import { DEFAULT_POLICY4, nothingInForce, type SimPolicy4 } from './policy4';
import {
  SIM_DOC4_SCHEMA,
  SIM_KEY4,
  parseSimDoc4,
  serializeSimDoc4,
  simDoc4Problems
} from './sim-doc4';

/** What the server holds of a policy row: validated, never upgraded or reconciled (it has no dataset). */
export interface SharedSim {
  schema: 2 | 3 | 4;
  kind: 'sim';
  datasetVersion: string;
  title?: string;
  text: string;
  policy: SimPolicy4 | null;
}

const fail = (path: string, code: PlanErrorCode, message: string): Result<never> => ({
  ok: false,
  errors: [{ path, code, message }]
});

/** `kinds.zoning[0].spans[1].from` as `/kinds/zoning/0/spans/1/from`. */
function pointer(policyPath: string): string {
  return policyPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s && s !== '$')
    .map((s) => `/${s}`)
    .join('');
}

function jsonObject(text: string): Result<Record<string, unknown>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('', 'not-json', 'The policy is not valid JSON.');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return fail('', 'not-object', 'A policy must be a JSON object.');
  return { ok: true, value: json as Record<string, unknown> };
}

/** A schema 4 document, built: its text is the canonical one. */
function shared4(d: { datasetVersion: string; title?: string; policy: SimPolicy4 }): SharedSim {
  const doc = {
    schema: 4 as const,
    kind: 'sim' as const,
    datasetVersion: d.datasetVersion,
    ...(d.title === undefined ? {} : { title: d.title }),
    policy: d.policy
  };
  return { ...doc, text: serializeSimDoc4(doc) };
}

// Copies sim-doc4.ts's private `parseDoc4(r, null, 'reconcile')`; pinned by the spec's parity test.
/** Lenient load of a stored schema 4 body: the envelope, the policy unaligned, the limits. */
function load4(r: Record<string, unknown>, text: string): Result<SharedSim> {
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
  let policy: SimPolicy4;
  try {
    policy = parsePolicy4(r.policy, { asOf: null, presetLayer: 'reconcile' });
  } catch (e) {
    if (e instanceof PolicyFormatError)
      return fail(`/policy${pointer(e.path)}`, 'bad-field', e.message);
    throw e;
  }
  const doc = {
    schema: 4 as const,
    kind: 'sim' as const,
    datasetVersion: r.datasetVersion,
    ...(title === undefined ? {} : { title }),
    policy
  };
  const problems = simDoc4Problems(doc);
  if (problems.length > 0) return { ok: false, errors: problems };
  return { ok: true, value: { ...doc, text } };
}

/** A stored row of schema 2, 3 or 4: validated, its text kept. */
function loadShared(text: string): Result<SharedSim> {
  const o = jsonObject(text);
  if (!o.ok) return o;
  const s = o.value.schema;
  if (s === 2 || s === 3) {
    const old = parseSimDoc(text, 'reconcile');
    if (!old.ok) return old;
    const { datasetVersion, title } = old.value;
    return {
      ok: true,
      value: {
        schema: s,
        kind: 'sim',
        datasetVersion,
        ...(title === undefined ? {} : { title }),
        text,
        policy: null
      }
    };
  }
  if (typeof s === 'number' && Number.isInteger(s) && s > SIM_DOC4_SCHEMA)
    return fail('/schema', 'future-schema', FUTURE_SCHEMA_MESSAGE);
  if (s !== SIM_DOC4_SCHEMA)
    return fail('/schema', 'unknown-schema', 'The policy has an unknown schema version.');
  return load4(o.value, text);
}

/** A legacy row as today's schema 3 codec reads it (it loaded once, so it loads again). */
function legacy(d: SharedSim) {
  const r = parseSimDoc(d.text, 'reconcile');
  if (!r.ok) throw new Error('a stored policy row no longer parses');
  return r.value;
}

/** A legacy row's text with one top-level field changed (its policy stays as stored). */
function patched(d: SharedSim, field: 'datasetVersion' | 'title', value: string | undefined) {
  const o = JSON.parse(d.text) as Record<string, unknown>;
  if (value === undefined) delete o[field];
  else o[field] = value;
  return canonicalJson(o);
}

export const SIM_SERVER_CODEC4: DocCodec<SharedSim> = {
  kind: 'sim',
  api: '/api/policies',
  path: (id) => `/s/${id}`,
  storageKey: SIM_KEY4,
  corruptKey: (iso) => `sfhousing:sim:corrupt:${iso}`,
  parse: (text) => {
    const r = parseSimDoc4(text, null);
    return r.ok ? { ok: true, value: shared4(r.value) } : r;
  },
  load: loadShared,
  serialize: (d) => d.text,
  publishable: (d) => d,
  // What a stored row opens as: `shared-page.ts` reports `upgradedFrom` for schema 2 and 3.
  schema: () => SIM_DOC4_SCHEMA,
  datasetVersion: (d) => d.datasetVersion,
  rebase: (d, version) =>
    d.policy
      ? shared4({ ...d, datasetVersion: version, policy: d.policy })
      : { ...d, datasetVersion: version, text: patched(d, 'datasetVersion', version) },
  empty: (version) => shared4({ datasetVersion: version, policy: DEFAULT_POLICY4 }),
  isEmpty: (d) => (d.policy ? nothingInForce(d.policy) : isDefaultPolicy(legacy(d).policy)),
  opCount: (d) => {
    if (!d.policy) return SIM_CODEC.opCount(legacy(d));
    const k = d.policy.kinds;
    return [...k.zoning, ...k.permitting, ...k.money].reduce((n, p) => n + p.spans.length, 0);
  },
  title: (d) => d.title,
  withTitle: (d, t) => {
    const { title: _old, ...rest } = d;
    void _old;
    const n = normalizeTitle(t);
    const base = n === undefined ? rest : { ...rest, title: n };
    return d.policy
      ? shared4({ ...base, policy: d.policy })
      : { ...base, text: patched(d, 'title', n) };
  }
};
