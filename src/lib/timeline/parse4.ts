/**
 * The strict parser of the schema 4 policy document (policy-timeline spec rules 1, 3, 4, 5).
 * Every `what` goes through the parser that checks its schema 3 field today, on a synthetic value
 * under a sentinel path that is re-rooted to the field's place in the document. Pure TS.
 */
import { STOP_TYPES } from '$lib/sim/levers/brushes';
import { FINANCE_LIMITS, FIRST_DAY, LAST_DAY, parseFinanceLevers } from '$lib/sim/levers/finance';
import { LeverFormatError } from '$lib/sim/levers/types';
import {
  PolicyFormatError,
  parseCustom,
  parseRule,
  parseTimingSet,
  type CustomBrush,
  type PresetLayerMode
} from '$lib/sim-page/policy';
import { monthFirstDay, monthLastDay, monthOfDay } from '$lib/sim/world/months';
import type { Day } from '$lib/timelapse/time';
import type { Effect, Policy, PolicyKind, Selector, SimPolicy4, Span } from './policy4';

const SENTINEL = '#';
const LABEL_MAX = 80;
const KINDS: readonly PolicyKind[] = ['zoning', 'permitting', 'money'];
const WHERE_TAGS: Record<PolicyKind, readonly Selector['tag'][]> = {
  zoning: ['transit', 'painted', 'category'],
  permitting: ['routes'],
  money: ['baseline', 'fund', 'terms']
};
const WHAT_OF: Record<Selector['tag'], Effect['tag']> = {
  transit: 'bands',
  painted: 'brushes',
  category: 'protect',
  routes: 'timing',
  baseline: 'scales',
  fund: 'fund',
  terms: 'terms'
};
const CATEGORIES = ['rentControl', 'historic', 'newerThan'] as const;
const POOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function fail(path: string, message: string): never {
  throw new PolicyFormatError(path, message);
}
const j = (base: string, k: string) => (base === '' ? k : `${base}.${k}`);

function rec(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    fail(path || '$', 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(j(path, k), 'unknown key');
  for (const k of keys) if (!(k in r)) fail(j(path, k), 'missing');
  return r;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'expected a string');
  return v;
}
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T))
    fail(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}
function dayOf(v: unknown, path: string): Day {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < FIRST_DAY || v > LAST_DAY)
    fail(path, `expected a whole day from ${FIRST_DAY} to ${LAST_DAY}`);
  return v;
}

/** Run a schema 3 parser on a synthetic value; its sentinel-rooted path is re-rooted by `map`. */
function via<T>(run: () => T, map: (rest: string) => string | null, base: string): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof LeverFormatError || e instanceof PolicyFormatError) {
      const p = e.path === SENTINEL ? base : (map(e.path.slice(SENTINEL.length)) ?? base);
      fail(p, e.message.slice(e.path.length + 2));
    }
    throw e;
  }
}

/** `.baselineScale`, `.pools[0]`, `.programmes`, `.terms` under the sentinel, to the `what` fields. */
function financeMap(what: string) {
  return (rest: string): string | null => {
    if (rest.startsWith('.baselineScale')) return `${what}.entries${rest.slice(14)}`;
    if (rest.startsWith('.pools[0]')) return `${what}.pool${rest.slice(9)}`;
    if (rest.startsWith('.programmes')) return `${what}.programmes${rest.slice(11)}`;
    if (rest.startsWith('.terms')) return `${what}.terms${rest.slice(6)}`;
    return null;
  };
}

const EMPTY_FINANCE = { baselineScale: [], pools: [], programmes: [], terms: {} };

function parseSelector(v: unknown, path: string, kind: PolicyKind): Selector {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const tag = oneOf((v as Record<string, unknown>).tag, j(path, 'tag'), WHERE_TAGS[kind]);
  switch (tag) {
    case 'transit': {
      const r = rec(v, path, ['tag', 'stopTypes']);
      const sp = j(path, 'stopTypes');
      const stopTypes = arr(r.stopTypes, sp).map((x, i) => oneOf(x, `${sp}[${i}]`, STOP_TYPES));
      return { tag, stopTypes };
    }
    case 'category': {
      const r = rec(v, path, ['tag', 'category']);
      return { tag, category: oneOf(r.category, j(path, 'category'), CATEGORIES) };
    }
    case 'fund': {
      const r = rec(v, path, ['tag', 'pool']);
      const pp = j(path, 'pool');
      if (typeof r.pool !== 'string' || !POOL_ID_RE.test(r.pool)) fail(pp, 'expected a pool id');
      return { tag, pool: r.pool };
    }
    default:
      rec(v, path, ['tag']);
      return { tag } as Selector;
  }
}

