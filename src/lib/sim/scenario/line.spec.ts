import { describe, expect, it } from 'vitest';
import { PROTOTYPES } from '../finance/prototypes';
import { tinyStack } from './fixtures/tiny-queue';
import { awardSet, financeIndexOf, type Award } from './funding';
import type { SimInput } from './types';
import {
  groupedLine,
  scanLine,
  type App,
  type AwardProbe,
  type AwardTest,
  type Line
} from './line';

const PER_HOME = 100;

type Finance = NonNullable<SimInput['finance']>;

function app(lot: number, applied: number, key: number, over: Partial<App> = {}): App {
  return {
    lot,
    kind: 'market',
    applied,
    key,
    bundle: [0],
    // the line key's contract: bundleKey is the bundle joined
    bundleKey: (over.bundle ?? [0]).join(','),
    protoId: 'midrise' as App['protoId'],
    units: 1,
    level: 1,
    view: 0,
    f: 1,
    stories: 5,
    keyDay: applied,
    seq: 0,
    lgr: null,
    lgi: -1,
    lk: -1,
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

const IMPLS: [string, () => Line][] = [
  ['scanLine', scanLine],
  ['groupedLine', () => groupedLine((b) => b)]
];

for (const [name, makeLine] of IMPLS) {
  describe(name, () => {
    it('serves in (applied, key) order', () => {
      const line = makeLine();
      const a = app(1, 10, 5);
      const b = app(2, 10, 7);
      const c = app(3, 12, 1);
      [a, b, c].forEach((x) => line.add(x));
      const { taken } = run(line, new Map([[0, 1e9]]));
      expect(taken.map((x) => x.lot)).toEqual([1, 2, 3]);
    });

    it('skips a head that does not fit and awards a later smaller one in the same pass', () => {
      const line = makeLine();
      line.add(app(1, 1, 1, { units: 10 }));
      line.add(app(2, 1, 2, { units: 2 }));
      const { n, taken } = run(line, new Map([[0, 500]]));
      expect(n).toBe(1);
      expect(taken.map((x) => x.lot)).toEqual([2]);
      expect(line.apps().map((x) => x.lot)).toEqual([1]);
      expect(line.size).toBe(1);
    });

    it('awards a later application leaning on another pool past a waiting head', () => {
      const line = makeLine();
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
      const line = makeLine();
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
      const line = makeLine();
      const xs = [1, 2, 3, 4].map((i) => app(i, 1, i));
      xs.forEach((x) => line.add(x));
      line.remove(xs[1]);
      line.regroup(xs[2]);
      expect(line.apps().map((x) => x.lot)).toEqual([1, 3, 4]);
      expect(line.size).toBe(3);
    });

    it('compacts after many removals and keeps the order', () => {
      const line = makeLine();
      const xs = Array.from({ length: 20 }, (_, i) => app(i, 1, i));
      xs.forEach((x) => line.add(x));
      xs.slice(0, 15).forEach((x) => line.remove(x));
      const { taken } = run(line, new Map([[0, 1e9]]));
      expect(taken.map((x) => x.lot)).toEqual([15, 16, 17, 18, 19]);
    });

    it('add out of order throws', () => {
      const line = makeLine();
      line.add(app(1, 5, 10));
      expect(() => line.add(app(2, 5, 9))).toThrow();
      expect(() => line.add(app(3, 4, 99))).toThrow();
      line.add(app(4, 5, 10));
      expect(line.size).toBe(2);
    });

    it('serve returns the award count', () => {
      const line = makeLine();
      [1, 2, 3].forEach((i) => line.add(app(i, 1, i)));
      const { n } = run(line, new Map([[0, 250]]));
      expect(n).toBe(2);
    });
  });
}

describe('groupedLine keeps its own record of each application’s group', () => {
  it('size counts live applications after remove and regroup', () => {
    const line = groupedLine((b) => b);
    const xs = [1, 2, 3, 4, 5].map((i) => app(i, 1, i, { bundle: [0], bundleKey: '0' }));
    xs.forEach((x) => line.add(x));
    line.remove(xs[0]);
    line.remove(xs[3]);
    // a removed application removed again changes nothing
    line.remove(xs[0]);
    Object.assign(xs[2], { bundle: [1], bundleKey: '1' });
    line.regroup(xs[2]);
    expect(line.size).toBe(3);
    // the rebuild before serving keeps the count
    const { taken } = run(line, new Map([[0, 0]]));
    expect(taken).toEqual([]);
    expect(line.size).toBe(3);
    expect(line.apps().map((x) => x.lot)).toEqual([2, 3, 5]);
  });

  it('regroup after the fields are overwritten moves the application to its new group', () => {
    const line = groupedLine((b) => b);
    const a = app(1, 1, 1, { bundle: [0], bundleKey: '0' });
    const b = app(2, 1, 2, { bundle: [0], bundleKey: '0' });
    line.add(a);
    line.add(b);
    // the engine overwrites the fields first, then regroups
    Object.assign(a, { bundle: [1], bundleKey: '1', units: 3 });
    line.regroup(a);
    const money = new Map([
      [0, 0],
      [1, 300]
    ]);
    const { taken } = run(line, money);
    expect(taken.map((x) => x.lot)).toEqual([1]);
    expect(money.get(1)).toBe(0);
    // a regrouped application removed before the next serve is gone from both groups
    Object.assign(b, { bundle: [1], bundleKey: '1' });
    line.regroup(b);
    line.remove(b);
    expect(run(line, new Map([[1, 1e9]])).taken).toEqual([]);
    expect(line.size).toBe(0);
  });
});

/** A seeded uniform in [0, 1) (mulberry32). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('scanLine and groupedLine agree (property, spec 6)', () => {
  // tinyStack's pools with a bond, and a market loan on the City pool for market groups
  const base = tinyStack({
    asOf: 0,
    bond: { share: 0.5, from: 0, inflows: [] }
  });
  const fin: Finance = {
    ...base,
    programmes: [
      ...base.programmes,
      {
        id: 't-loan',
        label: 't-loan',
        pool: 't-city',
        reach: 'market',
        instrument: { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null },
        from: 0,
        to: null,
        minHomes: 1,
        tiers: { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0 }
      }
    ]
  };
  const f = financeIndexOf(fin);
  const capped = fin.pools.map((_, q) => q).filter((q) => f.capped[q]);
  const poolsOf = (b: readonly number[]) => [
    ...new Set(b.map((g) => f.progPool[g]).filter((q) => f.capped[q]))
  ];
  const AFF = [0, 1, 2, 3];
  const CITY_HOME = 300027;

  function randomBundle(r: () => number, kind: App['kind']): number[] {
    if (kind === 'market') return r() < 0.7 ? [4] : [1, 4];
    const b = AFF.filter(() => r() < 0.6);
    return b.length > 0 ? b : [2];
  }

  function randomApp(r: () => number, lot: number, applied: number, key: number): App {
    const kind: App['kind'] = r() < 0.3 ? 'market' : 'affordable';
    const bundle = randomBundle(r, kind);
    const protoId = PROTOTYPES[Math.floor(r() * PROTOTYPES.length)].id;
    return app(lot, applied, key, {
      kind,
      bundle,
      bundleKey: bundle.join(','),
      protoId,
      units: 1 + Math.floor(r() * (r() < 0.2 ? 200 : 40))
    });
  }

  /** Runs the same operations on one line; returns every award with its set and pass. */
  function play(seed: number, makeLine: () => Line, probe = false) {
    const r = rng(seed);
    const line = makeLine();
    const money = new Map<number, number>();
    for (const q of capped) money.set(q, Math.floor(r() * CITY_HOME * 120));
    const avail = (q: number) => money.get(q) ?? 0;
    const test: AwardTest = (g, units) => awardSet(g.bundle, g.kind, g.protoId, units, avail, f);
    const passes: AwardProbe | undefined = probe ? (g, u) => test(g, u) !== null : undefined;
    const all: App[] = [];
    const out: [number, number, number, string, number[]][] = [];
    let applied = 0;
    let key = 0;
    let lot = 0;
    const addSome = (n: number) => {
      applied += Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        key += 1 + Math.floor(r() * 3);
        const a = randomApp(r, lot, applied, key);
        all.push(a);
        line.add(a);
        // sometimes the lot's other kind too
        if (r() < 0.2) {
          key += 1;
          const b = randomApp(r, lot, applied, key);
          b.kind = a.kind === 'market' ? 'affordable' : 'market';
          b.bundle = randomBundle(r, b.kind);
          b.bundleKey = b.bundle.join(',');
          all.push(b);
          line.add(b);
        }
        lot++;
      }
    };
    const live = () => all.filter((a) => line.apps().includes(a));
    for (let pass = 0; pass < 4; pass++) {
      addSome(5 + Math.floor(r() * 40));
      // re-pricing: overwrite some fields, then regroup
      if (pass > 0) {
        for (const a of live()) {
          if (r() < 0.3) {
            a.bundle = randomBundle(r, a.kind);
            a.bundleKey = a.bundle.join(',');
            a.units = 1 + Math.floor(r() * 60);
            line.regroup(a);
          }
        }
        for (const a of live()) if (r() < 0.05) line.remove(a);
        for (const q of capped) money.set(q, avail(q) + Math.floor(r() * CITY_HOME * 60));
      }
      const take = (p: number) => (a: App, w: Award) => {
        for (const [q, d] of w.asks) money.set(q, avail(q) - d);
        out.push([p, a.lot, a.key, a.kind, w.set]);
        for (const x of all) if (x.lot === a.lot) line.remove(x);
      };
      const n = line.serve(test, take(pass), false, passes);
      expect(n).toBe(out.filter((o) => o[0] === pass).length);
      // `keep`: the money moved only by the pass's own awards; some applications join, some
      // leave, and the grouped line keeps the thresholds of the groups no member joined
      addSome(Math.floor(r() * 6));
      for (const a of live()) if (r() < 0.05) line.remove(a);
      line.serve(test, take(pass + 0.5), true, passes);
    }
    return { out, money: [...money], left: line.apps().map((a) => a.key) };
  }

  it('500 random lines: the same awards, in the same order, with the same sets', () => {
    let awards = 0;
    let waiting = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const scan = play(seed, scanLine);
      const grouped = play(seed, () => groupedLine(poolsOf));
      expect(grouped, `seed ${seed}`).toEqual(scan);
      // the same with the serving probe
      const probed = play(seed, () => groupedLine(poolsOf), true);
      expect(probed, `seed ${seed} (probe)`).toEqual(scan);
      awards += scan.out.length;
      waiting += scan.left.length;
    }
    // both outcomes are common: many awards, and many applications left waiting past them
    expect(awards).toBeGreaterThan(500);
    expect(waiting).toBeGreaterThan(500);
  });
});
