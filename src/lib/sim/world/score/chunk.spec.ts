import { describe, expect, it } from 'vitest';
import { chunkOf } from './chunk';
import type { MoneyFeed, MonthRow, WorldSeries } from './types';

function row(completedNet: number, entitledNew = 0, completedNetNew = 0, stage = 0): MonthRow {
  return {
    completedNet,
    completedNetPipeline: completedNet / 2,
    completedNetNew,
    entitledNew,
    inProgress: {
      proposed: stage,
      entitled: stage * 2,
      construction: 0
    } as unknown as MonthRow['inProgress'],
    exitedUnits: stage + 1
  };
}

function stub(rows: MonthRow[]): WorldSeries {
  const nope = () => {
    throw new Error('stub');
  };
  return {
    add: nope,
    created: nope,
    stepped: nope,
    data: nope,
    finalThrough: () => rows.length - 1,
    rows: (from, through) => rows.slice(from, through + 1)
  };
}

const world = (values: number[]) => stub(values.map((v) => row(v)));

describe('chunkOf', () => {
  it("rows are the plan world's own rows", () => {
    const c = chunkOf(world([1, 2]), world([9, 9]), null, 1, 1);
    expect(c.from).toBe(1);
    expect(c.rows).toEqual([row(2)]);
  });

  it('plan effect is plan minus twin, month by month', () => {
    const c = chunkOf(stub([row(0, 5, 3)]), stub([row(0, 7, 10)]), null, 0, 0);
    expect(c.planEffect).toEqual([{ entitledNew: -2, completedNetNew: -7 }]);
  });

  it('identical plan and twin give exactly 0', () => {
    const plan = stub([row(1, 5, 7), row(2, 9, 3)]);
    const c = chunkOf(plan, plan, null, 0, 1);
    for (const p of c.planEffect) {
      expect(Object.is(p.entitledNew, 0)).toBe(true);
      expect(Object.is(p.completedNetNew, 0)).toBe(true);
    }
  });

  it('a chunk holds rows, the effect, money, tiers, cars and waiting only', () => {
    const plan = world([1]);
    expect(Object.keys(chunkOf(plan, plan, null, 0, 0)).sort()).toEqual([
      'cars',
      'from',
      'money',
      'planEffect',
      'rows',
      'tiers',
      'waiting'
    ]);
  });

  it("a month past either world's finalThrough throws", () => {
    const short = world([1, 2]);
    const full = world([1, 2, 3]);
    expect(() => chunkOf(short, full, null, 0, 2)).toThrow();
    expect(() => chunkOf(full, short, null, 0, 2)).toThrow();
  });

  it('money, tiers and waiting are null without a feed', () => {
    const plan = world([1]);
    const c = chunkOf(plan, plan, null, 0, 0);
    expect(c.money).toBeNull();
    expect(c.tiers).toBeNull();
    expect(c.waiting).toBeNull();
  });

  it('a feed with a plan world that is not a WorldSeries of createWorldSeries throws', () => {
    const plan = world([1]);
    expect(() => chunkOf(plan, plan, {} as MoneyFeed, 0, 0)).toThrow(
      'world-score: not a series of createWorldSeries'
    );
  });
});
