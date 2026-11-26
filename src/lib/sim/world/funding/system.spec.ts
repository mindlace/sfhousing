// The count of homes waiting for money and its record in the world (money-wait).
import { beforeAll, describe, expect, it } from 'vitest';
import { emptyWorld, ensureLot } from '../columns';
import { withFunding } from '../index';
import { staticsOf } from '../statics';
import { LOT_DONE, LOT_FREE, LOT_HELD, LOT_LIVE, type StepSink, type World } from '../types';
import { createFundingSystem } from './index';
import {
  KIND_AFFORDABLE,
  KIND_MARKET,
  addLineRow,
  fundOf,
  initFunding,
  waitingAt,
  type FundLine
} from './columns';
import { lineIndex } from './line-index';
import { fundedMini, oneMoneyTimeline } from './test/fixtures';
import { miniFinance, withFederalYearly } from '$lib/sim/scenario/fixtures/mini-finance';
import { recordWaiting, waitingHomes } from './system';

function lineWorld(): World {
  const w = emptyWorld(0);
  initFunding(w, ['city']);
  return w;
}

function addRow(w: World, lot: number, kind: number, units: number): number {
  const line = fundOf(w).line;
  const i = addLineRow(line);
  line.lot[i] = lot;
  line.kind[i] = kind;
  line.units[i] = units;
  line.stories[i] = 4;
  return i;
}

describe('waitingHomes', () => {
  it('counts 0 on an empty line and on a world without funding columns', () => {
    expect(waitingHomes(lineWorld())).toBe(0);
    expect(waitingHomes(emptyWorld(0))).toBe(0);
  });

  it('a row marked gone is not counted, including one marked after the index was built', () => {
    const w = lineWorld();
    const line = fundOf(w).line;
    addRow(w, 1, KIND_MARKET, 10);
    const b = addRow(w, 2, KIND_MARKET, 20);
    expect(waitingHomes(w)).toBe(30);
    lineIndex(line);
    line.gone[b] = 1;
    expect(waitingHomes(w)).toBe(10);
  });

  it('a lot with a market application of 10 and an affordable one of 30 counts 30', () => {
    const orders = [
      [
        [KIND_MARKET, 10],
        [KIND_AFFORDABLE, 30]
      ],
      [
        [KIND_AFFORDABLE, 30],
        [KIND_MARKET, 10]
      ]
    ];
    for (const order of orders) {
      const w = lineWorld();
      for (const [kind, units] of order) addRow(w, 5, kind, units);
      expect(waitingHomes(w)).toBe(30);
    }
  });

  it('a row whose lot is not free is not counted; a lot with no lot row is counted', () => {
    const w = lineWorld();
    [LOT_DONE, LOT_LIVE, LOT_HELD, LOT_FREE].forEach((state, k) => {
      const lot = 10 + k;
      const row = ensureLot(w.lots, lot, 0); // growing replaces the arrays: take the row first
      w.lots.state[row] = state;
      addRow(w, lot, KIND_MARKET, 1 << k);
    });
    addRow(w, 99, KIND_MARKET, 100);
    // Only the LOT_FREE lot (8 homes) and the lot with no lot row (100).
    expect(waitingHomes(w)).toBe(108);
  });
});

