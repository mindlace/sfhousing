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
    stepped: nope,
    data: nope,
    finalThrough: () => rows.length - 1,
    rows: (from, through) => rows.slice(from, through + 1)
  };
}

const world = (values: number[]) => stub(values.map((v) => row(v)));

describe('chunkOf', () => {
  it('mean and sample sd over four worlds, every field', () => {
    const vals = [10, 20, 30, 40];
    const plan = vals.map((v) => stub([row(v, 0, 0, v), row(v + 1, 0, 0, v), row(v + 2, 0, 0, v)]));
    const c = chunkOf(plan, plan, null, 0, 2);
    const sd = Math.sqrt(500 / 3);
    expect(c.from).toBe(0);
    expect(c.mean).toHaveLength(3);
    expect(c.mean[0].completedNet).toBeCloseTo(25, 12);
    expect(c.sd[0].completedNet).toBeCloseTo(sd, 12);
    expect(c.mean[1].completedNet).toBeCloseTo(26, 12);
    expect(c.sd[2].completedNet).toBeCloseTo(sd, 12);
    expect(c.mean[0].completedNetPipeline).toBeCloseTo(12.5, 12);
    expect(c.sd[0].completedNetPipeline).toBeCloseTo(sd / 2, 12);
    const ip = c.mean[0].inProgress as unknown as Record<string, number>;
    const ipSd = c.sd[0].inProgress as unknown as Record<string, number>;
    expect(ip.proposed).toBeCloseTo(25, 12);
    expect(ip.entitled).toBeCloseTo(50, 12);
    expect(ip.construction).toBe(0);
    expect(ipSd.proposed).toBeCloseTo(sd, 12);
    expect(ipSd.entitled).toBeCloseTo(2 * sd, 12);
    expect(ipSd.construction).toBe(0);
    expect(c.mean[0].exitedUnits).toBeCloseTo(26, 12);
    expect(c.sd[0].exitedUnits).toBeCloseTo(sd, 12);
  });

  it('shown is world 1', () => {
    const plan = [world([1, 2]), world([100, 200])];
    const c = chunkOf(plan, plan, null, 1, 1);
    expect(c.from).toBe(1);
    expect(c.shown).toEqual([row(2)]);
  });

  it('plan effect is the mean and sd of paired differences', () => {
    const diffs = [1, 2, 3, 6];
    const mk = (n: number, d: number) => stub([row(0, n + d, n * 2 + d)]);
    const plan = diffs.map((d, i) => mk(i * 10, d));
    const twin = diffs.map((_, i) => mk(i * 10, 0));
    const c = chunkOf(plan, twin, null, 0, 0);
    expect(c.planEffect).toHaveLength(1);
    expect(c.planEffect[0].mean.entitledNew).toBeCloseTo(3, 12);
    expect(c.planEffect[0].sd.entitledNew).toBeCloseTo(Math.sqrt(14 / 3), 12);
    expect(c.planEffect[0].mean.completedNetNew).toBeCloseTo(3, 12);
    expect(c.planEffect[0].sd.completedNetNew).toBeCloseTo(Math.sqrt(14 / 3), 12);
  });

  it('identical plan and twin give 0 plan effect', () => {
    const plan = [stub([row(1, 5, 7)]), stub([row(2, 9, 3)])];
    const c = chunkOf(plan, plan, null, 0, 0);
    expect(c.planEffect[0].mean.entitledNew === 0).toBe(true);
    expect(c.planEffect[0].mean.completedNetNew === 0).toBe(true);
    expect(c.planEffect[0].sd.entitledNew === 0).toBe(true);
    expect(c.planEffect[0].sd.completedNetNew === 0).toBe(true);
  });

  it('one world has sd 0', () => {
    const plan = [stub([row(5, 1, 2, 3)])];
    const c = chunkOf(plan, plan, null, 0, 0);
    expect(c.mean[0].completedNet).toBe(5);
    expect(c.sd[0].completedNet).toBe(0);
    expect(c.sd[0].exitedUnits).toBe(0);
    expect(c.planEffect[0].sd.completedNetNew).toBe(0);
  });

  it('mismatched ensembles throw', () => {
    expect(() => chunkOf([world([1]), world([2])], [world([1])], null, 0, 0)).toThrow();
    expect(() => chunkOf([], [], null, 0, 0)).toThrow();
  });

  it("a month past a world's finalThrough throws", () => {
    const short = [world([1, 2, 3]), world([1, 2])];
    const full = [world([1, 2, 3]), world([1, 2, 3])];
    expect(() => chunkOf(short, full, null, 0, 2)).toThrow();
    expect(() => chunkOf(full, short, null, 0, 2)).toThrow();
  });

  it('money and tiers are null without a feed', () => {
    const plan = [world([1]), world([2])];
    const c = chunkOf(plan, plan, null, 0, 0);
    expect(c.money).toBeNull();
    expect(c.tiers).toBeNull();
  });

  it('a feed throws until the world-funding merge', () => {
    const plan = [world([1])];
    expect(() => chunkOf(plan, plan, {} as MoneyFeed, 0, 0)).toThrow(
      'world-score: money before the world-funding merge'
    );
  });
});
