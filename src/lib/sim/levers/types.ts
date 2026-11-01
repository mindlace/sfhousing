/**
 * The /sim lever document: a sibling of the editor's `Plan`, not new `PlanOp`s. It is mostly
 * static configuration; rules and paint name lots by `ParcelId` so the document stays meaningful
 * across row reorderings. Worker-safe: hand-written guards, no zod, no DOM.
 */
import type { ParcelId } from '$lib/data/parcel';
import { PATHWAYS, type Pathway, type Stage } from '$lib/timelapse/types';

/** Construction and completion are locked: no lever edits them. */
export type TimedStage = Exclude<Stage, 'complete' | 'construction'>;
const TIMED_STAGES = [
  'preApplication',
  'filed',
  'entitled',
  'permitFiled',
  'permitIssued'
] as const satisfies readonly TimedStage[];

/** An edit naming lots and a story count (integer 0..255). Rules raise; paint sets. */
export interface StoryEdit {
  lots: ParcelId[];
  stories: number;
}

export interface Protections {
  rentControl: boolean;
  historic: boolean;
  newerThanYears: number | null;
}

export interface TimerEdit {
  pathway: Pathway;
  stage: TimedStage;
  scale: number;
  reach: 'all' | 'new';
}

/** The twin: pre-FZP zoning, or FZP as written. */
export type Compare = 'preFzp' | 'fzp';
export const COMPARES = ['preFzp', 'fzp'] as const satisfies readonly Compare[];

/**
 * Schema 2: FZP as written, plus additive rules and custom paint (spec 2026-10-31, section 3).
 * `rules` give each lot `max(FZP, N)`, uncapped where they raise, whatever their order; `paint`
 * then sets `N` uncapped, in document order (a later stroke wins).
 */
export interface SimLevers {
  schema: 2;
  rules: StoryEdit[];
  paint: StoryEdit[];
  protect: Protections;
  timers: TimerEdit[];
  routeShares: Record<Pathway, number> | null; // null = observed pathwayForNew
  localProgramStreamlined: boolean;
  compare: Compare;
}

/** Numerical bounds only (plan 2 ruling 3): at 0.05 every table keeps C(K') <= 1 - 1e-6. Tier 4. */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

/** Largest story count a lot can carry (one byte in the packed columns). */
const MAX_STORIES = 255;

export const DEFAULT_LEVERS: SimLevers = {
  schema: 2,
  rules: [],
  paint: [],
  protect: { rentControl: false, historic: false, newerThanYears: null },
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

function parseStoryEdit(v: unknown, path: string): StoryEdit {
  const r = record(v, path, ['lots', 'stories']);
  const stories = r.stories;
  if (
    typeof stories !== 'number' ||
    !Number.isInteger(stories) ||
    stories < 0 ||
    stories > MAX_STORIES
  )
    fail(`${path}.stories`, `expected an integer from 0 to ${MAX_STORIES}`);
  return { lots: lotIds(r.lots, `${path}.lots`), stories };
}

function parseProtections(v: unknown): Protections {
  const r = record(v, 'protect', ['rentControl', 'historic', 'newerThanYears']);
  const n = r.newerThanYears;
  if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0))
    fail('protect.newerThanYears', 'expected null or a positive number');
  return {
    rentControl: bool(r.rentControl, 'protect.rentControl'),
    historic: bool(r.historic, 'protect.historic'),
    newerThanYears: n
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
    'rules',
    'paint',
    'protect',
    'timers',
    'routeShares',
    'localProgramStreamlined',
    'compare'
  ]);
  if (r.schema !== 2) fail('schema', `expected 2, got ${String(r.schema)}`);
  return {
    schema: 2,
    rules: array(r.rules, 'rules').map((x, i) => parseStoryEdit(x, `rules[${i}]`)),
    paint: array(r.paint, 'paint').map((x, i) => parseStoryEdit(x, `paint[${i}]`)),
    protect: parseProtections(r.protect),
    timers: array(r.timers, 'timers').map((x, i) => parseTimer(x, `timers[${i}]`)),
    routeShares: parseRouteShares(r.routeShares),
    localProgramStreamlined: bool(r.localProgramStreamlined, 'localProgramStreamlined'),
    compare: oneOf(r.compare, 'compare', COMPARES)
  };
}
