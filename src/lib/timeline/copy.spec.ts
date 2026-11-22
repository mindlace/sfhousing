// The render-time remaps of texts that hashed or /lesscars-imported files keep (rule 38).
import { describe, expect, it } from 'vitest';
import { MONEY_SOURCES } from '$lib/sim/scenario/finance-score';
import {
  PER_HOME_SOURCE,
  GOAL_FLAG,
  LENS_NAME,
  chartCaption,
  goalNote,
  homesBy,
  perHomeMethod,
  playFromText,
  rulerDescription,
  speedName
} from './copy';
import { dayFromUtc } from '$lib/fzp/time';

describe('the ruler and transport', () => {
  it('playFromText, speedName and rulerDescription', () => {
    expect(playFromText(dayFromUtc(2028, 3, 1))).toBe('Play from 2028');
    expect(speedName('year')).toBe('1× speed, 1 year per second');
    expect(speedName('threeYears')).toBe('3× speed, 3 years per second');
    expect(GOAL_FLAG).toBe('Goal');
    expect(rulerDescription(dayFromUtc(2045, 6, 1), dayFromUtc(2031, 1, 31))).toBe(
      'Seen up to June 2045. Goal deadline January 2031.'
    );
    expect(rulerDescription(dayFromUtc(2045, 6, 1), null)).toBe('Seen up to June 2045.');
    expect(rulerDescription(null, dayFromUtc(2031, 1, 31))).toBe('Goal deadline January 2031.');
    expect(rulerDescription(null, null)).toBe('');
  });
});

describe('the chart', () => {
  it('goalNote says the homes still needed and the deadline month', () => {
    expect(goalNote(73_346, dayFromUtc(2031, 1, 1))).toBe('73,346 more by Jan 2031');
  });

  it('chartCaption says what is drawn, the goal with its remainder and deadline', () => {
    const goal = { units: 73_346, deadline: dayFromUtc(2031, 1, 1) };
    expect(chartCaption(false, goal)).toBe(
      'Homes completed from today, by month, and the goal as the homes still needed by its ' +
        'deadline: 73,346 more by Jan 2031. The month slider reads out each month.'
    );
    expect(chartCaption(false, null)).toBe(
      'Homes completed from today, by month. The month slider reads out each month.'
    );
    expect(chartCaption(true, goal)).toBe(
      'Homes completed from today with your policy and under current law, by month. The shaded ' +
        'gap is what your policy adds. The goal is drawn as the homes still needed by its ' +
        'deadline: 73,346 more by Jan 2031. The month slider reads out each month.'
    );
    expect(chartCaption(true, null)).toBe(
      'Homes completed from today with your policy and under current law, by month. The shaded ' +
        'gap is what your policy adds. The month slider reads out each month.'
    );
    for (const a of [true, false])
      for (const b of [goal, null]) expect(chartCaption(a, b)).not.toMatch(/RHNA|FZP/);
  });

  it("chartCaption names each lens's lines; source and effect name no goal", () => {
    const goal = { units: 73_346, deadline: dayFromUtc(2031, 1, 1) };
    const source =
      "Homes completed from today, by month, and those from today's pipeline. The shaded gap " +
      'is new projects. The month slider reads out each month.';
    // The source lens draws no goal step (its scale is its own), so it names none.
    for (const inForce of [true, false])
      for (const b of [goal, null]) expect(chartCaption(inForce, b, 'source')).toBe(source);
    const effect =
      'Homes from your policy against current law, by month. The month slider reads out each month.';
    expect(chartCaption(true, goal, 'effect')).toBe(effect);
    expect(chartCaption(true, null, 'effect')).toBe(effect);
    // Without a policy in force the effect lens is the homes lens.
    expect(chartCaption(false, goal, 'effect')).toBe(chartCaption(false, goal));
    expect(chartCaption(true, goal, 'homes')).toBe(chartCaption(true, goal));
    expect(LENS_NAME).toEqual({ homes: 'Homes', source: 'By source', effect: 'From your policy' });
    for (const lens of ['homes', 'source', 'effect'] as const)
      for (const b of [goal, null]) expect(chartCaption(true, b, lens)).not.toMatch(/RHNA|FZP/);
  });
});

describe('homesBy', () => {
  it('says the count and the month, or today', () => {
    expect(homesBy(12345, dayFromUtc(2040, 4, 1))).toBe('12,345 homes by Apr 2040');
    expect(homesBy(0, null)).toBe('0 homes by today');
    expect(homesBy(-12, dayFromUtc(2026, 11, 1))).toBe('−12 homes by Nov 2026');
  });
});

describe('perHomeMethod', () => {
  it('replaces the completion-month tail of the per-home entry with PER_HOME_SOURCE', () => {
    const out = perHomeMethod(MONEY_SOURCES[1].method!);
    expect(out.endsWith(PER_HOME_SOURCE)).toBe(true);
    expect(out).not.toContain('when the funded project completes');
    expect(out).not.toContain('end of the run');
  });

  it('leaves any other method as it is', () => {
    expect(perHomeMethod(MONEY_SOURCES[3].method!)).toBe(MONEY_SOURCES[3].method);
  });
});
