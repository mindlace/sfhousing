import { describe, expect, it } from 'vitest';
import {
  BACK_TO_TREE,
  LOCKED_LANE,
  NOT_BOUGHT,
  boughtLabel,
  goalUnlocks,
  restoredLabel
} from './game-copy';
import type { TreeNode } from '$lib/game/tree';

function node(label: string, steps: string[]): TreeNode {
  return {
    id: 'n',
    branch: 'permitting',
    label,
    line: '',
    after: [],
    ring: 1,
    levels: steps.map((step) => ({
      price: { homes: 0 },
      grant: { tag: 'bands', max: 2 },
      step
    })),
    source: null
  } as unknown as TreeNode;
}

describe('the tree words', () => {
  it('exports only the tree words', async () => {
    expect(Object.keys(await import('./game-copy')).sort()).toEqual([
      'BACK_TO_TREE',
      'LOCKED_LANE',
      'NOT_BOUGHT',
      'boughtLabel',
      'goalUnlocks',
      'restoredLabel'
    ]);
  });
  it('fixed words', () => {
    expect(NOT_BOUGHT).toBe('Not bought yet');
    expect(LOCKED_LANE).toBe('Opens in the tree');
    expect(BACK_TO_TREE).toBe('Back to the tree');
  });
  it('goalUnlocks counts levers', () => {
    expect(goalUnlocks(0, true)).toBe('an earlier goal');
    expect(goalUnlocks(1, true)).toBe('1 lever and an earlier goal');
    expect(goalUnlocks(4, true)).toBe('4 levers and an earlier goal');
    expect(goalUnlocks(1, false)).toBe('1 lever');
    expect(goalUnlocks(4, false)).toBe('4 levers');
  });
  it('bought and restored labels', () => {
    expect(boughtLabel(node('Faster permits', ['Fast']), 1)).toBe('Bought: Faster permits');
    const tall = node('Taller near stops', ['6 stories', '8 stories']);
    expect(boughtLabel(tall, 2)).toBe('Bought: Taller near stops, 8 stories');
    expect(restoredLabel(tall)).toBe('Restored: Taller near stops');
  });
});
