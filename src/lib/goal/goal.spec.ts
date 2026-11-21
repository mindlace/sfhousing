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
  BUFFER_SHARE,
  GOAL,
  HOMES_COMPLETED,
  STATE_TARGET,
  TODAY,
  atDeadlineText,
  bufferAmount,
  capacityRows,
  goalName,
  goalRowNote,
  goalRows,
  goalStep,
  goalText,
  goalTrackMax,
  readGoal,
  type Goal
} from './goal';
import { trackMax } from '$lib/scoreboard/view';

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

  it('a deadline on months[0]: the step is drawn at 0 and the goal holds month 0', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[0]);
    expect(goalStep(g, v)).toEqual({ deadlineIndex: 0, units: BIG - v.baseline.completedNet });
    expect(readGoal(g, v, 0)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, 0) / BIG);
    expect(readGoal(g, v, 10)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, 0) / BIG);
    expect(readGoal(g, v, TODAY)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, TODAY) / BIG);
  });

  it('a deadline on months[lastIndex]: the step is drawn there and the goal reads to the end', () => {
    const v = whole();
    const last = v.lastIndex;
    const g = goalOf(BIG, v.months[last]);
    expect(goalStep(g, v)).toEqual({
      deadlineIndex: last,
      units: BIG - v.baseline.completedNet
    });
    expect(readGoal(g, v, last - 1)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, last - 1) / BIG);
    expect(readGoal(g, v, last)!.fraction).toBe(HOMES_COMPLETED.valueAt(v, last) / BIG);
    const reached = goalOf(HOMES_COMPLETED.valueAt(v, last), v.months[last]);
    expect(readGoal(reached, v, last)!.reachedOn).toBe(v.months[last]);
  });

  it('goalStep is null for a measure other than homes', () => {
    const v = whole();
    const g = goalOf(BIG, v.months[12]);
    expect(
      goalStep({ ...g, measure: { ...HOMES_COMPLETED, id: 'other' as 'homesCompleted' } }, v)
    ).toBeNull();
  });
});

