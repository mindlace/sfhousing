import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import {
  barBox,
  barLabel,
  compactDollars,
  dayPct,
  fixedLabel,
  fixedRef,
  formatEdge,
  isFixedRef,
  marketRef,
  settingOf,
  spanEdgeText,
  EMPTY_LANE
} from './rows';

const asOf = 20000;

describe('rows helpers', () => {
  it('compacts dollars', () => {
    expect([500_000_000, 1_500_000_000, 250_000, 900].map(compactDollars)).toEqual([
      '$500M',
      '$1.5B',
      '$250K',
      '$900'
    ]);
  });

  it('names a protection and terms settings', () => {
    expect(settingOf({ tag: 'protect', years: null })).toBe('Protected');
    expect(settingOf({ tag: 'protect', years: 30 })).toBe('Newer than 30 years');
    expect(settingOf({ tag: 'terms', terms: {} })).toBe('0 terms');
    expect(settingOf({ tag: 'brushes', brushes: [] })).toBe('No area yet');
  });

  it('places an open span to the right edge and a closed one inside', () => {
    const end = monthLastDay(asOf, 480);
    const open = barBox(
      { from: monthFirstDay(asOf, 241), to: null, what: { tag: 'protect', years: null } },
      asOf,
      end
    );
    expect(open.left + open.width).toBeCloseTo(100, 5);
    expect(open.left).toBeCloseTo(50, 0);
    expect(dayPct(end + 100, asOf, end)).toBe(100);
  });

  it('announces a span with no end', () => {
    const s = {
      from: monthFirstDay(asOf, 3),
      to: null,
      what: { tag: 'protect' as const, years: null }
    };
    expect(barLabel('Protected', 'Keep it', s, asOf)).toBe(
      `Protected, Keep it, ${formatEdge(monthFirstDay(asOf, 3))} to no end`
    );
  });

  // WCAG 2.5.3: a bar's name starts with the words it shows (the setting, then its level).
  it('barLabel starts with the setting and the level: "$410M, 99% left, Housing bond, 10 Dec 2030 to no end"', () => {
    const a = dayFromUtc(2030, 12, 9);
    const s = {
      from: monthFirstDay(a, 1),
      to: null,
      what: { tag: 'protect' as const, years: null }
    };
    expect(formatEdge(s.from)).toBe('10 Dec 2030');
    expect(barLabel('$410M', 'Housing bond', s, a, { left: ', 99% left' })).toBe(
      '$410M, 99% left, Housing bond, 10 Dec 2030 to no end'
    );
    expect(barLabel('6 stories', 'Transit rule', s, a)).toBe(
      '6 stories, Transit rule, 10 Dec 2030 to no end'
    );
  });

  it('barLabel: ", off" last; no level, no left', () => {
    const a = dayFromUtc(2030, 12, 9);
    const s = {
      from: monthFirstDay(a, 1),
      to: monthLastDay(a, 12),
      what: { tag: 'protect' as const, years: null }
    };
    const { from, to } = spanEdgeText(s, a);
    expect(barLabel('$410M', 'Housing bond', s, a, { off: true })).toBe(
      `$410M, Housing bond, ${from} to ${to}, off`
    );
    expect(barLabel('$410M', 'Housing bond', s, a, { off: false, left: null })).toBe(
      `$410M, Housing bond, ${from} to ${to}`
    );
  });

  it('fixedLabel: "In force, 86% left, Current funding, whole window"', () => {
    expect(fixedLabel('In force', 'Current funding', ', 86% left')).toBe(
      'In force, 86% left, Current funding, whole window'
    );
    expect(fixedLabel('In force', 'Current law')).toBe('In force, Current law, whole window');
    expect(fixedLabel('Steady', 'Market conditions', null)).toBe(
      'Steady, Market conditions, whole window'
    );
  });

  it('formats an edge as day, short month, year', () => {
    expect(formatEdge(dayFromUtc(2030, 12, 10))).toBe('10 Dec 2030');
    expect(formatEdge(dayFromUtc(2031, 1, 1))).toBe('1 Jan 2031');
  });

  // Main's I2 ruling: an edge reads its model month's start date (an end, inclusive, its last day).
  it.each([
    [1, 2, '1 Feb 2026', '2 Mar 2026'],
    [10, 13, '11 Jan 2027', '9 Feb 2027'],
    [31, 2, '3 Mar 2026', '1 Apr 2026']
  ])('dataset day %i: model month %i starts %s', (d, m, start, end) => {
    const a = dayFromUtc(2026, 1, d);
    expect(monthFirstDay(a, m)).toBe(dayFromUtc(2026, 1, d) + Math.floor((m - 1) * 30.436875) + 1);
    const s = {
      from: monthFirstDay(a, m),
      to: monthLastDay(a, m),
      what: { tag: 'protect' as const, years: null }
    };
    expect(spanEdgeText(s, a)).toEqual({ from: start, to: end });
    expect(spanEdgeText(s, a).from).toBe(formatEdge(monthFirstDay(a, m)));
    expect(spanEdgeText({ ...s, to: null }, a).to).toBe('no end');
    expect(barLabel('Protected', 'P', s, a)).toBe(`Protected, P, ${start} to ${end}`);
  });

  it('tells a fixed ref from a policy span by its span index', () => {
    expect(isFixedRef(fixedRef('zoning'))).toBe(true);
    expect(isFixedRef(marketRef())).toBe(true);
    expect(fixedRef('zoning').span).toBe(-1);
    expect(isFixedRef({ kind: 'zoning', id: 'fixed', span: 0 })).toBe(false);
    expect(isFixedRef({ kind: 'money', id: 'fixed-market', span: 0 })).toBe(false);
    expect(isFixedRef(null)).toBe(false);
  });

  it('EMPTY_LANE: Add a zoning change, Add a permitting change, Add public money', () => {
    expect(EMPTY_LANE).toEqual({
      zoning: 'Add a zoning change',
      permitting: 'Add a permitting change',
      money: 'Add public money'
    });
  });
});
