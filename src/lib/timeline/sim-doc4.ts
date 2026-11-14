/**
 * The schema 4 /sim policy document (policy-timeline spec rules 25, 26): the codec and the
 * autosave key migration. Built and tested but used nowhere yet: `SIM_CODEC`, the server and the
 * page still read schema 3 under `sfhousing:sim:v1`. Pure TS: no Svelte, no DOM.
 */
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
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
import { readRecord, writeRecord, type LocalPlanRecord } from '$lib/sharing/storage';
import { normalizeTitle } from '$lib/sharing/title';
import { PolicyFormatError, canonicalJson, type Stroke } from '$lib/sim-page/policy';
import { SCHEMA2_PUBLISH_MESSAGE, SIM_KEY, parseSimDoc } from '$lib/sim-page/sim-doc';
import type { Day } from '$lib/timelapse/time';
import type { Calibration } from '$lib/timelapse/types';
import { parsePolicy4 } from './parse4';
import { DEFAULT_POLICY4, nothingInForce, type SimPolicy4 } from './policy4';
import { programmeTermGaps, reconcilePolicy4, type Policy4Report } from './reconcile4';
import { upgradePolicy } from './upgrade';

export const SIM_DOC4_SCHEMA = 4;
/** The autosave key for the schema 4 /sim policy; `sfhousing:sim:v1` keeps the schema 3 one. */
export const SIM_KEY4 = 'sfhousing:sim:v2';

export interface SimDoc4 {
  schema: 4;
  kind: 'sim';
  datasetVersion: string;
  title?: string;
  policy: SimPolicy4;
}

/** What opening a document needs from the dataset: its date and its calibration. */
export interface OpenDataset {
  asOf: Day;
  calibration: Calibration;
}

// ---- limits ----

const MAX_PROBLEMS = 20;
const encoder = new TextEncoder();

/** The painted brushes' strokes in every span (policies off too): the only strokes there are. */
function strokeLists(p: SimPolicy4): { at: string; strokes: readonly Stroke[] }[] {
  const out: { at: string; strokes: readonly Stroke[] }[] = [];
  p.kinds.zoning.forEach((pol, i) =>
    pol.spans.forEach((s, j) => {
      if (s.what.tag !== 'brushes') return;
      s.what.brushes.forEach((b, k) =>
        out.push({
          at: `/policy/kinds/zoning/${i}/spans/${j}/what/brushes/${k}/strokes`,
          strokes: b.strokes
        })
      );
    })
  );
  return out;
}

/** The stroke limits, then (when those hold) the canonical byte size. */
export function simDoc4Problems(d: SimDoc4): PlanError[] {
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
  if (errors.length === 0 && encoder.encode(serializeSimDoc4(d)).byteLength > MAX_PLAN_BYTES)
    bad('', 'too-large', `The policy is larger than ${MAX_PLAN_BYTES / 1024} KB.`);
  return errors;
}

// ---- parse and serialize ----

const fail = (path: string, code: PlanErrorCode, message: string): Result<never> => ({
  ok: false,
  errors: [{ path, code, message }]
});

/** `kinds.zoning[0].spans[1].from` as `/kinds/zoning/0/spans/1/from`. */
function pointer(policyPath: string): string {
  const segs = policyPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s && s !== '$');
  return segs.map((s) => `/${s}`).join('');
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

/** A schema 4 object's envelope and policy; the stroke limits and size check come with it. */
function parseDoc4(
  r: Record<string, unknown>,
  asOf: Day | null,
  mode: 'strict' | 'reconcile'
): Result<SimDoc4> {
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
    policy = parsePolicy4(r.policy, { asOf, presetLayer: mode });
  } catch (e) {
    if (e instanceof PolicyFormatError)
      return fail(`/policy${pointer(e.path)}`, 'bad-field', e.message);
    throw e;
  }
  if (mode === 'strict') {
    const gap = programmeTermGaps(policy)[0];
    if (gap !== undefined)
      return fail(
        `/policy${pointer(gap.path)}`,
        'bad-field',
        `${gap.programme} needs ${gap.term}, which is not sourced`
      );
  }
  const d: SimDoc4 = { schema: 4, kind: 'sim', datasetVersion: r.datasetVersion, policy };
  if (title !== undefined) d.title = title;
  const problems = simDoc4Problems(d);
  return problems.length > 0 ? { ok: false, errors: problems } : { ok: true, value: d };
}

const schemaOf = (r: Record<string, unknown>): number | null =>
  typeof r.schema === 'number' && Number.isInteger(r.schema) ? r.schema : null;

/**
 * Strict: what publish accepts, schema 4 only. A schema 2 or 3 body is `unknown-schema` (the
 * server never upgrades one), a newer one `future-schema`. `asOf` null skips the alignment checks
 * (the server has no dataset).
 */
export function parseSimDoc4(text: string, asOf: Day | null): Result<SimDoc4> {
  const o = jsonObject(text);
  if (!o.ok) return o;
  const r = o.value;
  const s = schemaOf(r);
  if (s !== null && s > SIM_DOC4_SCHEMA)
    return fail('/schema', 'future-schema', FUTURE_SCHEMA_MESSAGE);
  if (s === 2 || s === 3) return fail('/schema', 'unknown-schema', SCHEMA2_PUBLISH_MESSAGE);
  if (s !== SIM_DOC4_SCHEMA)
    return fail('/schema', 'unknown-schema', 'The policy has an unknown schema version.');
  return parseDoc4(r, asOf, 'strict');
}

