// A version 2 game (units, the tree and the ladder) read as version 3. Value imports are
// relative, as save-shape.ts needs.
import { dayFromUtc, monthStart } from '../fzp/time';
import type { Day } from '$lib/timelapse/time';
import { NEW_GAME, type GameState, type Win } from './state';

/** The version 2 ladder's years (the last LADDER_YEARS, catalogue/ladder-years.ts:4). */
export const V2_LADDER_YEARS: readonly number[] = Object.freeze([2060, 2055, 2045, 2040]);

/** The last round, ROUNDS of catalogue/rounds.ts (the version 2 ladder's last rung). */
const LAST = 4;

/**
 * The catalogue's permitting and money keys: the version 2 node ids a bought node maps straight
 * to (catalogue/rounds.ts; a spec holds the two lists equal).
 */
export const V2_KEYS: readonly string[] = Object.freeze([
  'benchmark-permits',
  'federal-support',
  'general-revenue',
  'housing-bond',
  'no-discretionary',
  'public-bank',
  'revolving-fund',
  'sb423-clock',
  'state-double'
]);

type Plain = Record<string, unknown>;
const isPlain = (x: unknown): x is Plain =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isTime = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x));
const isWhole = (x: unknown, min: number): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= min;
const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';

interface Met {
  rung: number;
  reachedOn: Day;
  datasetVersion: string;
  at: string;
}

function parseMet(x: unknown): Met | null {
  if (!isPlain(x)) return null;
  const { rung, reachedOn, datasetVersion, at } = x;
  if (!isWhole(rung, 0) || !isWhole(reachedOn, 0)) return null;
  if (!isText(datasetVersion) || !isTime(at)) return null;
  return { rung, reachedOn, datasetVersion, at };
}

/** The first day of December of rung `r`'s year (r from 1); the month the rung's deadline is in. */
const rungMonth = (r: number): Day => dayFromUtc(V2_LADDER_YEARS[r - 1], 12, 1);

/** A version 2 state, read leniently (only phase, firstWinAt, bought, rung, met, runs are
 *  checked), as version 3; null when those fields are unusable. */
export function upgradeV2(x: Record<string, unknown>): GameState | null {
  const { phase, firstWinAt, bought, rung, runs } = x;
  if (phase !== 'opening' && phase !== 'runs') return null;
  if (firstWinAt !== null && !isTime(firstWinAt)) return null;
  if (!isPlain(bought)) return null;
  if (!isWhole(rung, 0) || !isWhole(runs, 0)) return null;
  if (!Array.isArray(x.met)) return null;
  const met: Met[] = [];
  for (const e of x.met) {
    const m = parseMet(e);
    if (m === null) return null;
    met.push(m);
  }
  if (phase === 'opening') return { ...structuredClone(NEW_GAME), firstWinAt };
  if (firstWinAt === null) return null;
  const base: GameState = { ...structuredClone(NEW_GAME), phase: 'runs', firstWinAt };
  if (runs === 0) return base;

  // Rungs past the ladder's last (a later build's drift) are not this ladder's.
  const kept = met.filter((m) => m.rung <= LAST).sort((a, b) => a.rung - b.rung);
  const top = kept.reduce((t, m) => Math.max(t, m.rung), 0);
  const wins: Win[] = kept.map((m) => ({
    round: m.rung,
    goalMonth: monthStart(m.reachedOn),
    beat: m.rung === 0 ? null : rungMonth(m.rung),
    at: m.at,
    datasetVersion: m.datasetVersion
  }));
  const editable = V2_KEYS.filter((k) => Object.hasOwn(bought, k) && isWhole(bought[k], 1));
  const finished = kept.some((m) => m.rung === LAST);
  return {
    ...base,
    round: finished ? LAST : Math.min(rung + 1, LAST),
    target: top > 0 ? rungMonth(top) : null,
    editable,
    wins,
    finished,
    own: true
  };
}
