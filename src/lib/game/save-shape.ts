// G1: the saved game and its parser. Value imports are relative; $lib only as types.
import type { Stage } from '$lib/timelapse/types';
import { isValidId } from '../ids/base58';
import type { RunResult } from './run-result';
import { SAVE_NAME_MAX } from './saves';
import { UNIT_KINDS, type GameState, type MetRung, type Units } from './state';

export interface GameSave {
  v: 2;
  id: string;
  name: string;
  nameIsDefault: boolean;
  state: GameState;
  plan: string | null;
  policy: string | null;
  savedAt: string;
}

export type SaveEntry = Pick<GameSave, 'id' | 'name' | 'nameIsDefault' | 'savedAt'> &
  Pick<GameState, 'phase' | 'rung'>;

type Plain = Record<string, unknown>;
const isPlain = (x: unknown): x is Plain =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isTime = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x));
const isWhole = (x: unknown, min: number): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= min;
const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const OPEN_STAGES = [
  'preApplication',
  'filed',
  'entitled',
  'permitFiled',
  'permitIssued',
  'construction'
] as const satisfies readonly Exclude<Stage, 'complete'>[];

/** Every value a whole number of 0 or more; only UNIT_KINDS kept. */
function parseUnits(x: unknown): Units | null {
  if (!isPlain(x)) return null;
  for (const v of Object.values(x)) if (!isWhole(v, 0)) return null;
  const out: Units = {};
  for (const k of UNIT_KINDS) if (Object.hasOwn(x, k)) out[k] = x[k] as number;
  return out;
}

function parseMet(x: unknown): MetRung | null {
  if (!isPlain(x)) return null;
  const { rung, reachedOn, datasetVersion, at } = x;
  if (!isWhole(rung, 0) || !isWhole(reachedOn, 0)) return null;
  if (!isText(datasetVersion) || !isTime(at)) return null;
  return { rung, reachedOn, datasetVersion, at };
}

export function parseRunResult(x: unknown): RunResult | null {
  if (!isPlain(x)) return null;
  const { rung, amount, datasetVersion, at, homes, reachedOn, waitingMoney } = x;
  if (!isWhole(rung, 0) || !isWhole(amount, 1)) return null;
  if (!isText(datasetVersion) || !isTime(at)) return null;
  if (!isNum(homes)) return null;
  if (reachedOn !== null && !isWhole(reachedOn, 0)) return null;
  if (waitingMoney !== null && !isNum(waitingMoney)) return null;
  if (!isPlain(x.stages)) return null;
  const stages = {} as RunResult['stages'];
  for (const s of OPEN_STAGES) {
    const v = x.stages[s];
    if (!isNum(v)) return null;
    stages[s] = v;
  }
  const dropped = parseUnits(x.dropped);
  const collected = parseUnits(x.collected);
  if (!dropped || !collected) return null;
  let lump: Units | null = null;
  if (x.lump !== null) {
    lump = parseUnits(x.lump);
    if (!lump) return null;
  }
  if (!Array.isArray(x.side)) return null;
  const side: RunResult['side'] = [];
  for (const e of x.side) {
    if (!isPlain(e) || !isText(e.id)) return null;
    const reward = parseUnits(e.reward);
    if (!reward) return null;
    side.push({ id: e.id, reward });
  }
  return {
    rung,
    amount,
    datasetVersion,
    at,
    homes,
    reachedOn,
    stages,
    waitingMoney,
    dropped,
    collected,
    lump,
    side
  };
}

export function parseGameState(x: unknown): GameState | null {
  // 1. A plain object at version 2 (P15).
  if (!isPlain(x) || x.v !== 2) return null;
  const { phase, firstWinAt, rung, runs } = x;
  // 2. The phase.
  if (phase !== 'opening' && phase !== 'runs') return null;
  // 3. The first win: null or a time.
  if (firstWinAt !== null && !isTime(firstWinAt)) return null;
  // 4. Bought: a plain object of whole numbers of 1 or more.
  if (!isPlain(x.bought)) return null;
  for (const v of Object.values(x.bought)) if (!isWhole(v, 1)) return null;
  // 5. Units.
  const units = parseUnits(x.units);
  if (!units) return null;
  // 6. The rung in play.
  if (!isWhole(rung, 0)) return null;
  // 7. Met rungs: each valid, strictly ascending by rung.
  if (!Array.isArray(x.met)) return null;
  const met: MetRung[] = [];
  for (const e of x.met) {
    const m = parseMet(e);
    if (!m || (met.length > 0 && m.rung <= met[met.length - 1].rung)) return null;
    met.push(m);
  }
  // 8. Side goals met: a plain object of times.
  if (!isPlain(x.side)) return null;
  for (const v of Object.values(x.side)) if (!isTime(v)) return null;
  // 9. Runs.
  if (!isWhole(runs, 0)) return null;
  // 10. The last result: null or a valid result.
  let last: RunResult | null = null;
  if (x.last !== null) {
    last = parseRunResult(x.last);
    if (!last) return null;
  }
  // 11. The phase agrees with the rest.
  if (phase === 'runs' && firstWinAt === null) return null;
  if (phase === 'opening' && (runs !== 0 || rung !== 0 || met.length > 0 || last !== null)) {
    return null;
  }
  // 12. Rebuilt from the known fields.
  return {
    v: 2,
    phase,
    firstWinAt,
    bought: { ...(x.bought as Record<string, number>) },
    units,
    rung,
    met,
    side: { ...(x.side as Record<string, string>) },
    runs,
    last
  };
}

export function parseGameSave(json: unknown): GameSave | null {
  if (!isPlain(json) || json.v !== 2) return null;
  const { id, name, nameIsDefault, savedAt, plan, policy } = json;
  if (typeof id !== 'string' || !isValidId(id)) return null;
  if (typeof name !== 'string' || name !== name.trim()) return null;
  const length = Array.from(name).length;
  if (length < 1 || length > SAVE_NAME_MAX) return null;
  if (typeof nameIsDefault !== 'boolean') return null;
  if (!isTime(savedAt)) return null;
  if (plan !== null && typeof plan !== 'string') return null;
  if (policy !== null && typeof policy !== 'string') return null;
  const state = parseGameState(json.state);
  if (!state) return null;
  return { v: 2, id, name, nameIsDefault, state, plan, policy, savedAt };
}
