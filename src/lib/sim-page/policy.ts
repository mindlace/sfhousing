/**
 * The /sim policy recipe (sim runs spec, section 3): new zoning rules, custom painting, category
 * protections and permitting timing, and its compiler to the `SimLevers` the worker runs. Pure
 * TS: no Svelte, no DOM, so the server can reuse it.
 *
 * Rules are additive (each lot takes the highest rule that names it, never below FZP); custom
 * paint sets a story count, in order, and an erase removes earlier paint only.
 */
import type { ParcelId } from '$lib/data/parcel';
import {
  STOP_TYPES,
  type BrushQuery,
  type StopType,
  type StreetClass
} from '$lib/sim/levers/brushes';
import { STREET_CLASSES } from '$lib/data/frontage-codec';
import {
  DEFAULT_LEVERS,
  LeverFormatError,
  parseSimLevers,
  type Compare,
  type SimLevers,
  type StoryEdit,
  type TimerEdit
} from '$lib/sim/levers/types';
import { STORIES_MAX, STORIES_MIN } from '$lib/plan/constants';
import { PATHWAYS, type Pathway } from '$lib/timelapse/types';
import {
  EDITABLE_STAGES,
  OBSERVED_TIMING,
  PRESETS,
  compileTiming,
  type SimTiming,
  type TimingSet
} from './timing';
import { BENCHMARK_PERMIT_DAYS } from './timing-sources';

export interface Stroke {
  path: [lng: number, lat: number][];
  radiusM: number;
}
export interface TransitBand {
  maxM: number;
  stories: number;
}
export type ZoningRule =
  | { id: string; kind: 'transit'; stopTypes: StopType[]; bands: TransitBand[] }
  | {
      id: string;
      kind: 'street';
      classes: StreetClass[];
      names: string[];
      depth: 0 | 1;
      /** The Commercial corridor preset: frontage zoned NC or NCT only. */
      ncOnly: boolean;
      stories: number;
    };
export type CustomBrush =
  | { id: string; kind: 'paint'; strokes: Stroke[]; stories: number }
  | { id: string; kind: 'erase'; strokes: Stroke[] };
export interface CategoryProtections {
  rentControl: boolean;
  historic: boolean;
  newerThanYears: number | null;
}

export interface SimPolicy {
  schema: 2;
  /** New zoning rules, in list order. */
  rules: ZoningRule[];
  /** Custom painting, in stroke order: a later brush wins. */
  custom: CustomBrush[];
  protect: CategoryProtections;
  /** The permitting timing set and its saved snapshot (`timing.ts`). */
  timing: SimTiming;
}

/**
 * Tier 4 (our judgement): a quarter mile and a half mile, the SB 79 transit-oriented tiers'
 * distances, at heights of 6 and 4 stories.
 */
export const DEFAULT_BANDS: TransitBand[] = [
  { maxM: 402, stories: 6 },
  { maxM: 805, stories: 4 }
];

/** Bands sorted by distance, innermost first. */
export const bandsInnermostFirst = (bands: readonly TransitBand[]): TransitBand[] =>
  [...bands].sort((a, b) => a.maxM - b.maxM);

/**
 * Why a band list breaks the band rule (partner ruling: bands never get taller with distance),
 * or null: compared innermost first, two bands at one distance, or an outer band taller than
 * the band inside it.
 */
export function bandProblem(bands: readonly TransitBand[]): 'same-distance' | 'taller' | null {
  const sorted = bandsInnermostFirst(bands);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].maxM === sorted[i - 1].maxM) return 'same-distance';
    if (sorted[i].stories > sorted[i - 1].stories) return 'taller';
  }
  return null;
}

export class PolicyFormatError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'PolicyFormatError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new PolicyFormatError(path, message);
}

/** The page's starting policy: FZP as written, no rules or painting, no protections, observed timing. */
export const DEFAULT_POLICY: SimPolicy = {
  schema: 2,
  rules: [],
  custom: [],
  protect: { rentControl: false, historic: false, newerThanYears: null },
  timing: { current: structuredClone(OBSERVED_TIMING.current), saved: null }
};

/** The policy without its saved timing snapshot. */
export const withoutSnapshot = (p: SimPolicy): SimPolicy => ({
  ...p,
  timing: { ...p.timing, saved: null }
});

/** The policy equals the default one, ignoring the saved timing snapshot. */
export function isDefaultPolicy(p: SimPolicy): boolean {
  return canonicalJson(withoutSnapshot(p)) === canonicalJson(DEFAULT_POLICY);
}

