// The result rule: pending, win or late against the target, from what has been seen.
import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';
import { POLICY_KEYS, ROUNDS } from './catalogue/rounds';
import { fitState, judge, monthsBetween, spanText, takeWin, type Seen } from './rounds';
import { NEW_GAME, type GameState } from './state';

const d = (y: number, m: number) => dayFromUtc(y, m, 1);
const base: Seen = {
  target: d(2060, 6),
  round: 2,
  goalMonth: d(2058, 3),
  whole: true,
  seenFrom: d(2026, 11),
  seen: d(2058, 3),
  lastDay: d(2066, 10),
  current: true
};
const of = (o: Partial<Seen>) => judge({ ...base, ...o });

describe('judge', () => {
  it('a goal month before the target, seen, is a win', () => {
    expect(of({})).toEqual({ tag: 'win', goalMonth: d(2058, 3) });
  });

  it('is pending until the goal month is seen, and while not current', () => {
    expect(of({ seen: d(2058, 2) })).toEqual({ tag: 'pending' });
    expect(of({ current: false })).toEqual({ tag: 'pending' });
  });

  it('a goal month equal to the target is late once seen', () => {
    expect(of({ goalMonth: d(2060, 6), seen: d(2060, 6) })).toEqual({
      tag: 'late',
      goalMonth: d(2060, 6)
    });
    expect(of({ goalMonth: d(2060, 6), seen: d(2060, 5) })).toEqual({ tag: 'pending' });
  });

  it('a goal month after the target is late with that month', () => {
    expect(of({ goalMonth: d(2062, 6), seen: d(2060, 6) })).toEqual({
      tag: 'late',
      goalMonth: d(2062, 6)
    });
  });

  it('no goal month: pending while filling, late once whole', () => {
    expect(of({ goalMonth: null, whole: false, seen: d(2060, 7) })).toEqual({ tag: 'pending' });
    expect(of({ goalMonth: null, whole: true, seen: d(2060, 7) })).toEqual({
      tag: 'late',
      goalMonth: null
    });
  });

  it('round 0 with no target: any goal month wins; none wins with null at the end', () => {
    const r0 = { target: null, round: 0 };
    expect(of({ ...r0, goalMonth: d(2061, 10), seen: d(2061, 10) })).toEqual({
      tag: 'win',
      goalMonth: d(2061, 10)
    });
    expect(of({ ...r0, goalMonth: null, whole: true, seen: base.lastDay })).toEqual({
      tag: 'win',
      goalMonth: null
    });
  });

  it('round 1 with no target and no goal month is late with null', () => {
    expect(
      of({ target: null, round: 1, goalMonth: null, whole: true, seen: base.lastDay })
    ).toEqual({ tag: 'late', goalMonth: null });
  });

  it('a reset that jumped over the goal month leaves it unseen', () => {
    const far = { seen: d(2066, 10) };
    expect(of({ ...far, seenFrom: d(2059, 1) })).toEqual({ tag: 'pending' });
    expect(of({ ...far, seenFrom: d(2058, 3) })).toEqual({ tag: 'win', goalMonth: d(2058, 3) });
    expect(of({ ...far, seenFrom: d(2058, 4) })).toEqual({ tag: 'pending' });
    const after = { goalMonth: d(2062, 6), ...far };
    expect(of({ ...after, seenFrom: d(2061, 1) })).toEqual({ tag: 'pending' });
    expect(of({ ...after, seenFrom: d(2060, 6) })).toEqual({ tag: 'late', goalMonth: d(2062, 6) });
  });
});

describe('monthsBetween and spanText', () => {
  it('counts calendar months', () => {
    expect(monthsBetween(d(2058, 3), d(2060, 6))).toBe(27);
    expect(monthsBetween(d(2060, 6), d(2058, 3))).toBe(-27);
  });

  it('words a span of months', () => {
    expect([27, 24, 12, 13, 5, 1].map(spanText)).toEqual([
      '2 yr 3 mo',
      '2 years',
      '1 year',
      '1 yr 1 mo',
      '5 months',
      '1 month'
    ]);
  });
});

const AT = '2026-11-26T00:00:00.000Z';
const runs = (o: Partial<GameState>): GameState => ({
  ...NEW_GAME,
  phase: 'runs',
  firstWinAt: AT,
  ...o
});
const win = (goalMonth: Day | null, on: string[] = []) => ({
  goalMonth,
  on: new Set(on),
  datasetVersion: 'fixture-0',
  at: AT
});

describe('takeWin', () => {
  it('from round 0 with a goal month: round 1, the target set, one win beating nothing', () => {
    const r = takeWin(runs({ round: 0 }), win(d(2061, 4)));
    expect(r).toMatchObject({ round: 1, target: d(2061, 4), finished: false, editable: [] });
    expect(r.wins).toEqual([
      { round: 0, goalMonth: d(2061, 4), beat: null, at: AT, datasetVersion: 'fixture-0' }
    ]);
  });

  it('the policies on that are offered become editable; one not offered does not', () => {
    const s = runs({ round: 2, target: d(2060, 6), editable: ['transit-rail'] });
    const r = takeWin(s, win(d(2058, 3), ['transit-rail', 'transit-metro', 'transit-bus']));
    expect(r.editable).toEqual(['transit-metro', 'transit-rail']);
    expect(r).toMatchObject({ round: 3, target: d(2058, 3) });
    expect(r.wins[0]).toMatchObject({ round: 2, beat: d(2060, 6) });
  });

  it('from round 4: finished with every key editable', () => {
    const r = takeWin(runs({ round: ROUNDS, target: d(2050, 1) }), win(d(2045, 1)));
    expect(r.round).toBe(ROUNDS);
    expect(r.finished).toBe(true);
    expect(r.editable).toEqual([...POLICY_KEYS].sort());
  });

  it('already finished: the target and the wins only', () => {
    const s = runs({
      round: ROUNDS,
      finished: true,
      target: d(2045, 1),
      editable: [...POLICY_KEYS].sort()
    });
    const r = takeWin(s, win(d(2040, 2), ['transit-rail']));
    expect(r).toEqual({
      ...s,
      target: d(2040, 2),
      wins: [
        {
          round: ROUNDS,
          goalMonth: d(2040, 2),
          beat: d(2045, 1),
          at: AT,
          datasetVersion: 'fixture-0'
        }
      ]
    });
  });

  it('a null goal month keeps the target', () => {
    const r = takeWin(runs({ round: 1, target: d(2060, 6) }), win(null));
    expect(r.target).toBe(d(2060, 6));
    expect(r.round).toBe(2);
  });
});

describe('fitState', () => {
  it('drops unknown and duplicate keys, sorted, and clamps the round', () => {
    const s = runs({
      round: 7,
      editable: ['transit-rail', 'hands-radius', 'housing-bond', 'transit-rail']
    });
    expect(fitState(s)).toEqual({
      ...s,
      round: ROUNDS,
      editable: ['housing-bond', 'transit-rail']
    });
  });

  it('returns the same object when nothing changes', () => {
    const s = runs({ round: 2, editable: ['housing-bond', 'transit-rail'] });
    expect(fitState(s)).toBe(s);
    expect(fitState(NEW_GAME)).toBe(NEW_GAME);
  });
});
