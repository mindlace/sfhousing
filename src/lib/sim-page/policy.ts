/**
 * The /sim policy recipe: what the page keeps and edits (stock toggles, ordered brushes,
 * protections), and its compiler to plan 2's `SimLevers`. Pure TS: no Svelte, no DOM, so the
 * server can reuse it.
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
  FZP_COMPAT_LEVERS,
  LeverFormatError,
  STOCK_LAYERS,
  parseSimLevers,
  type SimLevers,
  type StockLayerId,
  type UserEdit
} from '$lib/sim/levers/types';
import { STORIES_MAX, STORIES_MIN } from '$lib/plan/constants';

export type BrushMode = 'raise' | 'lower' | 'set';
export interface Effect {
  mode: BrushMode;
  stories: number;
  densityLimits: boolean;
}
export interface Stroke {
  path: [lng: number, lat: number][];
  radiusM: number;
}
export interface TransitBand {
  maxM: number;
  stories: number;
}
export type ZoningBrush =
  | { id: string; kind: 'freehand'; strokes: Stroke[]; effect: Effect }
  | { id: string; kind: 'erase'; strokes: Stroke[] }
  | {
      id: string;
      kind: 'transit';
      stopTypes: StopType[];
      bands: TransitBand[];
      mode: BrushMode;
      densityLimits: boolean;
    }
  | {
      id: string;
      kind: 'street';
      classes: StreetClass[];
      names: string[];
      depth: 0 | 1;
      ncOnly: boolean;
      effect: Effect;
    }
  | { id: string; kind: 'area'; districts: string[]; neighborhoods: string[]; effect: Effect };

export type ProtectStroke = Stroke & { kind: 'protect' | 'unprotect' };

export interface SimPolicy {
  schema: 1;
  stock: StockLayerId[];
  assumeAlternativePlanKept: boolean;
  compare: 'currentLaw' | 'preFzp';
  brushes: ZoningBrush[];
  protect: {
    rentControl: boolean;
    historic: boolean;
    newerThanYears: number | null;
    strokes: ProtectStroke[];
  };
  /** Plan 4's seam: carried into SimLevers untouched by this plan's UI. */
  timing: Pick<SimLevers, 'timers' | 'routeShares' | 'localProgramStreamlined'>;
}

/**
 * Tier 4 (our judgement): a quarter mile and a half mile, the SB 79 transit-oriented tiers'
 * distances, at heights of 6 and 4 stories.
 */
export const DEFAULT_BANDS: TransitBand[] = [
  { maxM: 402, stories: 6 },
  { maxM: 805, stories: 4 }
];