// ---- parsing ----

function rec(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    fail(path || '$', 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(j(path, k), 'unknown key');
  for (const k of keys) if (!(k in r)) fail(j(path, k), 'missing');
  return r;
}
const j = (base: string, k: string) => (base === '' ? k : `${base}.${k}`);

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
function strings(v: unknown, path: string): string[] {
  return arr(v, path).map((x, i) => str(x, `${path}[${i}]`));
}
function oneOfList<T extends string>(v: unknown, path: string, allowed: readonly T[]): T[] {
  return arr(v, path).map((x, i) => oneOf(x, `${path}[${i}]`, allowed));
}
function finite(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}
function stories(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < STORIES_MIN || v > STORIES_MAX)
    fail(path, `expected an integer from ${STORIES_MIN} to ${STORIES_MAX}`);
  return v;
}

function parseStrokes(v: unknown, path: string): Stroke[] {
  return arr(v, path).map((x, i) => {
    const p = `${path}[${i}]`;
    const r = rec(x, p, ['path', 'radiusM']);
    const radiusM = finite(r.radiusM, j(p, 'radiusM'));
    if (radiusM <= 0) fail(j(p, 'radiusM'), 'expected a positive number');
    const pathPts = arr(r.path, j(p, 'path')).map((pt, k) => {
      const pp = `${j(p, 'path')}[${k}]`;
      const a = arr(pt, pp);
      if (a.length !== 2) fail(pp, 'expected [lng, lat]');
      return [finite(a[0], `${pp}[0]`), finite(a[1], `${pp}[1]`)] as [number, number];
    });
    return { path: pathPts, radiusM };
  });
}

function kindOf<T extends string>(v: unknown, path: string, kinds: readonly T[]): T {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return oneOf((v as Record<string, unknown>).kind, j(path, 'kind'), kinds);
}

function parseRule(v: unknown, path: string): ZoningRule {
  const kind = kindOf(v, path, ['transit', 'street'] as const);
  if (kind === 'transit') {
    const r = rec(v, path, ['id', 'kind', 'stopTypes', 'bands']);
    const bp = j(path, 'bands');
    const bandList = arr(r.bands, bp);
    if (bandList.length === 0) fail(bp, 'expected at least one band');
    const bands = bandList.map((b, i) => {
      const p = `${bp}[${i}]`;
      const br = rec(b, p, ['maxM', 'stories']);
      const maxM = finite(br.maxM, j(p, 'maxM'));
      if (maxM <= 0) fail(j(p, 'maxM'), 'expected a positive number');
      return { maxM, stories: stories(br.stories, j(p, 'stories')) };
    });
    const why = bandProblem(bands);
    if (why === 'same-distance') fail(bp, 'expected each band at a different distance');
    if (why === 'taller') fail(bp, 'expected no band taller than the band inside it');
    return {
      id: str(r.id, j(path, 'id')),
      kind,
      stopTypes: oneOfList(r.stopTypes, j(path, 'stopTypes'), STOP_TYPES),
      bands
    };
  }
  const r = rec(v, path, ['id', 'kind', 'classes', 'names', 'depth', 'ncOnly', 'stories']);
  if (r.depth !== 0 && r.depth !== 1) fail(j(path, 'depth'), 'expected 0 or 1');
  return {
    id: str(r.id, j(path, 'id')),
    kind,
    classes: oneOfList(r.classes, j(path, 'classes'), STREET_CLASSES),
    names: strings(r.names, j(path, 'names')),
    depth: r.depth,
    ncOnly: bool(r.ncOnly, j(path, 'ncOnly')),
    stories: stories(r.stories, j(path, 'stories'))
  };
}

function parseCustom(v: unknown, path: string): CustomBrush {
  const kind = kindOf(v, path, ['paint', 'erase'] as const);
  if (kind === 'paint') {
    const r = rec(v, path, ['id', 'kind', 'strokes', 'stories']);
    return {
      id: str(r.id, j(path, 'id')),
      kind,
      strokes: parseStrokes(r.strokes, j(path, 'strokes')),
      stories: stories(r.stories, j(path, 'stories'))
    };
  }
  const r = rec(v, path, ['id', 'kind', 'strokes']);
  return {
    id: str(r.id, j(path, 'id')),
    kind,
    strokes: parseStrokes(r.strokes, j(path, 'strokes'))
  };
}