function parseEffect(v: unknown, path: string, where: Selector, mode: PresetLayerMode): Effect {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const want = WHAT_OF[where.tag];
  const tag = oneOf((v as Record<string, unknown>).tag, j(path, 'tag'), [want]);
  switch (tag) {
    case 'bands': {
      const r = rec(v, path, ['tag', 'bands']);
      const stopTypes = (where as Extract<Selector, { tag: 'transit' }>).stopTypes;
      const rule = via(
        () => parseRule({ id: SENTINEL, kind: 'transit', stopTypes, bands: r.bands }, SENTINEL),
        (rest) => (rest.startsWith('.bands') ? `${j(path, 'bands')}${rest.slice(6)}` : null),
        path
      );
      return { tag, bands: rule.bands };
    }
    case 'brushes': {
      const r = rec(v, path, ['tag', 'brushes']);
      const bp = j(path, 'brushes');
      const seen = new Set<string>();
      const brushes: CustomBrush[] = arr(r.brushes, bp).map((b, i) => {
        const parsed = parseCustom(b, `${bp}[${i}]`);
        if (seen.has(parsed.id)) fail(`${bp}[${i}].id`, 'duplicate id');
        seen.add(parsed.id);
        return parsed;
      });
      return { tag, brushes };
    }
    case 'protect': {
      const r = rec(v, path, ['tag', 'years']);
      const yp = j(path, 'years');
      const isNewer = (where as Extract<Selector, { tag: 'category' }>).category === 'newerThan';
      if (!isNewer) {
        if (r.years !== null) fail(yp, 'expected null: only newerThan has years');
        return { tag, years: null };
      }
      const n = r.years;
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
        fail(yp, 'expected a positive number for newerThan');
      return { tag, years: n };
    }
    case 'timing': {
      const r = rec(v, path, ['tag', 'set']);
      return { tag, set: parseTimingSet(r.set, j(path, 'set'), mode) };
    }
    case 'scales': {
      const r = rec(v, path, ['tag', 'entries']);
      const f = via(
        () => parseFinanceLevers({ ...EMPTY_FINANCE, baselineScale: r.entries }, SENTINEL),
        financeMap(path),
        path
      );
      return { tag, entries: f.baselineScale };
    }
    case 'fund': {
      const r = rec(v, path, ['tag', 'pool', 'programmes']);
      const f = via(
        () =>
          parseFinanceLevers(
            {
              ...EMPTY_FINANCE,
              pools: r.pool === null ? [] : [r.pool],
              programmes: r.programmes
            },
            SENTINEL
          ),
        financeMap(path),
        path
      );
      return { tag, pool: f.pools[0] ?? null, programmes: f.programmes };
    }
    case 'terms': {
      const r = rec(v, path, ['tag', 'terms']);
      const f = via(
        () => parseFinanceLevers({ ...EMPTY_FINANCE, terms: r.terms }, SENTINEL),
        financeMap(path),
        path
      );
      return { tag, terms: f.terms };
    }
  }
}

function checkSpanDays(
  s: { from: Day; to: Day | null },
  path: string,
  prev: { from: Day; to: Day | null } | null,
  asOf: Day | null
): void {
  const fp = j(path, 'from');
  const tp = j(path, 'to');
  if (s.to !== null && s.to < s.from) fail(tp, 'expected a day on or after from');
  if (asOf !== null) {
    if (s.from <= asOf) fail(fp, 'expected a day after the dataset date');
    const mf = monthOfDay(asOf, s.from);
    if (monthFirstDay(asOf, mf) !== s.from) fail(fp, 'expected the first day of a model month');
    if (s.to !== null) {
      const ml = monthOfDay(asOf, s.to);
      if (monthLastDay(asOf, ml) !== s.to) fail(tp, 'expected the last day of a model month');
    }
  }
  if (prev !== null) {
    if (prev.to === null) fail(fp, 'expected no span after one with no end');
    if (s.from < prev.from) fail(fp, 'expected spans in ascending order');
    if (s.from <= prev.to) fail(fp, 'expected spans that do not overlap');
  }
}

interface FundIds {
  pool: string | null;
  programmes: Set<string>;
}

function parsePolicy(
  v: unknown,
  path: string,
  kind: PolicyKind,
  asOf: Day | null,
  mode: PresetLayerMode,
  ids: { policies: Set<string>; pools: Set<string>; programmes: Set<string> },
  union: { scales: Set<string> }
): Policy {
  const r = rec(v, path, ['id', 'label', 'preset', 'on', 'where', 'spans']);
  const id = str(r.id, j(path, 'id'));
  if (id.length < 1 || id.length > LABEL_MAX)
    fail(j(path, 'id'), `expected an id of 1 to ${LABEL_MAX} characters`);
  if (ids.policies.has(id)) fail(j(path, 'id'), 'duplicate id');
  ids.policies.add(id);
  const label = str(r.label, j(path, 'label'));
  if (label.length > LABEL_MAX)
    fail(j(path, 'label'), `expected a label of at most ${LABEL_MAX} characters`);
  const on = bool(r.on, j(path, 'on'));
  const where = parseSelector(r.where, j(path, 'where'), kind);

  let preset: string | null;
  if (kind === 'permitting') {
    if (typeof r.preset !== 'string' || r.preset.length === 0)
      fail(j(path, 'preset'), 'expected a preset id');
    preset = r.preset;
  } else {
    if (r.preset !== null) fail(j(path, 'preset'), 'expected null');
    preset = null;
  }

  const sp = j(path, 'spans');
  const spans: Span[] = [];
  let fund: FundIds | null = null;
  arr(r.spans, sp).forEach((x, i) => {
    const p = `${sp}[${i}]`;
    const sr = rec(x, p, ['from', 'to', 'what']);
    const from = dayOf(sr.from, j(p, 'from'));
    const to = sr.to === null ? null : dayOf(sr.to, j(p, 'to'));
    checkSpanDays({ from, to }, p, spans.length > 0 ? spans[spans.length - 1] : null, asOf);
    const wp = j(p, 'what');
    const what = parseEffect(sr.what, wp, where, mode);
    if (what.tag === 'timing' && what.set.preset !== preset)
      fail(j(path, 'preset'), `expected ${what.set.preset}, the preset of ${j(p, 'what.set')}`);
    if (what.tag === 'scales')
      what.entries.forEach((e) => union.scales.add(`${e.pool}\u0000${e.from}`));
    if (what.tag === 'fund' && where.tag === 'fund') {
      fund = checkFundSpan(what, wp, where, path, fund, ids);
    }
    spans.push({ from, to, what });
  });
  if (spans.length === 0 && where.tag === 'fund' && where.pool.startsWith('u-')) {
    if (ids.pools.has(where.pool)) fail(j(j(path, 'where'), 'pool'), 'duplicate id');
    ids.pools.add(where.pool);
  }
  return { id, label, preset, on, where, spans };
}

