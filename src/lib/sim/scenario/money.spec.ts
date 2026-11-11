import { describe, expect, it } from 'vitest';
import { projectDollars, resolveTerms } from '../finance';
import type { Day } from '$lib/timelapse/time';
import type { Pool, Programme } from '$lib/timelapse/types';
import { dayOf } from './dates';
import { awardSet, financeIndexOf, type Award } from './funding';
import { Treasury, type LedgerEvent } from './money';
import { checkLedger } from './test/finance-harness';
import type { Schedule, SimInput } from './types';

type Finance = NonNullable<SimInput['finance']>;

const A = dayOf(2026, 1, 1);
const HORIZON = A + 1000;
const UNITS = 10;
const BIG = 1_000_000_000_000;

const pool = (id: string, kind: Pool['kind'], inflows: Pool['inflows']): Pool => ({
  id,
  kind,
  label: id,
  inflows,
  uncapped: false,
  debt: kind === 'goBond' ? { rate: 0.04, termYears: 30 } : null,
  leverage: 1
});
const prog = (id: string, poolId: string, instrument: Programme['instrument']): Programme => ({
  id,
  label: id,
  pool: poolId,
  reach: 'market',
  instrument,
  from: A,
  to: null,
  minHomes: 1,
  tiers: null
});
const ample = (): Pool['inflows'] => [{ kind: 'once', day: A, dollars: BIG }];
const own = (inflows: Pool['inflows']): Pool['inflows'] => inflows.map((x) => ({ ...x }));

function finance(inflows: Pool['inflows'] = ample()): Finance {
  return {
    pools: [
      pool('p-grant', 'generalRevenue', own(inflows)),
      pool('p-loan', 'goBond', own(inflows)),
      pool('p-guar', 'state', own(inflows))
    ],
    programmes: [
      prog('g-grant', 'p-grant', { kind: 'grant', share: 0.5 }),
      prog('g-loan', 'p-loan', { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null }),
      prog('g-guar', 'p-guar', { kind: 'guarantee', costShare: 0.5, reserve: 0.1 })
    ],
    off: [],
    slope: 3,
    terms: resolveTerms(undefined, { guaranteeRateCut: 0.01 })
  };
}

function schedule(entered: Schedule['entered'], end: Schedule['end'], units = UNITS): Schedule {
  return {
    projectId: 's',
    origin: 'simulated',
    parcelIds: [],
    pathway: 'ministerial',
    entered,
    end,
    revisions: [{ day: A, units, stories: null }],
    existingUnits: 0,
    multiPhase: false,
    phase: null
  } as unknown as Schedule;
}

const complete = (day: Day) => schedule({ construction: A + 100 }, { kind: 'complete', day });
const exitBefore = (day: Day) =>
  schedule({}, {
    kind: 'exit',
    stage: 'preApplication',
    reason: 'withdrawn',
    day
  } as Schedule['end']);
const exitAfter = (day: Day) =>
  schedule({ construction: A + 100 }, {
    kind: 'exit',
    stage: 'construction',
    reason: 'withdrawn',
    day
  } as Schedule['end']);

function awardOf(fin: Finance, bundle: number[]): Award {
  const f = financeIndexOf(fin);
  const a = awardSet(bundle, 'market', 'B', UNITS, () => Infinity, f);
  if (!a) throw new Error('no award');
  return a;
}

interface Run {
  events: LedgerEvent[];
  t: Treasury;
  states: string[];
}

/** Receives, awards each of `awards` on A, then settles every woken day in order. */
function run(
  fin: Finance,
  lambda: number,
  awards: { a: Award; s: Schedule }[],
  opts: { horizon?: Day; emit?: boolean } = {}
): Run {
  const events: LedgerEvent[] = [];
  const woken = new Set<Day>();
  const t = new Treasury(
    financeIndexOf(fin),
    A,
    opts.horizon ?? HORIZON,
    lambda,
    opts.emit === false ? null : (e) => events.push(e),
    (d) => woken.add(d)
  );
  const states: string[] = [];
  const snap = () => states.push(JSON.stringify(t.state));
  t.receive(A);
  t.settle(A);
  for (const { a, s } of awards) t.award(A, a, UNITS, s);
  snap();
  for (const d of [...woken].filter((x) => x > A).sort((x, y) => x - y)) {
    t.receive(d);
    t.settle(d);
    snap();
  }
  t.settle(A);
  return { events, t, states };
}

const rows = (events: LedgerEvent[]) =>
  events.map((e) => [e.day - A, e.pool, e.programme, e.kind, e.dollars] as const);
const noIn = (events: LedgerEvent[]) => events.filter((e) => e.kind !== 'in');