/** One lever field through the lever parser's full check, re-pathed under `path`. */
function viaLevers<K extends 'timers' | 'routeShares'>(
  field: K,
  v: unknown,
  path: string
): SimLevers[K] {
  try {
    return parseSimLevers({ ...DEFAULT_LEVERS, [field]: v })[field];
  } catch (e) {
    if (e instanceof LeverFormatError) fail(path + e.path.slice(field.length), e.message);
    throw e;
  }
}

/** Route shares in a timing set: null, or whole percents that sum to 100. */
function percents(v: unknown, path: string): Record<Pathway, number> | null {
  const r = viaLevers('routeShares', v, path);
  if (r === null) return null;
  for (const p of PATHWAYS)
    if (!Number.isInteger(r[p])) fail(`${path}.${p}`, 'expected a whole percent');
  if (PATHWAYS.reduce((a, p) => a + r[p], 0) !== 100) fail(path, 'expected shares summing to 100');
  return r;
}

const AVAILABLE_PRESETS = PRESETS.filter((p) => p.available).map((p) => p.id);
const ALL_PRESETS = PRESETS.map((p) => p.id);

/** How the preset layer is read: 'strict' re-checks it, 'reconcile' leaves it to the caller. */
export type PresetLayerMode = 'strict' | 'reconcile';

function parseTimingSet(v: unknown, path: string, mode: PresetLayerMode): TimingSet {
  const r = rec(v, path, [
    'preset',
    'presetTimers',
    'presetRouteShares',
    'edits',
    'routeShares',
    'localProgramStreamlined'
  ]);
  const edits = viaLevers('timers', r.edits, j(path, 'edits'));
  editableOnce(edits, j(path, 'edits'));
  edits.forEach((e, i) => {
    if (e.reach !== 'all')
      fail(`${j(path, 'edits')}[${i}].reach`, 'expected all: custom edits reach every project');
  });
  const set: TimingSet = {
    preset: oneOf(r.preset, j(path, 'preset'), mode === 'strict' ? AVAILABLE_PRESETS : ALL_PRESETS),
    presetTimers: viaLevers('timers', r.presetTimers, j(path, 'presetTimers')),
    presetRouteShares: percents(r.presetRouteShares, j(path, 'presetRouteShares')),
    edits,
    routeShares: percents(r.routeShares, j(path, 'routeShares')),
    localProgramStreamlined: bool(r.localProgramStreamlined, j(path, 'localProgramStreamlined'))
  };
  // Reconcile re-derives the rest of the layer, but timers compound, so these always hold.
  editableOnce(set.presetTimers, j(path, 'presetTimers'));
  if (mode === 'strict') checkPresetLayer(set, path);
  return set;
}

/** Timers on editable stages only, at most one per (pathway, stage). */
function editableOnce(timers: readonly TimerEdit[], path: string): void {
  const seen = new Set<string>();
  timers.forEach((t, i) => {
    const tp = `${path}[${i}]`;
    if (!EDITABLE_STAGES.includes(t.stage)) fail(j(tp, 'stage'), 'expected an editable stage');
    const k = `${t.pathway}/${t.stage}`;
    if (seen.has(k)) fail(tp, `duplicate timer for ${k}`);
    seen.add(k);
  });
}

const BENCHMARK_RATIO = BENCHMARK_PERMIT_DAYS.sanDiego.value / BENCHMARK_PERMIT_DAYS.sf.value;

/**
 * The preset layer must be one the preset could have resolved to (review I1), checked without
 * a calibration: which stages and reach its timers may have, the range of their scales, and the
 * shape of its route shares. Every preset keeps the Local Program streamlined.
 */
