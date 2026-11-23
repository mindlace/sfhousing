import { isValidId } from '../ids/base58';
import type { Level } from './levels';
import type { Banked, Progress } from './progress';

export interface GameSave {
  v: 1;
  /** `newId()` of `$lib/ids/base58`. */
  id: string;
  name: string;
  /** True until the player types a name. */
  nameIsDefault: boolean;
  progress: Progress;
  /** The plan record's text as `sfhousing:plan:v1` holds it, or null. */
  plan: string | null;
  /** The policy record's text as `sfhousing:sim:v2` holds it, or null. */
  policy: string | null;
  /** ISO time of the last change. */
  savedAt: string;
}

/** What the list shows of a saved game. */
export type SaveEntry = Pick<GameSave, 'id' | 'name' | 'nameIsDefault' | 'savedAt'> & {
  level: Level;
};

export const SAVES_KEY = 'sfhousing:saves:v1';
export const saveKey = (id: string): string => `sfhousing:save:${id}`;
export const MAX_SAVES = 12;
export const SAVE_NAME_MAX = 60;

export const SHORT_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** `LAST_LEVEL` of levels.ts, repeated so this file's only value import is base58. */
const LAST_LEVEL = 5;

type Plain = Record<string, unknown>;

function isPlain(x: unknown): x is Plain {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isTime(x: unknown): x is string {
  return typeof x === 'string' && Number.isFinite(Date.parse(x));
}

function parseBanked(x: unknown): Banked | null {
  if (!isPlain(x)) return null;
  const { on, datasetVersion, at } = x;
  if (typeof on !== 'number' || !Number.isInteger(on) || on < 0) return null;
  if (typeof datasetVersion !== 'string' || datasetVersion === '') return null;
  if (!isTime(at)) return null;
  return { on, datasetVersion, at };
}

function parseProgress(x: unknown): Progress | null {
  if (!isPlain(x) || x.v !== 1) return null;
  const level = x.level;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > LAST_LEVEL) {
    return null;
  }
  const firstWinAt = x.firstWinAt;
  if (firstWinAt !== null && !isTime(firstWinAt)) return null;
  if (!isPlain(x.banked)) return null;
  const raw = x.banked;
  const allowed = new Set<string>();
  for (let n = 2; n < level; n++) allowed.add(String(n));
  if (level === LAST_LEVEL) allowed.add('5');
  const keys = Object.keys(raw);
  for (let n = 2; n < level; n++) if (!keys.includes(String(n))) return null;
  const banked: Progress['banked'] = {};
  for (const k of keys) {
    if (!allowed.has(k)) return null;
    const b = parseBanked(raw[k]);
    if (!b) return null;
    banked[Number(k) as 2 | 3 | 4 | 5] = b;
  }
  return { v: 1, level: level as Level, banked, firstWinAt };
}

export function parseGameSave(json: unknown): GameSave | null {
  if (!isPlain(json) || json.v !== 1) return null;
  const { id, name, nameIsDefault, savedAt, plan, policy } = json;
  if (typeof id !== 'string' || !isValidId(id)) return null;
  if (typeof name !== 'string' || name !== name.trim()) return null;
  const length = Array.from(name).length;
  if (length < 1 || length > SAVE_NAME_MAX) return null;
  if (typeof nameIsDefault !== 'boolean') return null;
  if (!isTime(savedAt)) return null;
  if (plan !== null && typeof plan !== 'string') return null;
  if (policy !== null && typeof policy !== 'string') return null;
  const progress = parseProgress(json.progress);
  if (!progress) return null;
  return { v: 1, id, name, nameIsDefault, progress, plan, policy, savedAt };
}

type DefaultFrom =
  { kind: 'new'; at: Date } | { kind: 'remix'; title: string } | { kind: 'conflict'; name: string };

function base(from: DefaultFrom): string {
  if (from.kind === 'new') return `Game, ${from.at.getDate()} ${SHORT_MONTHS[from.at.getMonth()]}`;
  if (from.kind === 'remix') {
    const t = from.title.trim();
    return t === '' ? 'Remix' : `Remix of ${t}`;
  }
  return `${from.name} (this device)`;
}

/** At most `max` code points, trailing white space removed after a cut. */
function fit(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join('').trimEnd();
}

export function defaultSaveName(from: DefaultFrom, taken: readonly string[]): string {
  const b = base(from);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : ` (${n})`;
    const candidate = fit(b, SAVE_NAME_MAX - suffix.length) + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}
