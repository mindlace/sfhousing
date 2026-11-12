/**
 * The funding part of the lever document (`FinanceLevers`, spec 2026-11-09 section 4.1): its
 * limits and `parseFinanceLevers`. Worker-safe: hand-written guards, no zod, no DOM. `types.ts`
 * and this file import each other at call time only.
 */
import { MARKET_TERMS, resolveTerms, validateInstrument } from '$lib/sim/finance';
import { CalibrationFormatError, checkPool } from '$lib/timelapse/model';
import {
  INCOME_TIERS,
  type Inflow,
  type Instrument,
  type Pool,
  type Programme,
  type TermKey
} from '$lib/timelapse/types';
import { LeverFormatError, array, record, type FinanceLevers } from './types';

/** Tier 4 sanity limits, F7. */
export const FINANCE_LIMITS = {
  pools: 12,
  inflowsPerPool: 12,
  programmes: 24,
  baselineScale: 24,
  labelChars: 80,
  idChars: 40
} as const;

/** 2000-01-01 and 2100-01-01 as days since 1970-01-01. Tier 4 bounds. */
export const FIRST_DAY = 10957;
export const LAST_DAY = 47482;
/** Ten times the Charter's general-obligation limit, rounded. Tier 4. */
export const MAX_DOLLARS = 100_000_000_000;
const MAX_LEVERAGE = 10;
const MAX_MIN_HOMES = 10000;
const SUM_TOLERANCE = 1e-9;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TERM_KEYS = [
  'constructionRate',
  'constructionYears',
  'requiredReturn',
  'guaranteeRateCut',
  'lossOnExit'
] as const satisfies readonly TermKey[];
const INSTRUMENT_KEYS = {
  grant: ['kind', 'share'],
  loan: ['kind', 'costShare', 'rate', 'requiredReturn'],
  guarantee: ['kind', 'costShare', 'reserve']
} as const;

function fail(path: string, message: string): never {
  throw new LeverFormatError(path, message);
}

const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isDay = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= FIRST_DAY && v <= LAST_DAY;
const DAY_MSG = `expected a whole day from ${FIRST_DAY} to ${LAST_DAY}`;

function day(v: unknown, path: string): number {
  if (!isDay(v)) fail(path, DAY_MSG);
  return v;
}

function label(v: unknown, path: string): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < 1 || t.length > FINANCE_LIMITS.labelChars)
    fail(path, `expected a label of 1 to ${FINANCE_LIMITS.labelChars} characters`);
  return t;
}

function addedId(v: unknown, path: string, seen: Set<string>): string {
  if (!isId(v) || !v.startsWith('u-')) fail(path, 'expected an id starting u-');
  if (seen.has(v)) fail(path, 'duplicate id');
  seen.add(v);
  return v;
}

function dollars(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_DOLLARS)
    fail(path, `expected whole dollars from 1 to ${MAX_DOLLARS}`);
  return v;
}

function parseScale(v: unknown, path: string): FinanceLevers['baselineScale'][number] {
  const r = record(v, path, ['pool', 'from', 'scale']);
  if (!isId(r.pool) || r.pool.startsWith('u-')) fail(`${path}.pool`, 'expected a baseline pool id');
  const from = day(r.from, `${path}.from`);
  const s = r.scale;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 10)
    fail(`${path}.scale`, 'expected a number from 0 to 10');
  return { pool: r.pool, from, scale: s };
}

function parseInflow(v: unknown, path: string): Inflow {
  const f = v as Record<string, unknown>;
  if (f.kind === 'once') {
    return {
      kind: 'once',
      day: day(f.day, `${path}.day`),
      dollars: dollars(f.dollars, `${path}.dollars`)
    };
  }
  const from = day(f.from, `${path}.from`);
  const to = f.to === null ? null : day(f.to, `${path}.to`);
  return {
    kind: 'yearly',
    from,
    to,
    dollarsPerYear: dollars(f.dollarsPerYear, `${path}.dollarsPerYear`)
  };
}

function parsePool(v: unknown, path: string, seen: Set<string>): Pool {
  const r = record(v, path, ['id', 'kind', 'label', 'inflows', 'uncapped', 'debt', 'leverage']);
  try {
    checkPool(v, path);
  } catch (e) {
    if (e instanceof CalibrationFormatError)
      throw new LeverFormatError(e.path, e.message.slice(e.path.length + 2));
    throw e;
  }
  const id = addedId(r.id, `${path}.id`, seen);
  const lab = label(r.label, `${path}.label`);
  if (r.uncapped !== false)
    fail(`${path}.uncapped`, 'expected false: an added pool has a schedule of money');
  const raw = r.inflows as unknown[];
  if (raw.length < 1 || raw.length > FINANCE_LIMITS.inflowsPerPool)
    fail(`${path}.inflows`, `expected 1 to ${FINANCE_LIMITS.inflowsPerPool} inflows`);
  const inflows = raw.map((f, i) => parseInflow(f, `${path}.inflows[${i}]`));
  const leverage = r.leverage as number;
  if (r.kind === 'bank' && leverage > MAX_LEVERAGE)
    fail(`${path}.leverage`, `expected a number above 0 and at most ${MAX_LEVERAGE}`);
  return {
    id,
    kind: r.kind as Pool['kind'],
    label: lab,
    inflows,
    uncapped: false,
    debt: r.debt === null ? null : { ...(r.debt as NonNullable<Pool['debt']>) },
    leverage
  };
}

