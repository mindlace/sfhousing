// The line's compaction is amortized (perf, Task 12): `compact` drops the `gone` rows only when
// they are at least an eighth of a line of `COMPACT_MIN` rows or more; a shorter line is compacted
// whenever it holds one. The rule reads only the line's own columns, so a cloned world (cold
// caches) compacts in the same months as the original and the worlds stay equal.
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { emptyWorld } from '../columns';
import { staticsOf } from '../statics';
import { benchInput } from '../test/cities.node';
import type { Due, StepSink, World } from '../types';
import { withFunding } from '../world';
import { leaveLine } from './apply';
import { KIND_AFFORDABLE, addLineRow, fundOf, initFunding, type FundLine } from './columns';
import { COMPACT_MIN, compact, isWaiting } from './line-index';
import { createFundingSystem } from './system';
import { benchMoney, oneMoneyTimeline, type MonthEvent } from './test/fixtures';

/** A funded line of `n` rows, row i on lot i. */
function lineOf(n: number): FundLine {
  const w = emptyWorld(0);
  initFunding(w, ['p']);
  const { line } = fundOf(w);
  for (let i = 0; i < n; i++) {
    const r = addLineRow(line);
    line.lot[r] = i;
    line.kind[r] = KIND_AFFORDABLE;
  }
  return line;
}

const goneOf = (line: FundLine) => line.gone.subarray(0, line.n).reduce((a, g) => a + g, 0);

describe('amortized compaction', () => {
  it('a long line keeps its gone rows until they are an eighth of it', () => {
    const n = COMPACT_MIN * 2;
    const line = lineOf(n);
    const share = n / 8;
    for (let lot = 0; lot < share - 1; lot++) leaveLine(line, lot * 3);
    compact(line);
    expect(line.n).toBe(n);
    expect(goneOf(line)).toBe(share - 1);
    expect(isWaiting(line, 0, KIND_AFFORDABLE)).toBe(false);
    expect(isWaiting(line, 1, KIND_AFFORDABLE)).toBe(true);
    leaveLine(line, n - 1);
    compact(line);
    expect(line.n).toBe(n - share);
    expect(goneOf(line)).toBe(0);
    // Order kept: the rows left are the lots that never left, ascending.
    expect(Array.from(line.lot.subarray(0, 4))).toEqual([1, 2, 4, 5]);
    expect(isWaiting(line, 1, KIND_AFFORDABLE)).toBe(true);
  });

  it('a line shorter than COMPACT_MIN is compacted whenever it holds a gone row', () => {
    const line = lineOf(COMPACT_MIN - 1);
    leaveLine(line, 7);
    compact(line);
    expect(line.n).toBe(COMPACT_MIN - 2);
    expect(goneOf(line)).toBe(0);
  });
});

describe('amortized compaction on the bench city (synthCity, bench baseline money)', () => {
  const bench = benchMoney(benchInput());
  const statics = staticsOf(bench);
  const timeline = oneMoneyTimeline(bench, bench.finance!);
  const core = withFunding(createFundingSystem());
  const SPLIT = 250;
  const LAST = 300;

  function tail(world: World, due: Due, seed: number, from: number) {
    const events: MonthEvent[] = [];
    const ledger: LedgerEvent[] = [];
    let month = 0;
    const out: StepSink = {
      event: (e) => events.push({ ...e, month }),
      ledger: (e) => ledger.push(e)
    };
    const kept: number[] = [];
    const lengths: number[] = [];
    for (let m = from; m <= LAST; m++) {
      month = m;
      core.step(world, due, statics, timeline, seed, out);
      const { line } = fundOf(world);
      kept.push(goneOf(line));
      lengths.push(line.n);
    }
    return { events, ledger, kept, lengths };
  }

  it('seed 1: a clone at month 250 steps to month 300 as the original; gone rows wait, then go', () => {
    const seed = 1;
    const world = core.createWorld(statics, timeline, seed, { event() {} });
    const due = core.planDue(world, statics, timeline, seed, LAST);
    for (let m = 1; m <= SPLIT; m++) core.step(world, due, statics, timeline, seed, { event() {} });
    const copy = structuredClone(world);
    // The due list is not part of the world: the copy's is planned again (world-core rule 20).
    const copyDue = core.planDue(copy, statics, timeline, seed, LAST);
    const a = tail(world, due, seed, SPLIT + 1);
    const b = tail(copy, copyDue, seed, SPLIT + 1);
    expect(b.events).toEqual(a.events);
    expect(b.ledger).toEqual(a.ledger);
    expect(copy).toEqual(world);
    // Amortized: some step ends with gone rows on the long line, and some step drops them all.
    expect(Math.min(...a.lengths)).toBeGreaterThanOrEqual(COMPACT_MIN);
    expect(Math.max(...a.kept)).toBeGreaterThan(0);
    expect(a.kept.some((g, i) => i > 0 && g === 0 && a.kept[i - 1] > 0)).toBe(true);
  });
});
