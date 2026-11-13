import { describe, expect, it } from 'vitest';
import { emptyWorld } from '../columns';
import { NO_DAY, type World } from '../types';
import {
  INSTR_LOAN,
  KIND_AFFORDABLE,
  KIND_MARKET,
  addLineRow,
  addMoneyRow,
  addShadow,
  compactLine,
  dropMoneyRows,
  fundOf,
  initFunding,
  moneyRowsOf,
  poolRowOf,
  setSpell,
  spellOf
} from './columns';

function funded(pools: string[] = ['city', 'state']): World {
  const w = emptyWorld(0);
  initFunding(w, pools);
  return w;
}

describe('funding columns', () => {
  it('a world with funding columns survives structuredClone', () => {
    const w = funded();
    const { line, pools } = fundOf(w);
    const r = addLineRow(line);
    line.lot[r] = 42;
    line.kind[r] = KIND_AFFORDABLE;
    line.bundle[r] = 'a,b';
    const m = addMoneyRow(pools);
    pools.mRow[m] = r;
    pools.mProg[m] = 'a';
    pools.mInstr[m] = INSTR_LOAN;
    pools.mLent[m] = 12.5;
    setSpell(line, 42, KIND_AFFORDABLE, 1, 900);
    addShadow(line, 42, 3, 1, 900, 6);
    pools.received[0] = 1e6;

    const copy = structuredClone(w);
    expect(fundOf(copy)).toEqual(fundOf(w));
    expect(fundOf(copy).line.lot).toBeInstanceOf(Int32Array);
    expect(fundOf(copy).pools.mLent).toBeInstanceOf(Float64Array);
    expect(fundOf(copy).line).not.toBe(line);
  });

  it('fundOf throws before initFunding', () => {
    expect(() => fundOf(emptyWorld(0))).toThrow(/initFunding/);
  });

  it('compactLine drops gone rows and keeps the order', () => {
    const { line } = fundOf(funded());
    const lots = [10, 11, 12, 13, 14];
    for (const l of lots) {
      const r = addLineRow(line); // growing replaces the arrays: take the row first
      line.lot[r] = l;
    }
    line.gone[1] = 1;
    line.gone[3] = 1;
    compactLine(line);
    expect(line.n).toBe(3);
    expect(Array.from(line.lot.subarray(0, line.n))).toEqual([10, 12, 14]);
    expect(Array.from(line.gone.subarray(0, line.n))).toEqual([0, 0, 0]);
  });

  it('compactLine moves every column and the string column with the row', () => {
    const { line } = fundOf(funded());
    for (let i = 0; i < 3; i++) {
      const r = addLineRow(line);
      line.lot[r] = i;
      line.bundle[r] = `b${i}`;
      line.units[r] = i * 10;
      line.stories[r] = i + 0.5;
    }
    line.gone[0] = 1;
    compactLine(line);
    expect(line.bundle.slice(0, 2)).toEqual(['b1', 'b2']);
    expect(Array.from(line.units.subarray(0, 2))).toEqual([10, 20]);
    expect(Array.from(line.stories.subarray(0, 2))).toEqual([1.5, 2.5]);
  });

  it('addLineRow grows past its first capacity and gives defaults', () => {
    const { line } = fundOf(funded());
    for (let i = 0; i < 100; i++) {
      const r = addLineRow(line);
      line.lot[r] = i;
    }
    expect(line.n).toBe(100);
    expect(line.lot[99]).toBe(99);
    expect(line.kind[99]).toBe(KIND_MARKET);
    expect(line.applied[99]).toBe(NO_DAY);
    expect(line.gone[99]).toBe(0);
  });

  it('poolRowOf appends an unknown id with zeroed counters', () => {
    const p = fundOf(funded(['a', 'b'])).pools;
    expect(poolRowOf(p, 'b')).toBe(1);
    expect(poolRowOf(p, 'new-pool')).toBe(2);
    expect(p.n).toBe(3);
    expect(p.id[2]).toBe('new-pool');
    expect(p.received[2]).toBe(0);
    expect(p.outLoan[2]).toBe(0);
    expect(poolRowOf(p, 'new-pool')).toBe(2);
  });

  it("moneyRowsOf finds a project row's rows, dropMoneyRows removes them", () => {
    const { pools } = fundOf(funded());
    const rows = [1, 1, 4, 4, 4, 7];
    rows.forEach((pr, i) => {
      const m = addMoneyRow(pools);
      pools.mRow[m] = pr;
      pools.mProg[m] = `g${i}`;
      pools.mGrant[m] = i;
    });
    expect(moneyRowsOf(pools, 1)).toEqual([0, 2]);
    expect(moneyRowsOf(pools, 4)).toEqual([2, 5]);
    expect(moneyRowsOf(pools, 7)).toEqual([5, 6]);
    const [from, to] = moneyRowsOf(pools, 3);
    expect(to).toBe(from);

    dropMoneyRows(pools, 4);
    expect(pools.mN).toBe(3);
    expect(Array.from(pools.mRow.subarray(0, 3))).toEqual([1, 1, 7]);
    expect(pools.mProg.slice(0, 3)).toEqual(['g0', 'g1', 'g5']);
    expect(Array.from(pools.mGrant.subarray(0, 3))).toEqual([0, 1, 5]);
    expect(moneyRowsOf(pools, 4)[1]).toBe(moneyRowsOf(pools, 4)[0]);
    dropMoneyRows(pools, 99);
    expect(pools.mN).toBe(3);
  });

  it('spellOf ignores a spell recorded for another attempt', () => {
    const { line } = fundOf(funded());
    setSpell(line, 7, KIND_MARKET, 0, 1234);
    expect(spellOf(line, 7, KIND_MARKET, 0)).toBe(1234);
    expect(spellOf(line, 7, KIND_MARKET, 1)).toBe(NO_DAY);
    expect(spellOf(line, 7, KIND_AFFORDABLE, 0)).toBe(NO_DAY);
    expect(spellOf(line, 8, KIND_MARKET, 0)).toBe(NO_DAY);
  });

  it('setSpell keeps one row per (lot, kind), replacing the attempt', () => {
    const { line } = fundOf(funded());
    setSpell(line, 9, KIND_MARKET, 0, 10);
    setSpell(line, 3, KIND_AFFORDABLE, 0, 20);
    setSpell(line, 3, KIND_MARKET, 2, 30);
    setSpell(line, 9, KIND_MARKET, 1, 40);
    expect(line.spellN).toBe(3);
    expect(spellOf(line, 9, KIND_MARKET, 0)).toBe(NO_DAY);
    expect(spellOf(line, 9, KIND_MARKET, 1)).toBe(40);
    expect(spellOf(line, 3, KIND_MARKET, 2)).toBe(30);
    expect(spellOf(line, 3, KIND_AFFORDABLE, 0)).toBe(20);
  });

  it('addShadow appends rows with an unevaluated month', () => {
    const { line } = fundOf(funded());
    addShadow(line, 5, 2, 0, 300, 4);
    addShadow(line, 6, 3, 1, 310, 0);
    expect(line.shadowN).toBe(2);
    expect(line.shadowLot[1]).toBe(6);
    expect(line.shadowExisting[0]).toBe(4);
    expect(line.shadowMonth[1]).toBe(0);
  });
});
