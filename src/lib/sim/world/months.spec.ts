import { expect, it } from 'vitest';
import { SYNTH_AS_OF } from '../scenario/fixtures/synth-city';
import { monthFirstDay, monthLastDay, monthOfDay, windowHorizon } from './months';

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

it('windowHorizon: the last whole calendar month inside the window', () => {
  expect(windowHorizon(20727, 480)).toBe(35336); // 1 Oct 2026  -> 30 Sep 2066
  expect(windowHorizon(20736, 480)).toBe(35336); // 10 Oct 2026 -> 30 Sep 2066 (fixture-0)
  expect(windowHorizon(20757, 480)).toBe(35336); // 31 Oct 2026 -> 30 Sep 2066
  expect(windowHorizon(20787, 480)).toBe(35367); // 30 Nov 2026 -> 31 Oct 2066
});
