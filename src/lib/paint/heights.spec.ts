import { describe, expect, it } from 'vitest';
import type { PlanOp } from '$lib/plan';
import { heightRowText, heightsOf } from './heights';

const path: [number, number][] = [[-122.42, 37.77]];
const paint = (id: string, stories: number): PlanOp => ({
  kind: 'paint',
  id,
  stories,
  radiusM: 10,
  path
});
const erase = (id: string): PlanOp => ({ kind: 'erase', id, radiusM: 10, path });

describe('heightRowText', () => {
  it('heightRowText: lots, rebuilt, singular, grouping, 42+ while loading, … before an answer', () => {
    expect(heightRowText(6, 42, 30, 0)).toBe('6 stories · 42 lots · 30 rebuilt');
    expect(heightRowText(1, 1, 0, 0)).toBe('1 story · 1 lot · 0 rebuilt');
    expect(heightRowText(4, 0, 0, 0)).toBe('4 stories · 0 lots · 0 rebuilt');
    expect(heightRowText(12, 1234, 1001, 0)).toBe('12 stories · 1,234 lots · 1,001 rebuilt');
    expect(heightRowText(6, 42, 30, 3)).toBe('6 stories · 42+ lots · 30 rebuilt');
    expect(heightRowText(6, 1, 1, 2)).toBe('6 stories · 1+ lots · 1 rebuilt');
    expect(heightRowText(6, null, 0, 0)).toBe('6 stories · …');
    expect(heightRowText(1, null, 0, 5)).toBe('1 story · …');
  });
});

describe('heightsOf', () => {
  it('heightsOf: distinct paint stories, ascending, erases ignored', () => {
    expect(heightsOf([])).toEqual([]);
    expect(heightsOf([erase('e')])).toEqual([]);
    expect(
      heightsOf([paint('a', 8), erase('e'), paint('b', 3), paint('c', 8), paint('d', 12)])
    ).toEqual([3, 8, 12]);
  });
});
