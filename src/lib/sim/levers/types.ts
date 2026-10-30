/**
 * The /sim lever document: a sibling of the editor's `Plan`, not new `PlanOp`s. It is mostly
 * static configuration; user edits name lots by `ParcelId` so the document stays meaningful
 * across row reorderings. Worker-safe: hand-written guards, no zod, no DOM.
 */
import type { ParcelId } from '$lib/data/parcel';
import {
  PATHWAYS,
  type Day,
  type Pathway,
  type Provenance,
  type Stage
} from '$lib/timelapse/types';
import { dayOf } from '../scenario/dates';

/** Canonical blend order. Blending is order-insensitive; a tie keeps the earlier layer. */
export const STOCK_LAYERS = ['currentLaw', 'fzp', 'sb79', 'base'] as const;
export type StockLayerId = (typeof STOCK_LAYERS)[number];

/** Construction and completion are locked: no lever edits them. */
export type TimedStage = Exclude<Stage, 'complete' | 'construction'>;
const TIMED_STAGES = [
  'preApplication',
  'filed',
  'entitled',
  'permitFiled',
  'permitIssued'
] as const satisfies readonly TimedStage[];

export interface UserEdit {
  lots: ParcelId[];
  mode: 'raise' | 'lower' | 'set';
  stories: number;
  densityLimits: boolean;
}

export interface Protections {
  rentControl: boolean;
  historic: boolean;
  newerThanYears: number | null;
  lots: ParcelId[];
}

export interface TimerEdit {
  pathway: Pathway;
  stage: TimedStage;
  scale: number;
  reach: 'all' | 'new';
}

export interface SimLevers {
  schema: 1;
  stock: StockLayerId[];
  assumeAlternativePlanKept: boolean;
  user: UserEdit[];
  protect: Protections;
  timers: TimerEdit[];
  routeShares: Record<Pathway, number> | null; // null = observed pathwayForNew
  localProgramStreamlined: boolean;
  compare: 'currentLaw' | 'preFzp';
}

/** Numerical bounds only (plan 2 ruling 3): at 0.05 every table keeps C(K') <= 1 - 1e-6. Tier 4. */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

/** Largest story count a lot can carry (one byte in the packed columns). */
const MAX_STORIES = 255;

/** Plan 2 ruling 1: the day current law switches from FZP to SB 79 where SB 79 is more permissive. */
export const CURRENT_LAW_SWITCH: { day: Day; provenance: Provenance } = {
  day: dayOf(2032, 1, 31),
  provenance: {
    tier: 4,
    label:
      'Assumption: SB 79 as written takes effect one year after the 7th-cycle Housing Element due date',
    sources: [],
    method:
      'The temporary SB 79 exemptions and the Alternative Plan lapse together, one year after the 7th-cycle Housing Element due date (2031-01-31); the exemptions are therefore not applied after the switch.'
  }
};

export const DEFAULT_LEVERS: SimLevers = {
  schema: 1,
  stock: ['currentLaw'],
  assumeAlternativePlanKept: false,
  user: [],
  protect: { rentControl: false, historic: false, newerThanYears: null, lots: [] },
  timers: [],
  routeShares: null,
  localProgramStreamlined: true,
  compare: 'currentLaw'
};

/** The levers under which /sim reproduces /fzp. */
export const FZP_COMPAT_LEVERS: SimLevers = {
  schema: 1,
  stock: ['fzp'],
  assumeAlternativePlanKept: false,
  user: [],
  protect: { rentControl: false, historic: false, newerThanYears: null, lots: [] },
  timers: [],
  routeShares: null,
  localProgramStreamlined: true,
  compare: 'preFzp'
};

export class LeverFormatError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'LeverFormatError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new LeverFormatError(path, message);
}

function join(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

function record(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    fail(path || '$', 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) fail(join(path, k), 'unknown key');
  for (const k of keys) if (!(k in r)) fail(join(path, k), 'missing');
  return r;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T))
    fail(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}

function lotIds(v: unknown, path: string): ParcelId[] {
  return array(v, path).map((x, i) => {
    if (typeof x !== 'string') fail(`${path}[${i}]`, 'expected a string lot id');
    return x;
  });
}

