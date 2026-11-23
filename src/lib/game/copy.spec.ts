import { describe, expect, it } from 'vitest';

import { dayFromUtc } from '$lib/fzp/time';
import type { PolicyKind } from '$lib/timeline/policy4';
import {
  FULL_TEXT,
  STORAGE_TEXT,
  aimText,
  barText,
  levelText,
  lockedLane,
  nextText,
  playedText,
  syncText,
  unlockText
} from './copy';
import type { Level } from './levels';
import type { Banked, Progress } from './progress';
import type { SyncState } from './save-sync.svelte';

const LEVELS: Level[] = [1, 2, 3, 4, 5];
const UP = 'Unlocks when you level up';

function banked(y: number, m: number): Banked {
  return { on: dayFromUtc(y, m, 1), datasetVersion: 'fixture-0', at: '2026-01-01T00:00:00.000Z' };
}

function at(level: Level, b: Progress['banked'] = {}): Progress {
  return { v: 1, level, banked: b, firstWinAt: null };
}

describe('barText', () => {
  it('names the month to beat', () => {
    expect(barText({ on: dayFromUtc(2057, 6, 1) })).toBe('Beat Jun 2057');
  });
});

describe('unlockText', () => {
  it('names what each level unlocks', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => unlockText(n as Level | 6))).toEqual([
      'Paint',
      'The simulation',
      'Permitting',
      'Zoning',
      'Public money',
      'The end of the round'
    ]);
  });
});

describe('lockedLane', () => {
  const table: Record<PolicyKind, string[]> = {
    permitting: ['Unlocks at level 3', UP, '', '', ''],
    zoning: ['Unlocks at level 4', 'Unlocks at level 4', UP, '', ''],
    money: ['Unlocks at level 5', 'Unlocks at level 5', 'Unlocks at level 5', UP, '']
  };
  for (const kind of Object.keys(table) as PolicyKind[]) {
    it(`${kind} at each level`, () => {
      expect(LEVELS.map((l) => lockedLane(kind, l))).toEqual(table[kind]);
    });
  }
});

describe('levelText', () => {
  it('reads Level N', () => {
    expect(levelText(3)).toBe('Level 3');
  });
});

describe('aimText', () => {
  it('level 1 and 2', () => {
    expect(aimText(at(1))).toBe('Paint room for the goal');
    expect(aimText(at(2))).toBe('Play to the goal');
  });
  it('levels 3 to 5 with a bar', () => {
    expect(aimText(at(3, { 2: banked(2057, 6) }))).toBe('Beat Jun 2057');
    expect(aimText(at(5, { 4: banked(2050, 3) }))).toBe('Beat Mar 2050');
  });
  it('without a bar', () => {
    expect(aimText(at(4, {}))).toBe('Play to the goal');
  });
  it('a complete round', () => {
    expect(aimText(at(5, { 4: banked(2050, 3), 5: banked(2049, 3) }))).toBe('Round complete');
  });
});

describe('nextText', () => {
  it('names the next unlock at levels 1 to 5', () => {
    expect(LEVELS.map((l) => nextText(at(l)))).toEqual([
      'Next: The simulation',
      'Next: Permitting',
      'Next: Zoning',
      'Next: Public money',
      'Next: The end of the round'
    ]);
  });
  it('a complete round', () => {
    expect(nextText(at(5, { 4: banked(2050, 3), 5: banked(2049, 3) }))).toBe(
      'Coming next: designing funding, market rules and affordability targets'
    );
  });
});

describe('syncText', () => {
  it('words each state', () => {
    const states: SyncState[] = ['local', 'saving', 'offline', 'sign-in', 'full', 'saved'];
    expect(states.map(syncText)).toEqual([
      'On this device only',
      'Saving',
      'Offline',
      'Sign in to save',
      'Account full. Delete a saved game.',
      null
    ]);
  });
});

describe('playedText', () => {
  const now = new Date(2026, 2, 10, 12);
  const iso = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).toISOString();
  it('today', () => {
    expect(playedText(iso(2026, 2, 10, 8), now)).toBe('Today');
  });
  it('yesterday', () => {
    expect(playedText(iso(2026, 2, 9, 23), now)).toBe('Yesterday');
  });
  it('this year', () => {
    expect(playedText(iso(2026, 2, 4, 12), now)).toBe('4 Mar');
  });
  it('another year', () => {
    expect(playedText(iso(2025, 2, 4, 12), now)).toBe('4 Mar 2025');
  });
  it('yesterday across New Year', () => {
    expect(playedText(iso(2026, 11, 31, 20), new Date(2027, 0, 1, 9))).toBe('Yesterday');
  });
});

describe('constants', () => {
  it('full and storage', () => {
    expect(FULL_TEXT).toBe('12 saved games. Delete one first.');
    expect(STORAGE_TEXT).toBe('This browser refused to save.');
  });
});