describe('Treasury event table', () => {
  const fin = finance();
  for (const lambda of [1, 0.5]) {
    const dollars = (i: number) => {
      const a = awardOf(fin, [i]);
      const it = a.priced.items[0];
      return {
        a,
        G: projectDollars(it.granted, UNITS),
        P: projectDollars(it.lent, UNITS),
        H: projectDollars(it.reserve, UNITS),
        Q: projectDollars(it.guaranteed, UNITS)
      };
    };
    describe(`lossOnExit ${lambda}`, () => {
      it('grant', () => {
        const { a, G } = dollars(0);
        expect(G).toBeGreaterThan(0);
        const base = [0, 'p-grant', 'g-grant', 'commit', G] as const;
        const ev = (s: Schedule) => rows(noIn(run(fin, lambda, [{ a, s }]).events));
        expect(ev(complete(A + 500))).toEqual([base, [100, 'p-grant', 'g-grant', 'spend', G]]);
        expect(ev(exitBefore(A + 50))).toEqual([base, [50, 'p-grant', 'g-grant', 'release', G]]);
        const loss = Math.round(lambda * G);
        expect(ev(exitAfter(A + 300))).toEqual([
          base,
          [100, 'p-grant', 'g-grant', 'spend', G],
          [300, 'p-grant', 'g-grant', 'loss', loss]
        ]);
      });
      it('loan', () => {
        const { a, P } = dollars(1);
        expect(P).toBeGreaterThan(0);
        const base = [0, 'p-loan', 'g-loan', 'commit', P] as const;
        const spend = [100, 'p-loan', 'g-loan', 'spend', P] as const;
        const ev = (s: Schedule) => rows(noIn(run(fin, lambda, [{ a, s }]).events));
        expect(ev(complete(A + 500))).toEqual([base, spend, [500, 'p-loan', 'g-loan', 'repay', P]]);
        expect(ev(exitBefore(A + 50))).toEqual([base, [50, 'p-loan', 'g-loan', 'release', P]]);
        const L = Math.round(lambda * P);
        const after: (readonly [number, string, string, string, number])[] = [base, spend];
        if (P - L > 0) after.push([300, 'p-loan', 'g-loan', 'repay', P - L]);
        if (L > 0) after.push([300, 'p-loan', 'g-loan', 'loss', L]);
        expect(ev(exitAfter(A + 300))).toEqual(after);
      });
      it('guarantee', () => {
        const { a, H, Q } = dollars(2);
        expect(H).toBeGreaterThan(0);
        const base = [0, 'p-guar', 'g-guar', 'commit', H] as const;
        const ev = (s: Schedule) => rows(noIn(run(fin, lambda, [{ a, s }]).events));
        expect(ev(complete(A + 500))).toEqual([base, [500, 'p-guar', 'g-guar', 'release', H]]);
        expect(ev(exitBefore(A + 50))).toEqual([base, [50, 'p-guar', 'g-guar', 'release', H]]);
        const X = Math.min(Math.round(lambda * Q), H);
        expect(X).toBeGreaterThan(0);
        expect(ev(exitAfter(A + 300))).toEqual([
          base,
          [300, 'p-guar', 'g-guar', 'loss', X],
          [300, 'p-guar', 'g-guar', 'release', H]
        ]);
        if (lambda === 1) expect(X).toBe(H);
      });
      it('the ledger passes the identities, with the engine values probed', () => {
        for (const s of [complete(A + 500), exitBefore(A + 50), exitAfter(A + 300)]) {
          const a = awardOf(fin, [0, 1, 2]);
          const events: LedgerEvent[] = [];
          const probes: { after: number; available: number[] }[] = [];
          const woken = new Set<Day>();
          const t: Treasury = new Treasury(
            financeIndexOf(fin),
            A,
            HORIZON,
            lambda,
            (e) => {
              events.push(e);
              probes.push({
                after: events.length - 1,
                available: [0, 1, 2].map((q) => t.available(q))
              });
            },
            (d) => woken.add(d)
          );
          t.receive(A);
          t.award(A, a, UNITS, s);
          for (const d of [...woken].sort((x, y) => x - y)) {
            t.receive(d);
            t.settle(d);
          }
          expect(events.length).toBeGreaterThan(4);
          checkLedger(events, fin, probes);
        }
      });
    });
  }

  it('emits nothing after the horizon, and no zero-dollar event', () => {
    const a = awardOf(fin, [0, 1, 2]);
    const r = run(fin, 1, [{ a, s: complete(A + 500) }], { horizon: A + 400 });
    expect(r.events.every((e) => e.day <= A + 400)).toBe(true);
    expect(noIn(r.events).map((e) => e.kind)).toEqual([
      'commit',
      'commit',
      'commit',
      'spend',
      'spend'
    ]);
    // lambda 1: the loan repays nothing after construction; a zero-dollar repay is not emitted
    const r1 = run(fin, 1, [{ a: awardOf(fin, [1]), s: exitAfter(A + 300) }]);
    expect(r1.events.filter((e) => e.kind === 'repay')).toEqual([]);
    expect(r1.events.every((e) => e.dollars > 0)).toBe(true);
  });
});

