import { describe, expect, it } from 'vitest';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { barBox, barLabel, compactDollars, dayPct, settingOf } from './rows';

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
    expect(barLabel('Keep it', s, asOf)).toMatch(/^Keep it, \w+ \d{4} to no end$/);
  });
});
