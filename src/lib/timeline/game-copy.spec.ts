import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import {
  GO_TO_PAINT,
  GOAL_AND_BAR_FLAG,
  LATER_ROUND,
  TO_BEAT_FLAG,
  levelledUp,
  lockedSim,
  missed,
  missedBar,
  shortOfBar,
  toBeatDescription,
  toBeatLine,
  winTitle
} from './game-copy';

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
