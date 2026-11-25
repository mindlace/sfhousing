import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import {
  GO_TO_PAINT,
  GOAL_AND_BAR_FLAG,
  BACK_TO_TREE,
  LATER_ROUND,
  LOCKED_LANE,
  NOT_BOUGHT,
  TO_BEAT_FLAG,
  boughtLabel,
  goalUnlocks,
  levelledUp,
  lockedSim,
  missed,
  missedBar,
  restoredLabel,
  shortOfBar,
  toBeatDescription,
  toBeatLine,
  winTitle
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

const MAR_2058 = dayFromUtc(2058, 3, 1);
const JUN_2057 = dayFromUtc(2057, 6, 1);
const MAR_2049 = dayFromUtc(2049, 3, 1);

describe('game copy', () => {
  it('says each outcome word for word', () => {
    expect(shortOfBar(MAR_2058, JUN_2057)).toBe(
      'Goal reached in Mar 2058. Beat Jun 2057 to level up.'
    );
    expect(missedBar(3313, 'homes', JUN_2057)).toBe(
      'Goal missed by 3,313 homes. Reach it before Jun 2057 to level up.'
    );
    expect(missed(3313, 'homes')).toBe('Goal missed by 3,313 homes.');
    expect(winTitle(MAR_2049)).toBe('Goal reached in Mar 2049');
  });
  it('names the bar', () => {
    expect(TO_BEAT_FLAG).toBe('To beat');
    expect(GOAL_AND_BAR_FLAG).toBe('Goal · To beat');
    expect(toBeatLine(JUN_2057)).toBe('To beat: Jun 2057');
    expect(toBeatDescription(JUN_2057)).toBe('To beat June 2057.');
  });
  it('says what a level up opened', () => {
    expect(levelledUp(3, 'Permitting')).toBe('Level 3. Permitting unlocked.');
    expect(levelledUp(4, 'Zoning')).toBe('Level 4. Zoning unlocked.');
    expect(levelledUp(5, 'Public money')).toBe('Level 5. Public money unlocked.');
    expect(levelledUp(5, null)).toBe('Round complete.');
  });
  it('words the locked page', () => {
    expect(lockedSim(82069, 'homes')).toBe('Paint room for 82,069 homes to unlock the simulation.');
    expect(GO_TO_PAINT).toBe('Go to Paint');
    expect(LATER_ROUND).toBe('Unlocks in a later round');
  });
});

describe('the tree words', () => {
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