describe('Treasury order within a day', () => {
  it('in, in, A, B, then the commits', () => {
    const day = A + 200;
    const fin = finance([{ kind: 'once', day: A, dollars: BIG }]);
    fin.pools[0].inflows.push({ kind: 'once', day, dollars: 7 });
    fin.pools[2].inflows.push({ kind: 'once', day, dollars: 9 });
    const f = financeIndexOf(fin);
    const events: LedgerEvent[] = [];
    const woken = new Set<Day>();
    const t = new Treasury(
      f,
      A,
      HORIZON,
      0.5,
      (e) => events.push(e),
      (d) => woken.add(d)
    );
    t.receive(A);
    // both projects end on `day`: A completes (loan and guarantee), B exits after construction
    t.award(A, awardOf(fin, [1, 2]), UNITS, complete(day));
    t.award(A, awardOf(fin, [0, 1]), UNITS, exitAfter(day));
    const before = events.length;
    t.settle(A + 100);
    expect(woken.has(day)).toBe(true);
    const mark = events.length;
    expect(t.receive(day)).toBe(true);
    const out = t.settle(day);
    expect(out).toEqual({ any: true, returned: true });
    t.award(day, awardOf(fin, [0]), UNITS, complete(day + 50));
    expect(before).toBeGreaterThan(0);
    const today = events.slice(mark).map((e) => `${e.kind}:${e.programme ?? e.pool}`);
    expect(today).toEqual([
      'in:p-grant',
      'in:p-guar',
      // project A: loan repay, guarantee release
      'repay:g-loan',
      'release:g-guar',
      // project B: repay, then the losses by programme
      'repay:g-loan',
      'loss:g-grant',
      'loss:g-loan',
      'commit:g-grant'
    ]);
  });

  it('zero-day stages: commit, spend, loss, release on the award day', () => {
    const fin = finance();
    const a = awardOf(fin, [0, 2]);
    const s = schedule({ construction: A }, {
      kind: 'exit',
      stage: 'construction',
      reason: 'withdrawn',
      day: A
    } as Schedule['end']);
    const events: LedgerEvent[] = [];
    const woken = new Set<Day>();
    const t = new Treasury(
      financeIndexOf(fin),
      A,
      HORIZON,
      1,
      (e) => events.push(e),
      (d) => woken.add(d)
    );
    t.receive(A);
    t.award(A, a, UNITS, s);
    expect(woken.has(A)).toBe(true);
    const res = t.settle(A);
    expect(res).toEqual({ any: true, returned: true });
    expect(noIn(events).map((e) => `${e.kind}:${e.programme}`)).toEqual([
      'commit:g-grant',
      'commit:g-guar',
      'spend:g-grant',
      'loss:g-grant',
      'loss:g-guar',
      'release:g-guar'
    ]);
    expect(events.every((e) => e.day === A)).toBe(true);
  });
});

describe('Treasury inflows', () => {
  it('an arrival on an off day emits nothing and leaves received unchanged', () => {
    const fin = finance([
      { kind: 'once', day: A + 10, dollars: 100 },
      { kind: 'once', day: A + 20, dollars: 50 }
    ]);
    fin.off = [
      { pool: 'p-grant', from: A + 5, to: A + 15, label: 'off' } as Finance['off'][number]
    ];
    const r = run(fin, 1, []);
    const ins = r.events.filter((e) => e.kind === 'in' && e.pool === 'p-grant');
    expect(rows(ins)).toEqual([[20, 'p-grant', null, 'in', 50]]);
    expect(r.t.state[0].received).toBe(50);
    expect(r.t.state[1].received).toBe(150);
  });

  it('zero-dollar arrivals emit nothing and uncapped pools get none', () => {
    const fin = finance([{ kind: 'once', day: A, dollars: 0 }]);
    const r = run(fin, 1, []);
    expect(r.events).toEqual([]);
    expect(r.t.receive(A + 1)).toBe(false);
  });
});

describe('Treasury without a sink', () => {
  it('keeps identical pool states', () => {
    const fin = finance();
    for (const s of [complete(A + 500), exitBefore(A + 50), exitAfter(A + 300)]) {
      const a = awardOf(fin, [0, 1, 2]);
      const withSink = run(fin, 0.5, [{ a, s }]);
      const without = run(fin, 0.5, [{ a, s }], { emit: false });
      expect(without.events).toEqual([]);
      expect(without.states).toEqual(withSink.states);
      expect(withSink.events.length).toBeGreaterThan(0);
    }
  });
});

describe('checkLedger', () => {
  it('fails a release larger than the commit', () => {
    const fin = finance();
    const ev = (kind: LedgerEvent['kind'], dollars: number, programme: string | null = 'g-grant') =>
      ({
        day: A,
        pool: programme === null ? 'p-grant' : 'p-grant',
        programme,
        kind,
        dollars
      }) as LedgerEvent;
    const good = [ev('in', 100, null), ev('commit', 10), ev('release', 10)];
    expect(() => checkLedger(good, fin)).not.toThrow();
    const bad = [ev('in', 100, null), ev('commit', 10), ev('release', 11)];
    expect(() => checkLedger(bad, fin)).toThrow();
  });
});
