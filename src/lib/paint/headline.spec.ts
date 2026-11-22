import { describe, expect, it } from 'vitest';
import { HOMES_COMPLETED, GOAL_BASE, type GoalBase } from '$lib/goal/goal';
import { headlineSpoken } from '$lib/timeline/results';
import { capacityGoalText, paintHeadline, roomFor } from './headline';

describe('paint headline', () => {
  it('reads room for the net homes, grouped, compact from a million', () => {
    expect(roomFor(0)).toBe('Room for 0 homes');
    expect(roomFor(47335)).toBe('Room for 47,335 homes');
    expect(roomFor(999999)).toBe('Room for 999,999 homes');
    expect(roomFor(1234567)).toBe('Room for 1.2M homes');
  });

  it('gives the share of the goal, and Goal reached at or over its amount', () => {
    expect(capacityGoalText(47335, GOAL_BASE)).toBe('57% of the goal');
    expect(capacityGoalText(0, GOAL_BASE)).toBe('0% of the goal');
    expect(capacityGoalText(82069, GOAL_BASE)).toBe('Goal reached');
    expect(capacityGoalText(90000, GOAL_BASE)).toBe('Goal reached');
  });

  it('has no goal part for a goal that is not a count of homes', () => {
    const goal: GoalBase = {
      ...GOAL_BASE,
      measure: { ...HOMES_COMPLETED, id: 'other' as 'homesCompleted' }
    };
    expect(capacityGoalText(10, goal)).toBeNull();
    const h = paintHeadline(10, goal);
    expect(h.goal).toBeNull();
    expect(h.goalName).toBeNull();
  });

  it('is the header text with no effect, the goal named without a date, and spoken in one line', () => {
    const h = paintHeadline(47335);
    expect(h).toEqual({
      main: 'Room for 47,335 homes',
      effect: null,
      goal: '57% of the goal',
      goalName: 'Goal: 82,069 homes'
    });
    expect(headlineSpoken(h)).toBe('Room for 47,335 homes, 57% of the goal');
  });
});
