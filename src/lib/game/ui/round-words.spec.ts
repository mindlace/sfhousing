// The pinned goal's words in each state of a round.
import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import type { Verdict } from '../rounds';
import { compactCount, pinnedWords, roundName, type PinnedCtx } from './round-words';

const d = (y: number, m: number) => dayFromUtc(y, m, 1);
const c: PinnedCtx = {
  amount: 82069,
  target: d(2060, 6),
  legal: d(2066, 10),
  round: 2,
  finished: false,
  next: 3
};
const pending: Verdict = { tag: 'pending' };
const win = (goalMonth: number | null): Verdict => ({ tag: 'win', goalMonth });
const late = (goalMonth: number | null): Verdict => ({ tag: 'late', goalMonth });

describe('pinnedWords', () => {
  it('pending', () => {
    const w = pinnedWords(pending, c);
    expect(w.line1).toBe('82,069 homes before Jun 2060');
    expect(w.line2).toBe('Beat it: 3 new policies');
    expect(w.phone).toEqual({
      count: '82,069',
      short: '82k',
      homes: ' homes',
      rest: 'before Jun 2060',
      result: ''
    });
    expect(w.live).toBeNull();
    expect(w.gift).toBeNull();
  });

  it('pending with no target, in the last round, finished and with one policy next', () => {
    const r0 = pinnedWords(pending, { ...c, target: null, round: 0 });
    expect(r0.line1).toBe('82,069 homes by Oct 2066');
    expect(r0.line2).toBe('Play to see current law');
    expect(pinnedWords(pending, { ...c, round: 4, next: 0 }).line2).toBe('Beat it: every policy');
    expect(pinnedWords(pending, { ...c, finished: true }).line2).toBe('Beat your best');
    expect(pinnedWords(pending, { ...c, next: 1 }).line2).toBe('Beat it: 1 new policy');
  });

  it('win', () => {
    const w = pinnedWords(win(d(2058, 3)), c);
    expect(w.line1).toBe('82,069 homes by Mar 2058');
    expect(w.line2).toBe('2 yr 3 mo early');
    expect(w.phone).toEqual({
      count: '82,069',
      short: '82k',
      homes: '',
      rest: 'by Mar 2058',
      result: '2 yr 3 mo early'
    });
    expect(w.gift).toBe('Open the gift: 3 new policies');
    expect(w.live).toBe(
      '82,069 homes by Mar 2058, 2 yr 3 mo early. Open the gift: 3 new policies.'
    );
  });

  it('win in round 0, with null months, in the last round and finished', () => {
    const r0 = { ...c, target: null, round: 0 };
    const w = pinnedWords(win(d(2061, 10)), r0);
    expect(w.line1).toBe('82,069 homes by Oct 2061');
    expect(w.line2).toBe('Current law');
    expect(w.phone.rest).toBe('by Oct 2061');
    expect(w.phone.result).toBe('Current law');
    const n = pinnedWords(win(null), r0);
    expect(n.line1).toBe('82,069 homes after Oct 2066');
    expect(n.line2).toBe('Current law');
    expect(pinnedWords(win(d(2058, 3)), { ...c, round: 4, next: 0 }).gift).toBe(
      'Open the gift: every policy'
    );
    expect(pinnedWords(win(d(2058, 3)), { ...c, finished: true }).gift).toBe('Keep this date');
  });

  it('late', () => {
    const w = pinnedWords(late(d(2062, 6)), c);
    expect(w.line1).toBe('82,069 homes by Jun 2062');
    expect(w.line2).toBe('2 years late');
    expect(w.phone.rest).toBe('by Jun 2062');
    expect(w.phone.result).toBe('2 years late');
    expect(w.gift).toBeNull();
    expect(w.live).toBe('82,069 homes by Jun 2062, 2 years late.');
    expect(pinnedWords(late(d(2060, 6)), c).line2).toBe('Not earlier');
    const n = pinnedWords(late(null), c);
    expect(n.line1).toBe('82,069 homes after Oct 2066');
    expect(n.line2).toBe('Late');
  });
});

describe('roundName and compactCount', () => {
  it('names a round', () => {
    expect(roundName(0, false)).toBe('Current law');
    expect(roundName(2, false)).toBe('Round 2');
    expect(roundName(4, true)).toBe('Every policy');
  });

  it('compacts a count', () => {
    expect(compactCount(82069)).toBe('82k');
  });
});