describe('goal rows', () => {
  /** 60 calendar months from Nov 2026: the state target's deadline (Jan 2031) is month 50. */
  const long = (): TimelineView =>
    calendarMonths(
      viewOfLog(logFilled(logCompiled(EMPTY_LOG, statics({ lastIndex: 59 })), chunk(0, 60)))!
    );
  const DEADLINE = 50;
  const value = (v: TimelineView, i: number) => HOMES_COMPLETED.valueAt(v, i);
  const at = (index: number, atToday = false) => ({ index, atToday });

  it('bufferAmount is floor(amount × 1.15): 94,379 for the state target', () => {
    expect(BUFFER_SHARE).toBe(0.15);
    expect(bufferAmount(STATE_TARGET)).toBe(94_379);
    expect(bufferAmount(STATE_TARGET)).toBe(M1_TARGETS.find((t) => t.id === 'rhna-buffer')!.units);
  });

  it('goalRows at today reads TODAY for both rows, so the goal row equals readGoal(goal, view, TODAY)', () => {
    const v = long();
    expect(value(v, 0)).not.toBe(value(v, TODAY));
    const rows = goalRows(STATE_TARGET, v, at(0, true), TODAY)!;
    expect(rows.map((r) => r.id)).toEqual(['goal', 'buffer']);
    expect(rows[0].fraction).toBe(readGoal(STATE_TARGET, v, TODAY)!.fraction);
    expect(rows.map((r) => r.value)).toEqual([value(v, TODAY), value(v, TODAY)]);
    expect(rows[1].fraction).toBe(value(v, TODAY) / 94_379);
    expect(rows.map((r) => r.note)).toEqual(['by Jan 2031', 'by Jan 2031']);
  });

  it('goalRows before the deadline month: month index, note "by Jan 2031"', () => {
    const v = long();
    const rows = goalRows(STATE_TARGET, v, at(30), 30)!;
    expect(rows[0].fraction).toBe(readGoal(STATE_TARGET, v, 30)!.fraction);
    expect(rows.map((r) => r.value)).toEqual([value(v, 30), value(v, 30)]);
    expect(rows.map((r) => r.amount)).toEqual([82_069, 94_379]);
    expect(rows.map((r) => r.note)).toEqual(['by Jan 2031', 'by Jan 2031']);
  });

  it('goalRows from the deadline month: both rows hold at the deadline month, note "Held at Jan 2031"', () => {
    const v = long();
    for (const i of [DEADLINE, DEADLINE + 5]) {
      const rows = goalRows(STATE_TARGET, v, at(i), i)!;
      expect(rows.map((r) => r.value)).toEqual([value(v, DEADLINE), value(v, DEADLINE)]);
      expect(rows[0].fraction).toBe(readGoal(STATE_TARGET, v, i)!.fraction);
      expect(rows.map((r) => r.note)).toEqual(['Held at Jan 2031', 'Held at Jan 2031']);
      expect(rows.map((r) => r.atDeadline)).toEqual([null, null]);
    }
  });

  it('goalRows: atDeadline only while index < deadline and reachedMonth >= deadline', () => {
    const v = long();
    const none = [null, null];
    const shares = [value(v, DEADLINE) / 82_069, value(v, DEADLINE) / 94_379];
    const of = (a: { index: number; atToday: boolean }, reached: number) =>
      goalRows(STATE_TARGET, v, a, reached)!.map((r) => r.atDeadline);
    expect(of(at(30), DEADLINE - 1)).toEqual(none);
    expect(of(at(30), DEADLINE)).toEqual(shares);
    expect(of(at(0, true), 59)).toEqual(shares);
    expect(of(at(DEADLINE), 59)).toEqual(none);
    expect(of(at(DEADLINE + 5), 59)).toEqual(none);
  });

  it('goalRows with the deadline before the window: no "by" or "Held at" note, today or later', () => {
    const v = long();
    const past = { ...STATE_TARGET, deadline: v.months[0] - 40 };
    for (const a of [at(0, true), at(1), at(30)])
      expect(goalRows(past, v, a, 59)!.map((r) => r.note)).toEqual([null, null]);
  });

  it('goalRows is null when the month is not filled', () => {
    const v = cut(long(), 20);
    expect(goalRows(STATE_TARGET, v, at(21), 20)).toBeNull();
    expect(goalRows(STATE_TARGET, v, at(20), 20)).not.toBeNull();
    expect(goalRows(STATE_TARGET, v, at(0, true), TODAY)).not.toBeNull();
  });

  it('goalRowNote: by before the deadline month and at today, held from it on, null without one', () => {
    expect(goalRowNote(STATE_TARGET, 49, DEADLINE, false)).toBe('by Jan 2031');
    expect(goalRowNote(STATE_TARGET, 50, DEADLINE, false)).toBe('Held at Jan 2031');
    expect(goalRowNote(STATE_TARGET, 50, DEADLINE, true)).toBe('by Jan 2031');
    expect(goalRowNote(STATE_TARGET, 3, null, false)).toBeNull();
  });

  it('atDeadlineText', () => {
    expect(atDeadlineText(0.74)).toBe('At the deadline: 74%');
  });

  it('capacityRows: net over 82,069 and over 94,379, notes null, labels State target and State target + 15%', () => {
    const rows = capacityRows(47_335);
    expect(rows).toEqual([
      {
        id: 'goal',
        label: 'State target',
        amount: 82_069,
        value: 47_335,
        fraction: 47_335 / 82_069,
        note: null,
        atDeadline: null
      },
      {
        id: 'buffer',
        label: 'State target + 15%',
        amount: 94_379,
        value: 47_335,
        fraction: 47_335 / 94_379,
        note: null,
        atDeadline: null
      }
    ]);
  });

  it('goalTrackMax: 1 up to 100%, then the next half step; as trackMax reads targets', () => {
    expect(goalTrackMax([])).toBe(1);
    expect(goalTrackMax(capacityRows(-500))).toBe(1);
    expect(goalTrackMax(capacityRows(47_335))).toBe(1);
    expect(goalTrackMax(capacityRows(82_069))).toBe(1);
    // 1.8 of the goal (the buffer row is lower): the track grows to 200%.
    const rows = capacityRows(147_725);
    expect(goalTrackMax(rows)).toBe(2);
    expect(goalTrackMax(rows)).toBe(
      trackMax(rows.map((r, i) => ({ target: M1_TARGETS[i], fraction: r.fraction })))
    );
    expect(goalTrackMax(capacityRows(82_070))).toBe(1.5);
  });

  it('no row label or note contains RHNA', () => {
    const v = long();
    const all = [
      ...capacityRows(10),
      ...goalRows(STATE_TARGET, v, at(0, true), 59)!,
      ...goalRows(STATE_TARGET, v, at(30), 59)!,
      ...goalRows(STATE_TARGET, v, at(55), 59)!
    ];
    expect(all).toHaveLength(8);
    for (const r of all) expect(`${r.label} ${r.note ?? ''}`).not.toMatch(/RHNA/);
  });
});