/**
 * Open a stored or shared document of schema 2, 3 or 4 as a reconciled schema 4 one. A schema 2
 * or 3 body goes through today's loader, then `upgradePolicy`; a schema 4 body is
 * parsed without the month alignment (it may have been saved on an earlier dataset); every body
 * then goes through `reconcilePolicy4`, which re-aligns its spans to the dataset.
 */
export function openSimDoc4(
  text: string,
  ds: OpenDataset
): Result<{ doc: SimDoc4; upgradedFrom?: 2 | 3; report: Policy4Report }> {
  const o = jsonObject(text);
  if (!o.ok) return o;
  const s = schemaOf(o.value);
  let doc: SimDoc4;
  let upgradedFrom: 2 | 3 | undefined;
  if (s === 2 || s === 3) {
    const old = parseSimDoc(text, 'reconcile');
    if (!old.ok) return old;
    const { policy, ...rest } = old.value;
    const up = upgradePolicy(policy, ds.asOf);
    const d: SimDoc4 = { ...rest, schema: 4, policy: up };
    const problems = simDoc4Problems(d);
    if (problems.length > 0) return { ok: false, errors: problems };
    doc = d;
    upgradedFrom = s;
  } else {
    if (s !== null && s > SIM_DOC4_SCHEMA)
      return fail('/schema', 'future-schema', FUTURE_SCHEMA_MESSAGE);
    if (s !== SIM_DOC4_SCHEMA)
      return fail('/schema', 'unknown-schema', 'The policy has an unknown schema version.');
    const p = parseDoc4(o.value, null, 'reconcile');
    if (!p.ok) return p;
    doc = p.value;
  }
  const rec = reconcilePolicy4(doc.policy, ds.calibration, ds.asOf);
  const out = { doc: { ...doc, policy: rec.doc }, report: rec.report };
  return { ok: true, value: upgradedFrom === undefined ? out : { ...out, upgradedFrom } };
}

const quantizeStroke = (s: Stroke): Stroke => ({
  ...s,
  path: s.path.map(([lng, lat]) => [quantize(lng), quantize(lat)] as [number, number])
});

/** Canonical compact JSON: keys sorted, coordinates quantized to 6 decimals. */
export function serializeSimDoc4(d: SimDoc4): string {
  const policy: SimPolicy4 = {
    ...d.policy,
    kinds: {
      ...d.policy.kinds,
      zoning: d.policy.kinds.zoning.map((p) => ({
        ...p,
        spans: p.spans.map((s) =>
          s.what.tag === 'brushes'
            ? {
                ...s,
                what: {
                  ...s.what,
                  brushes: s.what.brushes.map((b) => ({
                    ...b,
                    strokes: b.strokes.map(quantizeStroke)
                  }))
                }
              }
            : s
        )
      }))
    }
  };
  return canonicalJson({ ...d, policy });
}

export function createSimCodec4(ds: OpenDataset): DocCodec<SimDoc4> {
  return {
    kind: 'sim',
    api: '/api/policies',
    path: (id) => `/s/${id}`,
    storageKey: SIM_KEY4,
    corruptKey: (iso) => `sfhousing:sim:corrupt:${iso}`,
    parse: (text) => parseSimDoc4(text, ds.asOf),
    load: (text) => {
      const r = openSimDoc4(text, ds);
      return r.ok ? { ok: true, value: r.value.doc } : r;
    },
    serialize: serializeSimDoc4,
    // Schema 4 has no snapshot to drop.
    publishable: (d) => d,
    schema: (d) => d.schema,
    datasetVersion: (d) => d.datasetVersion,
    rebase: (d, version) => ({ ...d, datasetVersion: version }),
    empty: (version) => ({
      schema: 4,
      kind: 'sim',
      datasetVersion: version,
      policy: DEFAULT_POLICY4
    }),
    isEmpty: (d) => nothingInForce(d.policy),
    opCount: (d) => {
      const k = d.policy.kinds;
      return [...k.zoning, ...k.permitting, ...k.money].reduce((n, p) => n + p.spans.length, 0);
    },
    title: (d) => d.title,
    withTitle: (d, t) => {
      const { title: _old, ...rest } = d;
      void _old;
      const n = normalizeTitle(t);
      return n === undefined ? rest : { ...rest, title: n };
    }
  };
}

/**
 * Rule 26: carry the schema 3 autosave under `sfhousing:sim:v1` to `sfhousing:sim:v2` as an
 * upgraded, reconciled schema 4 document, with `savedAt` and `lastPublished` (its id is still a
 * valid link). The v1 record stays so an older tab keeps working. A v2 record is never touched.
 */
export function migrateSimAutosave(
  storage: Storage,
  ds: OpenDataset
): 'none' | 'migrated' | 'kept' {
  try {
    if (storage.getItem(SIM_KEY4) !== null) return 'kept';
    const codec = { ...createSimCodec4(ds), storageKey: SIM_KEY };
    const r = readRecord(storage, codec);
    if (r.kind !== 'ok') return 'none';
    const record: LocalPlanRecord = {
      v: 1,
      savedAt: r.record.savedAt,
      plan: serializeSimDoc4(r.plan)
    };
    if (r.record.lastPublished) record.lastPublished = r.record.lastPublished;
    return writeRecord(storage, record, createSimCodec4(ds)) ? 'migrated' : 'none';
  } catch {
    return 'none';
  }
}
