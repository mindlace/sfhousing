import { expect, it } from 'vitest';
import { SYNTH_AS_OF } from '../scenario/fixtures/synth-city';
import { monthFirstDay, monthLastDay, monthOfDay } from './months';

it('matches the worked month boundaries at asOf 0', () => {
  expect([monthFirstDay(0, 1), monthLastDay(0, 1)]).toEqual([1, 30]);
  expect([monthFirstDay(0, 2), monthLastDay(0, 2)]).toEqual([31, 60]);
  expect([monthFirstDay(0, 3), monthLastDay(0, 3)]).toEqual([61, 91]);
  expect(monthLastDay(0, 12)).toBe(365);
  expect(monthLastDay(0, 480)).toBe(14609);
  expect([0, 1, 30, 31, 365, 366].map((d) => monthOfDay(0, d))).toEqual([0, 1, 1, 2, 12, 13]);
});

it('maps days to months consistently, tiling the calendar', () => {
  for (const asOf of [0, SYNTH_AS_OF]) {
    for (let m = 1; m <= 1000; m++) {
      expect(monthOfDay(asOf, monthFirstDay(asOf, m))).toBe(m);
      expect(monthOfDay(asOf, monthLastDay(asOf, m))).toBe(m);
      expect(monthLastDay(asOf, m) + 1).toBe(monthFirstDay(asOf, m + 1));
    }
    expect(monthOfDay(asOf, asOf)).toBe(0);
    expect(monthOfDay(asOf, asOf - 100)).toBe(0);
  }
});
