import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from '$lib/timeline/chunk-log';
import { calendarMonths, chunk, cut, statics } from '$lib/timeline/test/fixtures';
import { dayFromUtc } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';
import { RHNA_DEADLINE } from '$lib/sim/scenario/score';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import type { TimelineView } from '$lib/sim/world/score/types';
import {
  GOAL,
  HOMES_COMPLETED,
  STATE_TARGET,
  TODAY,
  goalName,
  goalStep,
  goalText,
  readGoal,
  type Goal
} from './goal';

function whole(): TimelineView {
  return calendarMonths(viewOfLog(logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 24)))!);
}

function goalOf(amount: number, deadline: Day): Goal {
  return { ...STATE_TARGET, amount, deadline };
}

const BIG = 10_000_000;

describe('the goal', () => {
  it('the state target is RHNA 2023-2031, counted from 30 Jun 2022, due 31 Jan 2031', () => {
    expect(STATE_TARGET.amount).toBe(M1_TARGETS.find((t) => t.id === 'rhna')!.units);
    expect(STATE_TARGET.deadline).toBe(RHNA_DEADLINE);
    expect(STATE_TARGET.countsFrom).toBe(dayFromUtc(2022, 6, 30));
    expect(GOAL).toBe(STATE_TARGET);
    expect(STATE_TARGET.name).toBe('State target');
  });

  it("countsFrom matches fixture-0's baseline.since", () => {
    const file = JSON.parse(
      readFileSync('e2e/fixtures/data/fixture-0/scenarios/fzp/projects.json', 'utf8')
    );
    expect(file.rhnaCompletedNet.since).toBe(19173);
    expect(STATE_TARGET.countsFrom).toBe(19173);
  });

  it('names the goal', () => {
    expect(goalName(STATE_TARGET)).toBe('State target: 82,069 homes by Jan 2031');
  });

  it('HOMES_COMPLETED counts the homes built before today plus the simulation', () => {
    const v = whole();
    expect(HOMES_COMPLETED.valueAt(v, TODAY)).toBe(v.baseline.completedNet);
    expect(HOMES_COMPLETED.valueAt(v, 5)).toBe(v.baseline.completedNet + v.rows[5].completedNet);
  });

  it('reads at the playhead before the deadline and holds the deadline month after it', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[12]);
    expect(readGoal(g, v, 3)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, 3) / BIG);
    expect(readGoal(g, v, 20)!.fraction).toBe(readGoal(g, v, 12)!.fraction);
  });

  it('reached: the first month at or before the read month, and only by the deadline', () => {
    const v = whole();
    const amount = HOMES_COMPLETED.valueAt(v, 8);
    const g = goalOf(amount, v.months[12]);
    expect(readGoal(g, v, 7)!.reachedOn).toBeNull();
    expect(readGoal(g, v, 8)!.reachedOn).toBe(v.months[8]);
    expect(readGoal(g, v, 20)!.reachedOn).toBe(v.months[8]);
    expect(readGoal({ ...g, deadline: v.months[6] }, v, 20)!.reachedOn).toBeNull();
  });

  it('dragging back before the reached month shows the percentage again', () => {
    const v = whole();
    const g = goalOf(HOMES_COMPLETED.valueAt(v, 8), v.months[12]);
    expect(goalText(readGoal(g, v, 7)!)).toMatch(/^\d+(\.\d)?% of the goal$/);
  });

  it('goalText', () => {
    expect(goalText({ fraction: 0.68, reachedOn: null })).toBe('68% of the goal');
    expect(goalText({ fraction: 0.9999, reachedOn: null })).toBe('99% of the goal');
    expect(goalText({ fraction: 1.2, reachedOn: dayFromUtc(2029, 3, 1) })).toBe(
      'Goal reached, Mar 2029'
    );
  });

  it('is null past the filled part', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[12]);
    expect(readGoal(g, cut(v, 5), 9)).toBeNull();
    expect(readGoal(g, cut(v, 5), TODAY)).not.toBeNull();
  });

  it('a deadline before the window holds the value at today', () => {
    const v = whole();
    const base = v.baseline.completedNet;
    const g = goalOf(BIG, v.months[0] - 40);
    expect(readGoal(g, v, 10)!.fraction).toBe(base / BIG);
    expect(readGoal(g, v, 10)!.reachedOn).toBeNull();
    expect(readGoal({ ...g, amount: base }, v, 10)!.reachedOn).toBe(v.months[0]);
  });

  it('a deadline past the window reads at the playhead', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[v.lastIndex] + 400);
    expect(readGoal(g, v, 10)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, 10) / BIG);
  });

  it('goalStep is the amount still needed after today, at the deadline month', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[12]);
    expect(goalStep(g, v)).toEqual({ deadlineIndex: 12, units: BIG - v.baseline.completedNet });
    expect(goalStep({ ...g, deadline: v.months[0] - 40 }, v)).toBeNull();
    expect(goalStep({ ...g, deadline: v.months[v.lastIndex] + 400 }, v)).toBeNull();
  });

  it('goalStep is null for a measure other than homes', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[12]);
    expect(
      goalStep({ ...g, measure: { ...HOMES_COMPLETED, id: 'other' as 'homesCompleted' } }, v)
    ).toBeNull();
  });
});
