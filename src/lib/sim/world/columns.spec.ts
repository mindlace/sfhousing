import { expect, it } from 'vitest';
import { addProject, emptyWorld, ensureLot, lotRow, pushRev, revisionsOf } from './columns';
import { END_ALIVE, LOT_FREE, NO_DAY, NO_STOP } from './types';

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  let s = 12345;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

it('appends lot rows, never moves one, and finds each by lot', () => {
  const w = emptyWorld(0);
  const rowOf = new Map<number, number>();
  for (const lot of shuffled(1000)) {
    // Take the row first: growing replaces the arrays, so `w.lots.k` must be read afterwards.
    const row = ensureLot(w.lots, lot * 7, 100);
    // A new lot gets the next row.
    expect(row).toBe(rowOf.size);
    rowOf.set(lot * 7, row);
    w.lots.k[row] = lot;
  }
  expect(w.lots.n).toBe(1000);
  for (const [lot, row] of rowOf) {
    expect(w.lots.lot[row]).toBe(lot);
    expect(lotRow(w.lots, lot)).toBe(row);
  }
  for (let lot = 0; lot < 1000; lot++) expect(w.lots.k[lotRow(w.lots, lot * 7)]).toBe(lot);
  // A lot with no row, below and past the highest lot that has one.
  expect(lotRow(w.lots, 3)).toBe(-1);
  expect(lotRow(w.lots, 1_000_000)).toBe(-1);
});

it('gives a new lot row its defaults and is idempotent', () => {
  const w = emptyWorld(4);
  const r = ensureLot(w.lots, 9, 55);
  expect(ensureLot(w.lots, 9, 77)).toBe(r);
  expect(w.lots.n).toBe(1);
  expect(w.lots.state[r]).toBe(LOT_FREE);
  expect([w.lots.k[r], w.lots.r[r], w.lots.lastExit[r], w.lots.project[r]]).toEqual([
    0, 55, 55, -1
  ]);
  expect(w.frame).toBe(4);
  expect(w.month).toBe(0);
});

it('gives a new project row its defaults', () => {
  const w = emptyWorld(0);
  const a = addProject(w.projects);
  const b = addProject(w.projects);
  expect([a, b, w.projects.n]).toEqual([0, 1, 2]);
  const p = w.projects;
  expect(p.endKind[b]).toBe(END_ALIVE);
  expect(p.stopAt[b]).toBe(NO_STOP);
  expect(p.revLast[b]).toBe(-1);
  expect(p.stories[b]).toBeNaN();
  expect(Array.from(p.entered.subarray(7, 14))).toEqual(new Array(7).fill(NO_DAY));
  expect(p.filed[b]).toBe(NO_DAY);
});

it('merges revisions as today', () => {
  const w = emptyWorld(0);
  const p = w.projects;
  const a = addProject(p);
  const b = addProject(p);
  pushRev(p, a, 10, 5, 2);
  pushRev(p, b, 1, 1, null);
  pushRev(p, a, 20, 7, 3);
  pushRev(p, a, 20, 5, 2);
  expect(revisionsOf(p, a, 100)).toEqual([{ day: 10, units: 5, stories: 2 }]);
  pushRev(p, a, 30, 9, null);
  expect(revisionsOf(p, a, 100)).toEqual([
    { day: 10, units: 5, stories: 2 },
    { day: 30, units: 9, stories: null }
  ]);
  expect(revisionsOf(p, a, 29)).toEqual([{ day: 10, units: 5, stories: 2 }]);
  expect(revisionsOf(p, a, 5)).toEqual([]);
  expect(revisionsOf(p, b, 5)).toEqual([{ day: 1, units: 1, stories: null }]);
  expect(() => pushRev(p, a, 3, 1, 1)).toThrow();
});

it('never removes the first revision', () => {
  const w = emptyWorld(0);
  const a = addProject(w.projects);
  pushRev(w.projects, a, 10, 5, 2);
  pushRev(w.projects, a, 10, 5, 2);
  expect(revisionsOf(w.projects, a, 10)).toEqual([{ day: 10, units: 5, stories: 2 }]);
});

it('is a full copy under structuredClone', () => {
  const w = emptyWorld(3);
  for (let i = 0; i < 3000; i++) {
    const r = addProject(w.projects);
    w.projects.units[r] = i;
    w.projects.programmes[r] = i % 2 ? 'a,b' : '';
    pushRev(w.projects, r, i, i + 1, i % 3 ? i : null);
  }
  for (let lot = 500; lot > 0; lot--) ensureLot(w.lots, lot, 9);
  w.month = 7;
  const c = structuredClone(w);
  expect(c).toEqual(w);
  c.projects.units[0] = 99;
  expect(w.projects.units[0]).toBe(0);
});
