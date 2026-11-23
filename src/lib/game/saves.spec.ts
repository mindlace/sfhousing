import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids/base58';
import { E2E_GAME_KEY, E2E_GOAL_KEY } from './e2e';
import type { Level } from './levels';
import { MAX_SAVE_BYTES } from './save-api';
import {
  MAX_SAVES,
  SAVES_KEY,
  SAVE_NAME_MAX,
  defaultSaveName,
  parseGameSave,
  saveKey,
  type GameSave
} from './saves';

const AT = '2026-11-22T12:00:00.000Z';

function banksFor(level: Level): GameSave['progress']['banked'] {
  const banked: Record<number, { on: number; datasetVersion: string; at: string }> = {};
  for (let n = 2; n < level; n++) banked[n] = { on: 35337, datasetVersion: 'fixture-0', at: AT };
  return banked;
}

const valid = (level: Level = 3): GameSave => ({
  v: 1,
  id: newId(),
  name: 'Game, 22 Nov',
  nameIsDefault: true,
  progress: { v: 1, level, banked: banksFor(level), firstWinAt: null },
  plan: '{"v":1}',
  policy: null,
  savedAt: AT
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests write bad shapes in
type Loose = Record<string, any>;

/** A deep copy of a valid save that a test can poke at. */
function poke(level: Level = 3): Loose {
  return JSON.parse(JSON.stringify(valid(level)));
}

describe('constants', () => {
  it('the storage keys and limits', () => {
    expect(SAVES_KEY).toBe('sfhousing:saves:v1');
    expect(saveKey('abc')).toBe('sfhousing:save:abc');
    expect(saveKey('x')).toBe('sfhousing:save:x');
    expect(MAX_SAVES).toBe(12);
    expect(SAVE_NAME_MAX).toBe(60);
    expect(MAX_SAVE_BYTES).toBe(600_000);
  });
  it('the e2e keys', () => {
    expect(E2E_GAME_KEY).toBe('sfhousing:e2e:game');
    expect(E2E_GOAL_KEY).toBe('sfhousing:e2e:goal');
  });
});

describe('parseGameSave', () => {
  it.each([1, 2, 3, 4, 5] as Level[])('accepts a valid save at level %i', (level) => {
    const s = valid(level);
    expect(parseGameSave(s)).toEqual(s);
  });

  it('accepts level 5 with banked[5]', () => {
    const s = valid(5);
    s.progress.banked[5] = { on: 30000, datasetVersion: 'fixture-0', at: AT };
    expect(parseGameSave(s)).toEqual(s);
  });

  it('accepts a firstWinAt time', () => {
    const s = valid(2);
    s.progress.firstWinAt = AT;
    expect(parseGameSave(s)).toEqual(s);
  });

  it('drops unknown fields at every depth', () => {
    const s = poke(3);
    s.extra = 1;
    s.progress.extra = 2;
    s.progress.banked[2].extra = 3;
    const out = parseGameSave(s);
    expect(out).toEqual(valid3From(s));
    expect(out).not.toBe(s);
    expect(JSON.stringify(out)).not.toContain('extra');
  });

  function valid3From(s: Loose): GameSave {
    const copy = JSON.parse(JSON.stringify(s));
    delete copy.extra;
    delete copy.progress.extra;
    delete copy.progress.banked[2].extra;
    return copy;
  }

  const refused: [string, (s: Loose) => void][] = [
    ['v 2', (s) => (s.v = 2)],
    ['a bad id', (s) => (s.id = 'abc')],
    ['a name with leading space', (s) => (s.name = ' Game')],
    ['a name with trailing space', (s) => (s.name = 'Game ')],
    ['an empty name', (s) => (s.name = '')],
    ['a name of 61 code points', (s) => (s.name = '🏠'.repeat(61))],
    ['level 6', (s) => (s.progress.level = 6)],
    ['level 0', (s) => (s.progress.level = 0)],
    ['a fractional level', (s) => (s.progress.level = 2.5)],
    ['level 3 with banked empty', (s) => (s.progress.banked = {})],
    [
      'level 3 with banked 2 and 3',
      (s) => (s.progress.banked[3] = { on: 1, datasetVersion: 'd', at: AT })
    ],
    ['on 1.5', (s) => (s.progress.banked[2].on = 1.5)],
    ['on -1', (s) => (s.progress.banked[2].on = -1)],
    ['an empty datasetVersion', (s) => (s.progress.banked[2].datasetVersion = '')],
    ['a bad banked at', (s) => (s.progress.banked[2].at = 'later')],
    ['a bad savedAt', (s) => (s.savedAt = 'later')],
    ['a numeric plan', (s) => (s.plan = 5)],
    ['a numeric policy', (s) => (s.policy = 5)],
    ['a string nameIsDefault', (s) => (s.nameIsDefault = 'yes')],
    ['a bad firstWinAt', (s) => (s.progress.firstWinAt = 'never')],
    ['a progress v of 2', (s) => (s.progress.v = 2)],
    ['an array progress', (s) => (s.progress = [])]
  ];
  it.each(refused)('refuses %s', (_name, change) => {
    const s = poke(3);
    change(s);
    expect(parseGameSave(s)).toBeNull();
  });

  it('refuses banked 5 below level 5', () => {
    const s = poke(4);
    s.progress.banked[5] = { on: 1, datasetVersion: 'd', at: AT };
    expect(parseGameSave(s)).toBeNull();
  });

  it('refuses an array and null and primitives', () => {
    expect(parseGameSave([])).toBeNull();
    expect(parseGameSave(null)).toBeNull();
    expect(parseGameSave('x')).toBeNull();
    expect(parseGameSave(undefined)).toBeNull();
  });

  it('accepts 60 code points of emoji', () => {
    const s = valid(1);
    s.name = '🏠'.repeat(60);
    expect(parseGameSave(s)).toEqual(s);
  });
});

describe('defaultSaveName', () => {
  const at = new Date(2026, 10, 22, 12);
  const base = 'Game, 22 Nov';

  it('names a new game by its local date', () => {
    expect(defaultSaveName({ kind: 'new', at }, [])).toBe(base);
    expect(defaultSaveName({ kind: 'new', at }, [base])).toBe(`${base} (2)`);
    expect(defaultSaveName({ kind: 'new', at }, [base, `${base} (2)`])).toBe(`${base} (3)`);
    expect(defaultSaveName({ kind: 'new', at: new Date(2026, 1, 3, 12) }, [])).toBe('Game, 3 Feb');
  });

  it('names a remix and a conflict', () => {
    expect(defaultSaveName({ kind: 'remix', title: 'Transit first' }, [])).toBe(
      'Remix of Transit first'
    );
    expect(defaultSaveName({ kind: 'remix', title: '  ' }, [])).toBe('Remix');
    expect(defaultSaveName({ kind: 'conflict', name: base }, [])).toBe(`${base} (this device)`);
  });

  it('cuts a long title to 60 code points', () => {
    const title = 'x'.repeat(70);
    const first = 'Remix of ' + 'x'.repeat(51);
    expect(defaultSaveName({ kind: 'remix', title }, [])).toBe(first);
    expect(defaultSaveName({ kind: 'remix', title }, [first])).toBe(
      'Remix of ' + 'x'.repeat(47) + ' (2)'
    );
  });

  it('trims a cut that ends in a space', () => {
    const title = 'a'.repeat(50) + ' ' + 'b'.repeat(20);
    expect(defaultSaveName({ kind: 'remix', title }, [])).toBe('Remix of ' + 'a'.repeat(50));
  });

  it('cuts a title of emoji on a code point boundary', () => {
    const r = defaultSaveName({ kind: 'remix', title: '🏠'.repeat(70) }, []);
    expect(Array.from(r)).toHaveLength(60);
    expect(r).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe('saves.ts as Playwright loads it', () => {
  it('has no $lib import and one value import', () => {
    const text = readFileSync(new URL('./saves.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/from '\$lib\//);
    const imports = [...text.matchAll(/^import (?!type\b)[^;]*? from '([^']+)';/gms)].map(
      (m) => m[1]
    );
    expect(imports).toEqual(['../ids/base58']);
  });
});