function checkPresetLayer(s: TimingSet, path: string): void {
  const tp = j(path, 'presetTimers');
  const sp = j(path, 'presetRouteShares');
  editableOnce(s.presetTimers, tp);
  if (!s.localProgramStreamlined)
    fail(j(path, 'localProgramStreamlined'), 'expected true: every preset keeps it');
  const timers = (allowed: (t: TimerEdit) => string | null) =>
    s.presetTimers.forEach((t, i) => {
      const why = allowed(t);
      if (why !== null) fail(`${tp}[${i}]`, why);
    });
  const noTimers = () => timers(() => `expected no timers under ${s.preset}`);
  const noShares = () => {
    if (s.presetRouteShares !== null) fail(sp, `expected null under ${s.preset}`);
  };
  switch (s.preset) {
    case 'observed':
      noTimers();
      noShares();
      break;
    case 'noDiscretionary':
      noTimers();
      if (s.presetRouteShares === null) fail(sp, 'expected route shares under noDiscretionary');
      if (s.presetRouteShares.discretionary !== 0) fail(`${sp}.discretionary`, 'expected 0');
      break;
    case 'sb423Clock':
      noShares();
      timers((t) =>
        t.pathway !== 'streamlined' || t.stage !== 'filed'
          ? 'expected only streamlined filed'
          : t.reach !== 'new'
            ? 'expected reach new'
            : t.scale > 1
              ? 'expected a scale of at most 1'
              : null
      );
      break;
    case 'benchmarkPermits':
      noShares();
      // The ratio, or raised toward 1 by a stage floor (resolvePreset's `withFloor`).
      timers((t) =>
        t.stage !== 'permitFiled'
          ? 'expected only permitFiled'
          : t.reach !== 'all'
            ? 'expected reach all'
            : t.scale < BENCHMARK_RATIO - 1e-12 || t.scale > 1
              ? `expected a scale from ${BENCHMARK_RATIO} to 1`
              : null
      );
      break;
    case 'ceqaInfill': // rejected above as unavailable
      break;
  }
}

function parseTiming(v: unknown, mode: PresetLayerMode): SimTiming {
  const r = rec(v, 'timing', ['current', 'saved']);
  let saved: SimTiming['saved'] = null;
  if (r.saved !== null) {
    const sr = rec(r.saved, 'timing.saved', ['label', 'set']);
    saved = {
      label: str(sr.label, 'timing.saved.label'),
      set: parseTimingSet(sr.set, 'timing.saved.set', mode)
    };
  }
  return { current: parseTimingSet(r.current, 'timing.current', mode), saved };
}

/**
 * Validate a policy document. Throws `PolicyFormatError` naming the first bad field. With
 * `presetLayer: 'reconcile'` the preset layer (preset id availability, its timers and shares)
 * is not checked against the preset: a stored document may name a retired preset or a scale
 * the current sources no longer give, and reconcile re-derives that layer.
 */
export function parseSimPolicy(
  json: unknown,
  opts: { presetLayer?: PresetLayerMode } = {}
): SimPolicy {
  const mode = opts.presetLayer ?? 'strict';
  const r = rec(json, '', ['schema', 'rules', 'custom', 'protect', 'timing']);
  if (r.schema !== 2) fail('schema', `expected 2, got ${String(r.schema)}`);
  const pr = rec(r.protect, 'protect', ['rentControl', 'historic', 'newerThanYears']);
  const n = pr.newerThanYears;
  if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0))
    fail('protect.newerThanYears', 'expected null or a positive number');
  const timing = parseTiming(r.timing, mode);
  const rules = arr(r.rules, 'rules').map((b, i) => parseRule(b, `rules[${i}]`));
  const custom = arr(r.custom, 'custom').map((b, i) => parseCustom(b, `custom[${i}]`));
  // Ids are unique across both lists: the page keys cards and lot lookups by them.
  const ids = new Set<string>();
  const once = (list: string) => (b: { id: string }, i: number) => {
    if (ids.has(b.id)) fail(`${list}[${i}].id`, 'duplicate id');
    ids.add(b.id);
  };
  rules.forEach(once('rules'));
  custom.forEach(once('custom'));
  return {
    schema: 2,
    rules,
    custom,
    protect: {
      rentControl: bool(pr.rentControl, 'protect.rentControl'),
      historic: bool(pr.historic, 'protect.historic'),
      newerThanYears: n
    },
    timing
  };
}

// ---- queries ----

/** Stable JSON: object keys sorted, so equal values give equal text. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function queryKey(q: BrushQuery): string {
  return canonicalJson(q);
}

const bandsOutermostFirst = (bands: readonly TransitBand[]) => bandsInnermostFirst(bands).reverse();

/** The lot queries a rule needs (a transit rule: one per band, outermost first). */
export function ruleQueries(r: ZoningRule): BrushQuery[] {
  if (r.kind === 'transit')
    return bandsOutermostFirst(r.bands).map((band) => ({
      kind: 'transit',
      stopTypes: r.stopTypes,
      maxM: band.maxM
    }));
  return [{ kind: 'street', classes: r.classes, names: r.names, depth: r.depth, ncOnly: r.ncOnly }];
}