describe('recordWaiting', () => {
  it('throws for a month not after waitThrough', () => {
    const w = lineWorld();
    recordWaiting(w, 3);
    expect(() => recordWaiting(w, 3)).toThrow('recordWaiting: month 3 is not after month 3');
    expect(() => recordWaiting(w, 2)).toThrow('recordWaiting: month 2 is not after month 3');
  });

  it('a record after a gap fills the gap with the last value', () => {
    const w = lineWorld();
    addRow(w, 1, KIND_MARKET, 7);
    recordWaiting(w, 2);
    addRow(w, 2, KIND_MARKET, 5);
    recordWaiting(w, 6);
    w.month = 6;
    expect([0, 1, 2, 3, 4, 5, 6].map((m) => waitingAt(w, m))).toEqual([0, 0, 7, 7, 7, 7, 12]);
  });

  it("a fresh line's first record at month 5 reads 0 for months 0..4", () => {
    const w = lineWorld();
    addRow(w, 1, KIND_MARKET, 7);
    recordWaiting(w, 5);
    w.month = 5;
    expect([0, 1, 2, 3, 4, 5].map((m) => waitingAt(w, m))).toEqual([0, 0, 0, 0, 0, 7]);
  });

  it('does nothing on a world without funding columns', () => {
    const w = emptyWorld(0);
    recordWaiting(w, 3);
    expect(waitingHomes(w)).toBe(0);
  });
});

const MONTHS = 480;
const SEED = 1;
const CLONE_AT = 60;
const sink: StepSink = { event() {}, ledger() {} };

/** The reference count: a plain scan of the rows, a Map of lot to largest units. */
function reference(w: World): number {
  const line = w.line as FundLine;
  const byLot = new Map<number, number>();
  for (let i = 0; i < line.n; i++) {
    if (line.gone[i] === 1) continue;
    const lot = line.lot[i];
    const li = lot < w.lots.rowOf.length ? w.lots.rowOf[lot] - 1 : -1;
    if (li >= 0 && w.lots.state[li] !== LOT_FREE) continue;
    byLot.set(lot, Math.max(byLot.get(lot) ?? 0, line.units[i]));
  }
  let sum = 0;
  for (const u of byLot.values()) sum += u;
  return sum;
}

describe('the record on the capped mini', () => {
  const mismatches: number[] = [];
  const changedEarlier: number[] = [];
  const cloneMismatch: number[] = [];
  let max = 0;
  let cloneReadsSame = false;

  beforeAll(() => {
    const input = fundedMini();
    const statics = staticsOf(input);
    // A federal pool of 20,000,000 a year (as apply.spec.ts): pools run short, so rows wait.
    const timeline = oneMoneyTimeline(
      input,
      withFederalYearly(miniFinance(input.asOf), input.asOf, 20_000_000)
    );
    const core = withFunding(createFundingSystem());
    const w = core.createWorld(statics, timeline, SEED, sink);
    const due = core.planDue(w, statics, timeline, SEED, MONTHS);
    let prev: number[] = [];
    let clone: World | null = null;
    let cloneDue: ReturnType<typeof core.planDue> | null = null;
    for (let m = 1; m <= MONTHS; m++) {
      core.step(w, due, statics, timeline, SEED, sink);
      const now = waitingAt(w, w.month);
      if (now !== reference(w)) mismatches.push(m);
      max = Math.max(max, now);
      const snap: number[] = [];
      for (let k = 0; k <= w.month; k++) snap.push(waitingAt(w, k));
      if (prev.some((v, k) => v !== snap[k])) changedEarlier.push(m);
      prev = snap;
      if (clone !== null) {
        core.step(clone, cloneDue!, statics, timeline, SEED, sink);
        if (waitingAt(clone, clone.month) !== now) cloneMismatch.push(m);
      }
      if (m === CLONE_AT) {
        clone = structuredClone(w);
        cloneReadsSame = snap.every((v, k) => waitingAt(clone!, k) === v);
        cloneDue = core.planDue(clone, statics, timeline, SEED, MONTHS);
      }
    }
  });

  it('after every one of 480 steps waitingAt equals a reference scan', () => {
    expect(mismatches).toEqual([]);
    expect(max).toBeGreaterThan(0);
  });

  it("stepping a world never changes an earlier month's value", () => {
    expect(changedEarlier).toEqual([]);
  });

  it('a structuredClone reads the same values, and stepped on alike records the same', () => {
    expect(cloneReadsSame).toBe(true);
    expect(cloneMismatch).toEqual([]);
  });
});
