import { describe, expect, it } from 'vitest';
import type { Level } from './levels';
import { barOf, levelUp, NEW_GAME, roundComplete, type Banked, type Progress } from './progress';

const b = (on: number): Banked => ({ on, datasetVersion: 'v1', at: '2026-11-22T00:00:00.000Z' });
const at = (level: Level, banked: Progress['banked'] = {}): Progress => ({
  v: 1,
  level,
  banked,
  firstWinAt: '2026-01-01T00:00:00.000Z'
});
const upTo = (n: number) =>
  Object.fromEntries([2, 3, 4].filter((k) => k < n).map((k) => [k, b(k)])) as Progress['banked'];

/** Runs levelUp and asserts the input was not mutated. */
function pure(p: Progress, banked: Banked | null): Progress {
  const before = structuredClone(p);
  const out = levelUp(p, banked);
  expect(p).toEqual(before);
  return out;
}

describe('levelUp', () => {
  it('level 1 goes to 2 and banks nothing, even when given a value', () => {
    expect(pure(at(1), b(9))).toEqual(at(2));
    expect(pure(at(1), null)).toEqual(at(2));
  });
  it.each([2, 3, 4] as const)('level %i banks the value under the level left', (n) => {
    expect(pure(at(n, upTo(n)), b(100))).toEqual(at((n + 1) as Level, { ...upTo(n), [n]: b(100) }));
  });
  it.each([2, 3, 4] as const)('level %i with null is p itself', (n) => {
    const p = at(n, upTo(n));
    expect(pure(p, null)).toBe(p);
  });
  it('level 5 banks banked[5] and stays at 5', () => {
    expect(pure(at(5, upTo(5)), b(7))).toEqual(at(5, { ...upTo(5), 5: b(7) }));
  });
  it('level 5 with null is p itself', () => {
    const p = at(5, upTo(5));
    expect(pure(p, null)).toBe(p);
  });
  it('a complete round is p itself, with null and with a value', () => {
    const p = at(5, { ...upTo(5), 5: b(7) });
    expect(pure(p, null)).toBe(p);
    expect(pure(p, b(1))).toBe(p);
  });
  it('firstWinAt and v pass through', () => {
    const out = pure(at(2, upTo(2)), b(3));
    expect(out.firstWinAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.v).toBe(1);
  });
  it('NEW_GAME is the new game and stays so after a level up', () => {
    expect(NEW_GAME).toEqual({ v: 1, level: 1, banked: {}, firstWinAt: null });
    levelUp(NEW_GAME, b(1));
    expect(NEW_GAME).toEqual({ v: 1, level: 1, banked: {}, firstWinAt: null });
  });
});

describe('barOf', () => {
  it('is null at levels 1 and 2', () => {
    expect(barOf(at(1))).toBeNull();
    expect(barOf(at(2))).toBeNull();
  });
  it.each([3, 4, 5] as const)('is the previous level banked on at level %i', (n) => {
    expect(barOf(at(n, upTo(n)))).toEqual({ on: n - 1 });
  });
  it('is null at 4 with banked[3] missing', () => {
    expect(barOf(at(4, { 2: b(2) }))).toBeNull();
  });
});

describe('roundComplete', () => {
  it('is false at 4', () => {
    expect(roundComplete(at(4, upTo(4)))).toBe(false);
  });
  it('is false at 5 without banked[5]', () => {
    expect(roundComplete(at(5, upTo(5)))).toBe(false);
  });
  it('is true at 5 with banked[5]', () => {
    expect(roundComplete(at(5, { ...upTo(5), 5: b(7) }))).toBe(true);
  });
});