/** The lot query a custom brush needs: its strokes, freehand. */
export function customQuery(b: CustomBrush): BrushQuery {
  return { kind: 'freehand', strokes: b.strokes };
}

/** Every lot query the policy needs, with a stable key (canonical JSON of the query). */
export function queriesOf(p: SimPolicy): { key: string; query: BrushQuery }[] {
  const seen = new Map<string, BrushQuery>();
  const add = (q: BrushQuery) => {
    const k = queryKey(q);
    if (!seen.has(k)) seen.set(k, q);
  };
  for (const r of p.rules) ruleQueries(r).forEach(add);
  for (const b of p.custom) add(customQuery(b));
  return [...seen].map(([key, query]) => ({ key, query }));
}

/** A query's lots by its key; undefined while unknown. */
export type Lots = (key: string) => readonly ParcelId[] | undefined;

const sortedUnique = (xs: Iterable<ParcelId>): ParcelId[] =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Rules to edits in list order (a transit rule: a band each, outermost first); null while unknown. */
function ruleEdits(p: SimPolicy, lots: Lots): StoryEdit[] | null {
  const out: StoryEdit[] = [];
  for (const r of p.rules) {
    const got = ruleQueries(r).map((q) => lots(queryKey(q)));
    if (got.some((g) => g === undefined)) return null;
    const heights =
      r.kind === 'transit' ? bandsOutermostFirst(r.bands).map((b) => b.stories) : [r.stories];
    got.forEach((g, i) => {
      const l = sortedUnique(g!);
      if (l.length > 0) out.push({ lots: l, stories: heights[i] });
    });
  }
  return out;
}

/** Custom paint to edits in order, each erase removing lots from the paint before it. */
function paintEdits(p: SimPolicy, lots: Lots): StoryEdit[] | null {
  let out: StoryEdit[] = [];
  for (const b of p.custom) {
    const got = lots(queryKey(customQuery(b)));
    if (got === undefined) return null;
    if (b.kind === 'erase') {
      const gone = new Set(got);
      out = out
        .map((e) => ({ ...e, lots: e.lots.filter((x) => !gone.has(x)) }))
        .filter((e) => e.lots.length > 0);
    } else {
      const l = sortedUnique(got);
      if (l.length > 0) out.push({ lots: l, stories: b.stories });
    }
  }
  return out;
}

/** Lot → painted stories after erasing, last stroke wins; null while a query is unknown. */
export function paintedLots(p: SimPolicy, lots: Lots): Map<ParcelId, number> | null {
  const edits = paintEdits(p, lots);
  if (edits === null) return null;
  const out = new Map<ParcelId, number>();
  for (const e of edits)
    for (const x of e.lots) {
      out.delete(x); // re-insert, so the map's order is the order lots were last painted
      out.set(x, e.stories);
    }
  return out;
}

/**
 * The levers for `p`; null while a needed query is unknown. The twin is pre-FZP zoning for the
 * default policy, FZP as written for any other.
 */
export function compileLevers(p: SimPolicy, lots: Lots): SimLevers | null {
  const rules = ruleEdits(p, lots);
  const paint = paintEdits(p, lots);
  if (rules === null || paint === null) return null;
  return {
    schema: 2,
    rules,
    paint,
    protect: { ...p.protect },
    ...compileTiming(p.timing.current),
    compare: isDefaultPolicy(p) ? 'preFzp' : 'fzp'
  };
}

export type LotRole = 'changed';

/** Per-lot role for the map: every lot a rule or the custom paint changes. Unknown queries count as empty. */
export function lotRoles(p: SimPolicy, lots: Lots): Map<ParcelId, LotRole> {
  const known: Lots = (k) => lots(k) ?? [];
  const roles = new Map<ParcelId, LotRole>();
  for (const e of ruleEdits(p, known) ?? []) for (const x of e.lots) roles.set(x, 'changed');
  for (const x of paintedLots(p, known)?.keys() ?? []) roles.set(x, 'changed');
  return roles;
}

export interface ScoreCopy {
  plan: string;
  twin: string;
  compare: Compare;
}

export function scoreCopy(l: SimLevers | null): ScoreCopy {
  if (l === null || l.compare === 'preFzp')
    return { plan: 'the Family Zoning Plan', twin: 'the old zoning', compare: 'preFzp' };
  return { plan: 'your policy', twin: 'the Family Zoning Plan as written', compare: 'fzp' };
}