/** Raising starts without density limits; lowering and setting start with them. */
export function defaultEffect(mode: BrushMode, stories: number): Effect {
  return { mode, stories, densityLimits: mode !== 'raise' };
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

export function policyFromLevers(l: SimLevers): SimPolicy {
  if (l.user.length > 0) throw new PolicyFormatError('user', 'expected no user edits');
  if (l.protect.lots.length > 0) throw new PolicyFormatError('protect.lots', 'expected no lots');
  return {
    schema: 1,
    stock: [...l.stock],
    assumeAlternativePlanKept: l.assumeAlternativePlanKept,
    compare: l.compare,
    brushes: [],
    protect: {
      rentControl: l.protect.rentControl,
      historic: l.protect.historic,
      newerThanYears: l.protect.newerThanYears,
      strokes: []
    },
    timing: {
      timers: l.timers.map((t) => ({ ...t })),
      routeShares: l.routeShares ? { ...l.routeShares } : null,
      localProgramStreamlined: l.localProgramStreamlined
    }
  };
}

// ---- parsing ----

function rec(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    fail(path || '$', 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(`${path}.${k}`, 'unknown key');
  for (const k of keys) if (!(k in r)) fail(`${path}.${k}`, 'missing');
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
const MODES = ['raise', 'lower', 'set'] as const;

function parseEffect(v: unknown, path: string): Effect {
  const r = rec(v, path, ['mode', 'stories', 'densityLimits']);
  return {
    mode: oneOf(r.mode, j(path, 'mode'), MODES),
    stories: stories(r.stories, j(path, 'stories')),
    densityLimits: bool(r.densityLimits, j(path, 'densityLimits'))
  };
}

function parseStrokeBody(r: Record<string, unknown>, path: string): Stroke {
  const radiusM = finite(r.radiusM, j(path, 'radiusM'));
  if (radiusM <= 0) fail(j(path, 'radiusM'), 'expected a positive number');
  const pathPts = arr(r.path, j(path, 'path')).map((p, i) => {
    const pp = `${j(path, 'path')}[${i}]`;
    const a = arr(p, pp);
    if (a.length !== 2) fail(pp, 'expected [lng, lat]');
    return [finite(a[0], `${pp}[0]`), finite(a[1], `${pp}[1]`)] as [number, number];
  });
  return { path: pathPts, radiusM };
}

function parseStrokes(v: unknown, path: string): Stroke[] {
  return arr(v, path).map((x, i) => {
    const p = `${path}[${i}]`;
    return parseStrokeBody(rec(x, p, ['path', 'radiusM']), p);
  });
}

function parseBrush(v: unknown, path: string): ZoningBrush {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const kind = oneOf((v as Record<string, unknown>).kind, j(path, 'kind'), [
    'freehand',
    'erase',
    'transit',
    'street',
    'area'
  ] as const);
  switch (kind) {
    case 'freehand': {
      const r = rec(v, path, ['id', 'kind', 'strokes', 'effect']);
      return {
        id: str(r.id, j(path, 'id')),
        kind,
        strokes: parseStrokes(r.strokes, j(path, 'strokes')),
        effect: parseEffect(r.effect, j(path, 'effect'))
      };
    }
    case 'erase': {
      const r = rec(v, path, ['id', 'kind', 'strokes']);
      return {
        id: str(r.id, j(path, 'id')),
        kind,
        strokes: parseStrokes(r.strokes, j(path, 'strokes'))
      };
    }
    case 'transit': {
      const r = rec(v, path, ['id', 'kind', 'stopTypes', 'bands', 'mode', 'densityLimits']);
      const bandList = arr(r.bands, j(path, 'bands'));
      if (bandList.length === 0) fail(j(path, 'bands'), 'expected at least one band');
      return {
        id: str(r.id, j(path, 'id')),
        kind,
        stopTypes: oneOfList(r.stopTypes, j(path, 'stopTypes'), STOP_TYPES),
        bands: bandList.map((b, i) => {
          const bp = `${j(path, 'bands')}[${i}]`;
          const br = rec(b, bp, ['maxM', 'stories']);
          const maxM = finite(br.maxM, j(bp, 'maxM'));
          if (maxM <= 0) fail(j(bp, 'maxM'), 'expected a positive number');
          return { maxM, stories: stories(br.stories, j(bp, 'stories')) };
        }),
        mode: oneOf(r.mode, j(path, 'mode'), MODES),
        densityLimits: bool(r.densityLimits, j(path, 'densityLimits'))
      };
    }
    case 'street': {
      const r = rec(v, path, ['id', 'kind', 'classes', 'names', 'depth', 'ncOnly', 'effect']);
      if (r.depth !== 0 && r.depth !== 1) fail(j(path, 'depth'), 'expected 0 or 1');
      return {
        id: str(r.id, j(path, 'id')),
        kind,
        classes: oneOfList(r.classes, j(path, 'classes'), STREET_CLASSES),
        names: strings(r.names, j(path, 'names')),
        depth: r.depth,
        ncOnly: bool(r.ncOnly, j(path, 'ncOnly')),
        effect: parseEffect(r.effect, j(path, 'effect'))
      };
    }
    case 'area': {
      const r = rec(v, path, ['id', 'kind', 'districts', 'neighborhoods', 'effect']);
      return {
        id: str(r.id, j(path, 'id')),
        kind,
        districts: strings(r.districts, j(path, 'districts')),
        neighborhoods: strings(r.neighborhoods, j(path, 'neighborhoods')),
        effect: parseEffect(r.effect, j(path, 'effect'))
      };
    }
  }
}

/** Timing fields get the lever parser's full check; errors are re-pathed under `timing.`. */
function parseTiming(tr: Record<string, unknown>): SimPolicy['timing'] {
  try {
    const l = parseSimLevers({
      ...DEFAULT_LEVERS,
      timers: tr.timers,
      routeShares: tr.routeShares,
      localProgramStreamlined: tr.localProgramStreamlined
    });
    return {
      timers: l.timers,
      routeShares: l.routeShares,
      localProgramStreamlined: l.localProgramStreamlined
    };
  } catch (e) {
    if (e instanceof LeverFormatError) fail(`timing.${e.path}`, e.message);
    throw e;
  }
}

/** Validate a policy document. Throws `PolicyFormatError` naming the first bad field. */
export function parseSimPolicy(json: unknown): SimPolicy {
  const r = rec(json, '', [
    'schema',
    'stock',
    'assumeAlternativePlanKept',
    'compare',
    'brushes',
    'protect',
    'timing'
  ]);
  if (r.schema !== 1) fail('schema', `expected 1, got ${String(r.schema)}`);
  const stock = oneOfList(r.stock, 'stock', STOCK_LAYERS);
  if (stock.length === 0) fail('stock', 'expected at least one layer');
  const pr = rec(r.protect, 'protect', ['rentControl', 'historic', 'newerThanYears', 'strokes']);
  const n = pr.newerThanYears;
  if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0))
    fail('protect.newerThanYears', 'expected null or a positive number');
  const tr = rec(r.timing, 'timing', ['timers', 'routeShares', 'localProgramStreamlined']);
  const timing = parseTiming(tr);
  const brushes = arr(r.brushes, 'brushes').map((b, i) => parseBrush(b, `brushes[${i}]`));
  const ids = new Set<string>();
  brushes.forEach((b, i) => {
    if (ids.has(b.id)) fail(`brushes[${i}].id`, 'duplicate brush id');
    ids.add(b.id);
  });
  return {
    schema: 1,
    stock: STOCK_LAYERS.filter((l) => stock.includes(l)),
    assumeAlternativePlanKept: bool(r.assumeAlternativePlanKept, 'assumeAlternativePlanKept'),
    compare: oneOf(r.compare, 'compare', ['currentLaw', 'preFzp'] as const),
    brushes,
    protect: {
      rentControl: bool(pr.rentControl, 'protect.rentControl'),
      historic: bool(pr.historic, 'protect.historic'),
      newerThanYears: n,
      strokes: arr(pr.strokes, 'protect.strokes').map((x, i) => {
        const p = `protect.strokes[${i}]`;
        const sr = rec(x, p, ['path', 'radiusM', 'kind']);
        return {
          ...parseStrokeBody(sr, p),
          kind: oneOf(sr.kind, j(p, 'kind'), ['protect', 'unprotect'] as const)
        };
      })
    },
    timing
  };
}

// ---- queries ----

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function queryKey(q: BrushQuery): string {
  return canonical(q);
}

const bandsOutermostFirst = (bands: TransitBand[]) => [...bands].sort((a, b) => b.maxM - a.maxM);

/** The lot queries a brush needs (a transit brush: one per band, outermost first). */
export function brushQueries(b: ZoningBrush): BrushQuery[] {
  switch (b.kind) {
    case 'freehand':
    case 'erase':
      return [{ kind: 'freehand', strokes: b.strokes }];
    case 'transit':
      return bandsOutermostFirst(b.bands).map((band) => ({
        kind: 'transit',
        stopTypes: b.stopTypes,
        maxM: band.maxM
      }));
    case 'street':
      return [
        { kind: 'street', classes: b.classes, names: b.names, depth: b.depth, ncOnly: b.ncOnly }
      ];
    case 'area':
      return [{ kind: 'area', districts: b.districts, neighborhoods: b.neighborhoods }];
  }
}

/** Runs of same-kind protect strokes, each a freehand query. */
function protectRuns(p: SimPolicy): { kind: 'protect' | 'unprotect'; query: BrushQuery }[] {
  const runs: { kind: 'protect' | 'unprotect'; strokes: Stroke[] }[] = [];
  for (const st of p.protect.strokes) {
    const last = runs[runs.length - 1];
    const plain: Stroke = { path: st.path, radiusM: st.radiusM };
    if (last && last.kind === st.kind) last.strokes.push(plain);
    else runs.push({ kind: st.kind, strokes: [plain] });
  }
  return runs.map((r) => ({ kind: r.kind, query: { kind: 'freehand', strokes: r.strokes } }));
}

/** Every lot query the policy needs, with a stable key (canonical JSON of the query). */
export function queriesOf(p: SimPolicy): { key: string; query: BrushQuery }[] {
  const seen = new Map<string, BrushQuery>();
  const add = (q: BrushQuery) => {
    const k = queryKey(q);
    if (!seen.has(k)) seen.set(k, q);
  };
  for (const b of p.brushes) brushQueries(b).forEach(add);
  for (const r of protectRuns(p)) add(r.query);
  return [...seen].map(([key, query]) => ({ key, query }));
}

type Lots = (key: string) => readonly ParcelId[] | undefined;

const sortedUnique = (xs: Iterable<ParcelId>): ParcelId[] =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Brushes in order to edits; null while any needed query is unknown. */
function emit(p: SimPolicy, lots: Lots): UserEdit[] | null {
  const out: UserEdit[] = [];
  const need = (q: BrushQuery) => lots(queryKey(q));
  const push = (ids: readonly ParcelId[], mode: BrushMode, stories: number, dl: boolean) => {
    const l = sortedUnique(ids);
    if (l.length > 0) out.push({ lots: l, mode, stories, densityLimits: dl });
  };
  for (const b of p.brushes) {
    const qs = brushQueries(b);
    const got = qs.map(need);
    if (got.some((g) => g === undefined)) return null;
    switch (b.kind) {
      case 'erase': {
        const gone = new Set(got[0]);
        for (const e of out) e.lots = e.lots.filter((x) => !gone.has(x));
        for (let i = out.length - 1; i >= 0; i--) if (out[i].lots.length === 0) out.splice(i, 1);
        break;
      }
      case 'transit': {
        const bands = bandsOutermostFirst(b.bands);
        bands.forEach((band, i) => push(got[i]!, b.mode, band.stories, b.densityLimits));
        break;
      }
      default:
        push(got[0]!, b.effect.mode, b.effect.stories, b.effect.densityLimits);
    }
  }
  return out;
}

/** The keys of the protect strokes' queries (one per run of same-kind strokes). */
export function protectQueryKeys(p: SimPolicy): string[] {
  return [...new Set(protectRuns(p).map((r) => queryKey(r.query)))];
}

/**
 * The compiled `protect.lots`: protect runs minus unprotect runs, in order; null while unknown.
 */
export function protectedLots(p: SimPolicy, lots: Lots): ParcelId[] | null {
  const set = new Set<ParcelId>();
  for (const r of protectRuns(p)) {
    const got = lots(queryKey(r.query));
    if (got === undefined) return null;
    for (const x of got) {
      if (r.kind === 'protect') set.add(x);
      else set.delete(x);
    }
  }
  return sortedUnique(set);
}

export function compileLevers(p: SimPolicy, lots: Lots): SimLevers | null {
  const user = emit(p, lots);
  const prot = protectedLots(p, lots);
  if (user === null || prot === null) return null;
  return {
    schema: 1,
    stock: [...p.stock],
    assumeAlternativePlanKept: p.assumeAlternativePlanKept,
    user,
    protect: {
      rentControl: p.protect.rentControl,
      historic: p.protect.historic,
      newerThanYears: p.protect.newerThanYears,
      lots: prot
    },
    timers: p.timing.timers.map((t) => ({ ...t })),
    routeShares: p.timing.routeShares ? { ...p.timing.routeShares } : null,
    localProgramStreamlined: p.timing.localProgramStreamlined,
    compare: p.compare
  };
}

export type LotRole = 'raise' | 'lower' | 'set' | 'protected';

/** Per-lot role for the map: the last brush to touch a lot wins; protection beats all. */
export function lotRoles(p: SimPolicy, lots: Lots): Map<ParcelId, LotRole> {
  const roles = new Map<ParcelId, LotRole>();
  for (const e of emit(p, (k) => lots(k) ?? []) ?? []) for (const x of e.lots) roles.set(x, e.mode);
  for (const x of protectedLots(p, (k) => lots(k) ?? []) ?? []) roles.set(x, 'protected');
  return roles;
}

export interface ScoreCopy {
  plan: string;
  twin: string;
}

const isFzpCompat = (l: SimLevers) => canonical(l) === canonical(FZP_COMPAT_LEVERS);

export function scoreCopy(l: SimLevers | null): ScoreCopy {
  if (l === null || isFzpCompat(l))
    return { plan: 'the Family Zoning Plan', twin: 'the old zoning' };
  return {
    plan: 'your policy',
    twin: l.compare === 'currentLaw' ? "the City's current rules" : 'the old zoning'
  };
}
