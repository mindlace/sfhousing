import { describe, expect, it } from 'vitest';
import type { Award } from './funding';
import { scanLine, type App, type AwardTest, type Line } from './line';

const PER_HOME = 100;

function app(lot: number, applied: number, key: number, over: Partial<App> = {}): App {
  return {
    lot,
    kind: 'market',
    applied,
    key,
    bundle: [0],
    bundleKey: '0',
    protoId: 'midrise' as App['protoId'],
    units: 1,
    level: 1,
    view: 0,
    f: 1,
    stories: 5,
    keyDay: applied,
    seq: 0,
    ...over
  };
}

/** A fake award rule over a money map: a bundle asks `units * PER_HOME` of its first pool. */
function fake(money: Map<number, number>): { test: AwardTest; deduct: (a: App, w: Award) => void } {
  const test: AwardTest = (g, units) => {
    const pool = g.bundle[0];
    const ask = units * PER_HOME;
    if (ask > (money.get(pool) ?? 0)) return null;
    return { set: [...g.bundle], priced: {} as Award['priced'], asks: new Map([[pool, ask]]) };
  };
  const deduct = (_a: App, w: Award) => {
    for (const [q, d] of w.asks) money.set(q, (money.get(q) ?? 0) - d);
  };
  return { test, deduct };
}

function run(line: Line, money: Map<number, number>, onTake?: (a: App) => void) {
  const { test, deduct } = fake(money);
  const taken: App[] = [];
  const n = line.serve(test, (a, w) => {
    deduct(a, w);
    taken.push(a);
    line.remove(a);
    onTake?.(a);
  });
  return { n, taken };
}

describe('scanLine', () => {
  it('serves in (applied, key) order', () => {
    const line = scanLine();
    const a = app(1, 10, 5);
    const b = app(2, 10, 7);
    const c = app(3, 12, 1);
    [a, b, c].forEach((x) => line.add(x));
    const { taken } = run(line, new Map([[0, 1e9]]));
    expect(taken.map((x) => x.lot)).toEqual([1, 2, 3]);
  });

  it('skips a head that does not fit and awards a later smaller one in the same pass', () => {
    const line = scanLine();
    line.add(app(1, 1, 1, { units: 10 }));
    line.add(app(2, 1, 2, { units: 2 }));
    const { n, taken } = run(line, new Map([[0, 500]]));
    expect(n).toBe(1);
    expect(taken.map((x) => x.lot)).toEqual([2]);
    expect(line.apps().map((x) => x.lot)).toEqual([1]);
    expect(line.size).toBe(1);
  });

  it('awards a later application leaning on another pool past a waiting head', () => {
    const line = scanLine();
    line.add(app(1, 1, 1, { bundle: [0] }));
    line.add(app(2, 1, 2, { bundle: [1] }));
    const { taken } = run(
      line,
      new Map([
        [0, 0],
        [1, 1000]
      ])
    );
    expect(taken.map((x) => x.lot)).toEqual([2]);
  });

  it('does not award an application a take removed mid-pass', () => {
    const line = scanLine();
    const first = app(1, 1, 1, { kind: 'market' });
    const second = app(1, 1, 2, { kind: 'affordable' });
    const third = app(2, 1, 3);
    [first, second, third].forEach((x) => line.add(x));
    const { n, taken } = run(line, new Map([[0, 1e9]]), (a) => {
      if (a === first) line.remove(second);
    });
    expect(n).toBe(2);
    expect(taken.map((x) => x.lot)).toEqual([1, 2]);
    expect(taken).not.toContain(second);
    expect(line.size).toBe(0);
  });

  it('remove and regroup keep the order', () => {
    const line = scanLine();
    const xs = [1, 2, 3, 4].map((i) => app(i, 1, i));
    xs.forEach((x) => line.add(x));
    line.remove(xs[1]);
    line.regroup(xs[2]);
    expect(line.apps().map((x) => x.lot)).toEqual([1, 3, 4]);
    expect(line.size).toBe(3);
  });

  it('compacts after many removals and keeps the order', () => {
    const line = scanLine();
    const xs = Array.from({ length: 20 }, (_, i) => app(i, 1, i));
    xs.forEach((x) => line.add(x));
    xs.slice(0, 15).forEach((x) => line.remove(x));
    const { taken } = run(line, new Map([[0, 1e9]]));
    expect(taken.map((x) => x.lot)).toEqual([15, 16, 17, 18, 19]);
  });

  it('add out of order throws', () => {
    const line = scanLine();
    line.add(app(1, 5, 10));
    expect(() => line.add(app(2, 5, 9))).toThrow();
    expect(() => line.add(app(3, 4, 99))).toThrow();
    line.add(app(4, 5, 10));
    expect(line.size).toBe(2);
  });

  it('serve returns the award count', () => {
    const line = scanLine();
    [1, 2, 3].forEach((i) => line.add(app(i, 1, i)));
    const { n } = run(line, new Map([[0, 250]]));
    expect(n).toBe(2);
  });
});