function parseStock(v: unknown): StockLayerId[] {
  const xs = array(v, 'stock').map((x, i) => oneOf(x, `stock[${i}]`, STOCK_LAYERS));
  if (xs.length === 0) fail('stock', 'expected at least one layer');
  return STOCK_LAYERS.filter((l) => xs.includes(l));
}

function parseUserEdit(v: unknown, path: string): UserEdit {
  const r = record(v, path, ['lots', 'mode', 'stories', 'densityLimits']);
  const stories = r.stories;
  if (
    typeof stories !== 'number' ||
    !Number.isInteger(stories) ||
    stories < 0 ||
    stories > MAX_STORIES
  )
    fail(`${path}.stories`, `expected an integer from 0 to ${MAX_STORIES}`);
  return {
    lots: lotIds(r.lots, `${path}.lots`),
    mode: oneOf(r.mode, `${path}.mode`, ['raise', 'lower', 'set'] as const),
    stories,
    densityLimits: bool(r.densityLimits, `${path}.densityLimits`)
  };
}

function parseProtections(v: unknown): Protections {
  const r = record(v, 'protect', ['rentControl', 'historic', 'newerThanYears', 'lots']);
  const n = r.newerThanYears;
  if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0))
    fail('protect.newerThanYears', 'expected null or a positive number');
  return {
    rentControl: bool(r.rentControl, 'protect.rentControl'),
    historic: bool(r.historic, 'protect.historic'),
    newerThanYears: n,
    lots: lotIds(r.lots, 'protect.lots')
  };
}

function parseTimer(v: unknown, path: string): TimerEdit {
  const r = record(v, path, ['pathway', 'stage', 'scale', 'reach']);
  const scale = r.scale;
  if (
    typeof scale !== 'number' ||
    !Number.isFinite(scale) ||
    scale < MIN_SCALE ||
    scale > MAX_SCALE
  )
    fail(`${path}.scale`, `expected a number from ${MIN_SCALE} to ${MAX_SCALE}`);
  return {
    pathway: oneOf(r.pathway, `${path}.pathway`, PATHWAYS),
    stage: oneOf(r.stage, `${path}.stage`, TIMED_STAGES),
    scale,
    reach: oneOf(r.reach, `${path}.reach`, ['all', 'new'] as const)
  };
}

/** Shares stay as given; `routeSharesOp` normalises them. */
function parseRouteShares(v: unknown): Record<Pathway, number> | null {
  if (v === null) return null;
  const r = record(v, 'routeShares', PATHWAYS);
  const out = {} as Record<Pathway, number>;
  let sum = 0;
  for (const p of PATHWAYS) {
    const x = r[p];
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0)
      fail(`routeShares.${p}`, 'expected a non-negative number');
    out[p] = x;
    sum += x;
  }
  if (!(sum > 0)) fail('routeShares', 'expected shares that sum to more than 0');
  return out;
}

/** Validate a lever document. Throws `LeverFormatError` naming the first bad field. */
export function parseSimLevers(json: unknown): SimLevers {
  const r = record(json, '', [
    'schema',
    'stock',
    'assumeAlternativePlanKept',
    'user',
    'protect',
    'timers',
    'routeShares',
    'localProgramStreamlined',
    'compare'
  ]);
  if (r.schema !== 1) fail('schema', `expected 1, got ${String(r.schema)}`);
  return {
    schema: 1,
    stock: parseStock(r.stock),
    assumeAlternativePlanKept: bool(r.assumeAlternativePlanKept, 'assumeAlternativePlanKept'),
    user: array(r.user, 'user').map((x, i) => parseUserEdit(x, `user[${i}]`)),
    protect: parseProtections(r.protect),
    timers: array(r.timers, 'timers').map((x, i) => parseTimer(x, `timers[${i}]`)),
    routeShares: parseRouteShares(r.routeShares),
    localProgramStreamlined: bool(r.localProgramStreamlined, 'localProgramStreamlined'),
    compare: oneOf(r.compare, 'compare', ['currentLaw', 'preFzp'] as const)
  };
}