function parseInstrument(v: unknown, path: string): Instrument {
  const r = record(v, path, ['kind'], ['share', 'costShare', 'rate', 'requiredReturn', 'reserve']);
  const kind = r.kind;
  if (kind !== 'grant' && kind !== 'loan' && kind !== 'guarantee')
    fail(`${path}.kind`, 'expected one of grant, loan, guarantee');
  record(v, path, INSTRUMENT_KEYS[kind]);
  const inst = { ...r } as unknown as Instrument;
  const msg = validateInstrument(inst);
  if (msg !== null) fail(path, msg);
  return inst;
}

function parseProgramme(
  v: unknown,
  path: string,
  seen: Set<string>,
  addedPools: ReadonlySet<string>
): Programme {
  const r = record(v, path, [
    'id',
    'label',
    'pool',
    'reach',
    'instrument',
    'from',
    'to',
    'minHomes',
    'tiers'
  ]);
  const id = addedId(r.id, `${path}.id`, seen);
  const lab = label(r.label, `${path}.label`);
  if (!isId(r.pool)) fail(`${path}.pool`, 'expected a pool id');
  if (r.pool.startsWith('u-') && !addedPools.has(r.pool))
    fail(`${path}.pool`, 'expected the id of an added pool');
  if (r.reach !== 'market' && r.reach !== 'affordable')
    fail(`${path}.reach`, 'expected one of market, affordable');
  const instrument = parseInstrument(r.instrument, `${path}.instrument`);
  const from = day(r.from, `${path}.from`);
  if (r.to !== null && !(isDay(r.to) && r.to >= from))
    fail(`${path}.to`, 'expected null or a day on or after from');
  const m = r.minHomes;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > MAX_MIN_HOMES)
    fail(`${path}.minHomes`, `expected a whole number from 0 to ${MAX_MIN_HOMES}`);
  let tiers: Programme['tiers'] = null;
  if ((r.reach === 'affordable') !== (r.tiers !== null))
    fail(`${path}.tiers`, 'expected tiers for affordable reach only');
  if (r.tiers !== null) {
    const t = record(r.tiers, `${path}.tiers`, INCOME_TIERS);
    let sum = 0;
    tiers = {} as NonNullable<Programme['tiers']>;
    for (const k of INCOME_TIERS) {
      const x = t[k];
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0)
        fail(`${path}.tiers.${k}`, 'expected a number of 0 or more');
      tiers[k] = x;
      sum += x;
    }
    if (!(Math.abs(sum - 1) <= SUM_TOLERANCE))
      fail(`${path}.tiers`, `expected values summing to 1, got ${sum}`);
  }
  return {
    id,
    label: lab,
    pool: r.pool,
    reach: r.reach,
    instrument,
    from,
    to: r.to as Programme['to'],
    minHomes: m,
    tiers
  };
}

function parseTerms(v: unknown, path: string): Partial<Record<TermKey, number>> {
  const r = record(v, path, [], TERM_KEYS);
  const out: Partial<Record<TermKey, number>> = {};
  for (const key of TERM_KEYS) {
    if (!(key in r)) continue;
    const x = r[key];
    if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${path}.${key}`, 'expected a number');
    try {
      resolveTerms(MARKET_TERMS, { [key]: x });
    } catch (e) {
      if (e instanceof RangeError) fail(`${path}.${key}`, e.message);
      throw e;
    }
    out[key] = x;
  }
  return out;
}

/** Validate a `FinanceLevers`; throws `LeverFormatError` naming the first bad field. */
export function parseFinanceLevers(v: unknown, path: string): FinanceLevers {
  const r = record(v, path, ['baselineScale', 'pools', 'programmes', 'terms']);

  const rawScale = array(r.baselineScale, `${path}.baselineScale`);
  if (rawScale.length > FINANCE_LIMITS.baselineScale)
    fail(`${path}.baselineScale`, `expected at most ${FINANCE_LIMITS.baselineScale} scale entries`);
  const baselineScale = rawScale.map((x, i) => parseScale(x, `${path}.baselineScale[${i}]`));
  for (let i = 1; i < baselineScale.length; i++) {
    const a = baselineScale[i - 1];
    const b = baselineScale[i];
    if (b.pool < a.pool || (b.pool === a.pool && b.from <= a.from))
      fail(
        `${path}.baselineScale[${i}]`,
        'expected entries sorted by pool, then by from, with no two on one day'
      );
  }

  const rawPools = array(r.pools, `${path}.pools`);
  if (rawPools.length > FINANCE_LIMITS.pools)
    fail(`${path}.pools`, `expected at most ${FINANCE_LIMITS.pools} pools`);
  const poolIds = new Set<string>();
  const pools = rawPools.map((x, i) => parsePool(x, `${path}.pools[${i}]`, poolIds));

  const rawProgs = array(r.programmes, `${path}.programmes`);
  if (rawProgs.length > FINANCE_LIMITS.programmes)
    fail(`${path}.programmes`, `expected at most ${FINANCE_LIMITS.programmes} programmes`);
  const progIds = new Set<string>();
  const programmes = rawProgs.map((x, i) =>
    parseProgramme(x, `${path}.programmes[${i}]`, progIds, poolIds)
  );

  return { baselineScale, pools, programmes, terms: parseTerms(r.terms, `${path}.terms`) };
}