/** Rules 3: one pool and one set of programme ids across a fund policy's spans. */
function checkFundSpan(
  what: Extract<Effect, { tag: 'fund' }>,
  wp: string,
  where: Extract<Selector, { tag: 'fund' }>,
  path: string,
  first: FundIds | null,
  ids: { pools: Set<string>; programmes: Set<string> }
): FundIds {
  const poolId = what.pool === null ? null : what.pool.id;
  if (poolId === null) {
    if (where.pool.startsWith('u-'))
      fail(
        j(j(path, 'where'), 'pool'),
        'expected a baseline pool id for a fund with no added pool'
      );
    what.programmes.forEach((g, k) => {
      if (g.pool !== where.pool)
        fail(
          `${j(wp, 'programmes')}[${k}].pool`,
          `expected ${where.pool}, the pool of ${j(path, 'where')}`
        );
    });
  } else if (poolId !== where.pool) {
    fail(j(wp, 'pool.id'), `expected ${where.pool}, the pool of ${j(path, 'where')}`);
  }
  const progIds = new Set(what.programmes.map((g) => g.id));
  if (first === null) {
    if (poolId !== null) {
      if (ids.pools.has(poolId)) fail(j(wp, 'pool.id'), 'duplicate id');
      ids.pools.add(poolId);
    }
    what.programmes.forEach((g, k) => {
      if (ids.programmes.has(g.id)) fail(`${j(wp, 'programmes')}[${k}].id`, 'duplicate id');
      ids.programmes.add(g.id);
    });
    return { pool: poolId, programmes: progIds };
  }
  if (poolId !== first.pool) fail(j(wp, 'pool'), 'expected the same pool as the first span');
  const same =
    progIds.size === first.programmes.size && [...progIds].every((x) => first.programmes.has(x));
  if (!same || what.programmes.length !== progIds.size)
    fail(j(wp, 'programmes'), 'expected the same programme ids as the first span');
  return first;
}

/**
 * Validate a schema 4 policy document. Throws `PolicyFormatError` naming the first bad field.
 * `asOf` is the dataset date for the month-alignment checks of rule 4; null skips only those.
 */
export function parsePolicy4(
  json: unknown,
  opts: { asOf: Day | null; presetLayer?: PresetLayerMode }
): SimPolicy4 {
  const seen = (json as { schema?: unknown } | null)?.schema;
  if (typeof json === 'object' && json !== null && !Array.isArray(json) && seen !== 4)
    fail('schema', `expected 4, got ${String(seen)}`);
  const r = rec(json, '', ['schema', 'kinds']);
  const kr = rec(r.kinds, 'kinds', KINDS);
  const ids = {
    policies: new Set<string>(),
    pools: new Set<string>(),
    programmes: new Set<string>()
  };
  const union = { scales: new Set<string>() };
  const mode = opts.presetLayer ?? 'strict';
  const out = {} as SimPolicy4['kinds'];
  for (const kind of KINDS) {
    const kp = `kinds.${kind}`;
    out[kind] = arr(kr[kind], kp).map((p, i) =>
      parsePolicy(p, `${kp}[${i}]`, kind, opts.asOf, mode, ids, union)
    );
  }
  if (ids.pools.size > FINANCE_LIMITS.pools)
    fail('kinds.money', `expected at most ${FINANCE_LIMITS.pools} added pools`);
  if (ids.programmes.size > FINANCE_LIMITS.programmes)
    fail('kinds.money', `expected at most ${FINANCE_LIMITS.programmes} added programmes`);
  if (union.scales.size > FINANCE_LIMITS.baselineScale)
    fail('kinds.money', `expected at most ${FINANCE_LIMITS.baselineScale} scale entries`);
  return { schema: 4, kinds: out };
}
