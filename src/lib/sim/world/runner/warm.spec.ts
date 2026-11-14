// The warm-ahead queue (plan D12): one (row, revision) per unit.
import { describe, expect, it } from 'vitest';
import type { Schedule } from '$lib/sim/scenario/types';
import { createWarmQueue } from './warm';

/** A stub schedule with `n` revisions; the queue reads only `revisions.length`. */
const sched = (id: string, n: number) =>
  ({
    projectId: id,
    revisions: Array.from({ length: n }, (_, k) => ({ k }))
  }) as unknown as Schedule;

describe('createWarmQueue', () => {
  it('a row with two revisions takes two units, one massing each', () => {
    const massed: [string, number][] = [];
    const rows = new Map([
      [3, sched('a', 2)],
      [5, sched('b', 1)]
    ]);
    const q = createWarmQueue(
      (row) => rows.get(row) ?? null,
      (s, k) => massed.push([s.projectId, k])
    );
    q.add(3);
    q.add(5);
    const perUnit: number[] = [];
    while (q.pending()) {
      const before = massed.length;
      q.unit();
      perUnit.push(massed.length - before);
    }
    expect(perUnit).toEqual([1, 1, 1]);
    expect(massed).toEqual([
      ['a', 0],
      ['a', 1],
      ['b', 0]
    ]);
  });

  it('reads the schedule again at each unit and drops a row that cannot be massed', () => {
    let s: Schedule | null = sched('a', 3);
    const massed: number[] = [];
    const q = createWarmQueue(
      () => s,
      (_, k) => massed.push(k)
    );
    q.add(1);
    q.unit();
    s = null; // the cell is not ready any more (or the world was replaced)
    q.unit();
    expect(q.pending()).toBe(false);
    expect(massed).toEqual([0]);
    q.add(1);
    q.clear();
    expect(q.pending()).toBe(false);
  });
});
