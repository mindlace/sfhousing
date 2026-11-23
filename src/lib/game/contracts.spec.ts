import { describe, expect, it } from 'vitest';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import {
  ALL_ALLOWED,
  allowedAt,
  isGiven,
  levelNeeded,
  needsHigher,
  playable,
  runs,
  simLocked,
  unlocksAt
} from './allowed';
import { barText, lockedLane, unlockText } from './copy';
import { LAST_LEVEL, beats, paintWon } from './levels';
import { NEW_GAME, barOf, levelUp, roundComplete } from './progress';
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
import { standing } from './standing';

const GIVEN: Policy = {
  id: 'p1',
  label: 'Housing bond',
  preset: 'bond-2024',
  on: true,
  where: { tag: 'fund', pool: 'bond' },
  spans: [{ from: 20736, to: null, what: { tag: 'fund', pool: null, programmes: [] } }]
};
const EMPTY: SimPolicy4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } };
const SAVE: GameSave = {
  v: 1,
  id: 'abc',
  name: 'Game, 22 Nov',
  nameIsDefault: true,
  progress: NEW_GAME,
  plan: null,
  policy: null,
  savedAt: '2026-11-22T12:00:00.000Z'
};

const NI = /^not implemented$/;

describe('constants', () => {
  it('LAST_LEVEL is 5', () => {
    expect(LAST_LEVEL).toBe(5);
  });
  it('NEW_GAME is level 1 with nothing banked', () => {
    expect(NEW_GAME).toEqual({ v: 1, level: 1, banked: {}, firstWinAt: null });
  });
  it('the storage keys', () => {
    expect(SAVES_KEY).toBe('sfhousing:saves:v1');
    expect(saveKey('abc')).toBe('sfhousing:save:abc');
  });
  it('the limits', () => {
    expect(MAX_SAVES).toBe(12);
    expect(SAVE_NAME_MAX).toBe(60);
    expect(MAX_SAVE_BYTES).toBe(600_000);
  });
  it('ALL_ALLOWED has the three kinds and all money', () => {
    expect([...ALL_ALLOWED.kinds].sort()).toEqual(['money', 'permitting', 'zoning']);
    expect(ALL_ALLOWED.money).toBe('all');
  });
});

describe('the stubs throw not implemented', () => {
  it('beats', () =>
    expect(() => beats({ kind: 'reached', on: 20736 }, { on: 35337 })).toThrowError(NI));
  it('paintWon', () => expect(() => paintWon(100, 82069)).toThrowError(NI));
  it('barOf', () => expect(() => barOf(NEW_GAME)).toThrowError(NI));
  it('roundComplete', () => expect(() => roundComplete(NEW_GAME)).toThrowError(NI));
  it('levelUp', () => expect(() => levelUp(NEW_GAME, null)).toThrowError(NI));
  it('parseGameSave', () => expect(() => parseGameSave(SAVE)).toThrowError(NI));
  it('defaultSaveName', () =>
    expect(() =>
      defaultSaveName({ kind: 'new', at: new Date('2026-11-22T12:00:00Z') }, [])
    ).toThrowError(NI));
  it('allowedAt', () => expect(() => allowedAt(3)).toThrowError(NI));
  it('unlocksAt', () => expect(() => unlocksAt('permitting')).toThrowError(NI));
  it('isGiven', () => expect(() => isGiven(GIVEN)).toThrowError(NI));
  it('runs', () => expect(() => runs('money', GIVEN, ALL_ALLOWED)).toThrowError(NI));
  it('playable', () => expect(() => playable(EMPTY, ALL_ALLOWED)).toThrowError(NI));
  it('levelNeeded', () => expect(() => levelNeeded(EMPTY)).toThrowError(NI));
  it('simLocked', () => expect(() => simLocked(NEW_GAME)).toThrowError(NI));
  it('needsHigher', () => expect(() => needsHigher(EMPTY, NEW_GAME)).toThrowError(NI));
  it('standing', () =>
    expect(() => standing(2, null, { kind: 'reached', on: 20736 })).toThrowError(NI));
  it('barText', () => expect(() => barText({ on: 35337 })).toThrowError(NI));
  it('unlockText', () => expect(() => unlockText(3)).toThrowError(NI));
  it('lockedLane', () => expect(() => lockedLane('zoning', 3)).toThrowError(NI));
});
