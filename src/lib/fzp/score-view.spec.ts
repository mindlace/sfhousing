import { describe, expect, it } from 'vitest';
import { TIMELINE_SCORE, TIMELINE_SCORE_R0 } from './fixtures/timeline-score';
import {
  CALCULATING,
  builtTowardGoalText,
  deadlineIndex,
  scoreAt,
  vsFzpText,
  fromPolicyText
} from './score-view';
import { dayFromUtc } from './time';

const DEADLINE = dayFromUtc(2031, 1, 31);

describe('shared copy', () => {
  it('is defined once: calculating', () => {
    expect(CALCULATING).toBe('calculating…');
  });
});

describe('deadlineIndex', () => {
  it('is the month index of the deadline', () => {
    expect(deadlineIndex(TIMELINE_SCORE, DEADLINE)).toBe(51);
  });

  it('clamps to the series', () => {
    expect(deadlineIndex(TIMELINE_SCORE, dayFromUtc(2020, 1, 1))).toBe(0);
    expect(deadlineIndex(TIMELINE_SCORE, dayFromUtc(2090, 1, 1))).toBe(290);
  });
});

describe('scoreAt', () => {
  const at = scoreAt(TIMELINE_SCORE, 50);

  it('reads the shown run, the baseline and the plan effect', () => {
    expect(at.monthIndex).toBe(50);
    expect(at.total).toBe(12000 + 5000);
    expect(at.actual).toBe(12000);
    expect(at.pipeline).toBe(3000);
    expect(at.fresh).toBe(2000);
    expect(at.planCompleted).toBe(1200);
    expect(at.planEntitled).toBe(2050);
    expect(at.exitedUnits).toBe(250);
  });

  it('has no band or planBand key', () => {
    expect('band' in at).toBe(false);
    expect('planBand' in at).toBe(false);
  });

  it('lists the in-progress stages in stage order', () => {
    expect(at.inProgress.map((r) => r.stage)).toEqual([
      'preApplication',
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
    expect(at.inProgress.map((r) => r.units)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('carries target progress now and at the deadline', () => {
    expect(at.targets).toHaveLength(2);
    expect(at.targets[0].tp.target.id).toBe('rhna');
    expect(at.targets[0].tp.fraction).toBe(17000 / 82069);
    expect(at.targets[0].atDeadline).toBe(TIMELINE_SCORE.targets[0].fraction[51]);
    expect(at.targets[1].tp.target.id).toBe('rhna-buffer');
  });

  it('has null plan values in revision 0 and every other field unchanged', () => {
    const r0 = scoreAt(TIMELINE_SCORE_R0, 50);
    expect(r0.planCompleted).toBeNull();
    expect(r0.planEntitled).toBeNull();
    expect({ ...r0, planCompleted: 1, planEntitled: 1 }).toEqual({
      ...at,
      planCompleted: 1,
      planEntitled: 1
    });
  });
});

describe('fromPolicyText', () => {
  it('fromPolicyText signs the count and says from your policy', () => {
    expect(fromPolicyText(1234)).toBe('+1,234 from your policy');
    expect(fromPolicyText(-56)).toBe('\u221256 from your policy');
    expect(fromPolicyText(0)).toBe('+0 from your policy');
  });
});

describe('vsFzpText', () => {
  it('signs the delta: a plus, a true minus (U+2212) and a plus on zero', () => {
    expect(vsFzpText(1234)).toBe('vs FZP +1,234');
    expect(vsFzpText(-56)).toBe('vs FZP \u221256');
    expect(vsFzpText(0)).toBe('vs FZP +0');
  });
});

describe('builtTowardGoalText', () => {
  it('builtTowardGoalText says the homes built since the data start count toward the goal', () => {
    expect(
      builtTowardGoalText({
        ...TIMELINE_SCORE.baseline,
        completedNet: 15234,
        since: dayFromUtc(2022, 6, 30)
      })
    ).toBe('15,234 homes built from Jun 2022 count toward the goal.');
  });
});
