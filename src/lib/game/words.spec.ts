import { describe, expect, it } from 'vitest';
import { FULL_TEXT, STORAGE_TEXT, defaultSaveName, playedText, syncText } from './words';

const cps = (s: string) => Array.from(s).length;

describe('syncText', () => {
  it('words each state, null when saved', () => {
    expect(syncText('local')).toBe('On this device only');
    expect(syncText('saving')).toBe('Saving');
    expect(syncText('offline')).toBe('Offline');
    expect(syncText('sign-in')).toBe('Sign in to save');
    expect(syncText('full')).toBe('Account full. Delete a saved game.');
    expect(syncText('saved')).toBeNull();
  });
});

describe('playedText', () => {
  const now = new Date(2026, 2, 4, 12);
  it('says Today and Yesterday by calendar date', () => {
    expect(playedText(new Date(2026, 2, 4, 1).toISOString(), now)).toBe('Today');
    expect(playedText(new Date(2026, 2, 3, 23).toISOString(), now)).toBe('Yesterday');
  });
  it('gives the day and month, with the year when it is not this one', () => {
    expect(playedText(new Date(2026, 0, 15).toISOString(), now)).toBe('15 Jan');
    expect(playedText(new Date(2025, 2, 4).toISOString(), now)).toBe('4 Mar 2025');
  });
  it('words a save stamped tomorrow as a date', () => {
    expect(playedText(new Date(2026, 2, 5).toISOString(), now)).toBe('5 Mar');
  });
});

describe('fixed texts', () => {
  it('are today words', () => {
    expect(FULL_TEXT).toBe('12 saved games. Delete one first.');
    expect(STORAGE_TEXT).toBe('This browser refused to save.');
  });
});

describe('defaultSaveName', () => {
  const at = new Date(2026, 2, 4);
  it('numbers a new game past taken names', () => {
    expect(defaultSaveName({ kind: 'new', at }, [])).toBe('Game, 4 Mar');
    expect(defaultSaveName({ kind: 'new', at }, ['Game, 4 Mar'])).toBe('Game, 4 Mar (2)');
    expect(defaultSaveName({ kind: 'new', at }, ['Game, 4 Mar', 'Game, 4 Mar (2)'])).toBe(
      'Game, 4 Mar (3)'
    );
  });
  it('names a conflict by device', () => {
    expect(defaultSaveName({ kind: 'conflict', name: 'Home' }, [])).toBe('Home (this device)');
  });
  it('cuts to 60 code points, leaving room for the suffix', () => {
    const name = 'x'.repeat(60);
    const first = defaultSaveName({ kind: 'conflict', name }, []);
    expect(cps(first)).toBe(60);
    expect(first.endsWith('x')).toBe(true);
    const second = defaultSaveName({ kind: 'conflict', name }, [first]);
    expect(second).toBe(`${'x'.repeat(56)} (2)`);
    expect(cps(second)).toBe(60);
  });
});
