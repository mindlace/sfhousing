import { expect, it } from 'vitest';
import { DueList } from './due';

it('takes a month ascending and forgets it', () => {
  const d = new DueList(10);
  d.put(5, 3);
  d.put(-2, 3);
  d.put(1, 3);
  expect(Array.from(d.take(3))).toEqual([-2, 1, 5]);
  expect(d.take(3)).toHaveLength(0);
});

it('drops and moves entities', () => {
  const d = new DueList(10);
  d.put(7, 4);
  d.drop(7);
  expect(d.take(4)).toHaveLength(0);
  d.put(7, 4);
  d.put(7, 6);
  expect(d.take(4)).toHaveLength(0);
  expect(Array.from(d.take(6))).toEqual([7]);
});

it('plans nothing past through', () => {
  const d = new DueList(10);
  d.put(8, 5);
  d.put(8, 11);
  expect(d.take(5)).toHaveLength(0);
  expect(d.take(11)).toHaveLength(0);
});

it('keeps far lots and rows apart, and moves them between full months', () => {
  const d = new DueList(480);
  const lots = Array.from({ length: 300 }, (_, i) => i * 997);
  const rows = Array.from({ length: 300 }, (_, i) => -1 - i * 31);
  for (const e of [...lots, ...rows]) d.put(e, 7);
  for (const e of lots.slice(0, 100)) d.put(e, 9);
  for (const e of rows.slice(0, 50)) d.drop(e);
  const at7 = [...lots.slice(100), ...rows.slice(50)].sort((a, b) => a - b);
  expect(Array.from(d.take(7))).toEqual(at7);
  expect(Array.from(d.take(9))).toEqual(lots.slice(0, 100));
  expect(d.take(8)).toHaveLength(0);
});

it('refuses a month before the first', () => {
  const d = new DueList(10);
  expect(() => d.put(1, 0)).toThrow(RangeError);
  expect(() => d.put(1, -3)).toThrow(RangeError);
});

it('lists an entity once when put twice for one month', () => {
  const d = new DueList(10);
  d.put(3, 2);
  d.put(3, 2);
  expect(Array.from(d.take(2))).toEqual([3]);
});
