import { describe, expect, it } from 'vitest';
import { chunkOf } from './chunk';
import { chunksBefore, viewOf } from './view';
import type { MonthRow, MoneyRow, ScoreStatics, SeriesChunk, WorldSeries } from './types';

function row(completedNet: number, entitledNew = 0, completedNetNew = 0): MonthRow {
  return {
    completedNet,
    completedNetPipeline: completedNet / 2,
    completedNetNew,
    entitledNew,
    inProgress: { proposed: 1, entitled: 2, construction: 3 } as unknown as MonthRow['inProgress'],
    exitedUnits: 1
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

const MONTHS = 12;
const plan = stub(Array.from({ length: MONTHS }, (_, i) => row(i * 2, i + 1, i * 2 + 1)));
const twin = stub(Array.from({ length: MONTHS }, (_, i) => row(i, i, i * 2)));
const c = (from: number, through: number): SeriesChunk => chunkOf(plan, twin, null, from, through);

const statics = {
  asOf: 0,
  months: Array.from({ length: MONTHS }, (_, i) => i * 30),
  lastIndex: MONTHS - 1,
  baseline: { units: 1000, since: 'x', provenance: 'p' },
  tierBaseline: null,
  phasing: [],
  references: [],
  compare: 'plan',
  limits: null,
  debts: null
} as unknown as ScoreStatics;

describe('viewOf', () => {
  it("joins chunks into the world's rows and effect", () => {
    const v = viewOf([c(0, 3), c(4, 7), c(8, 11)], statics);
    const all = c(0, 11);
    expect(v.filledThrough).toBe(11);
    expect(v.rows).toEqual(all.rows);
    expect(v.planEffect).toEqual(all.planEffect);
    expect(v.months).toBe(statics.months);
    expect(v.rows).toHaveLength(12);
    for (const k of ['mean', 'band', 'shown', 'planEffectBand']) expect(k in v).toBe(false);
    for (let i = 0; i < 12; i++) {
      for (const t of v.targets) {
        expect(t.fraction[i]).toBe((1000 + all.rows[i].completedNet) / t.target.units);
      }
    }
    expect(v.baseline).toEqual({ completedNet: 1000, since: 'x', provenance: 'p' });
    expect(v.tierTargets).toBeNull();
    expect(v.money).toBeNull();
  });

  describe('money: when pools closed', () => {
    const D = 4242;
    const entry = (
      id: string,
      closed?: number | null,
      shut?: boolean
    ): MoneyRow['pools'][number] => ({
      id,
      label: id,
      kind: 'generalRevenue',
      received: 0,
      committed: 0,
      out: 0,
      spent: 0,
      repaid: 0,
      lost: 0,
      lostCredit: 0,
      ...(closed === undefined ? {} : { closed }),
      ...(shut === undefined ? {} : { shut })
    });
    const moneyRow = (pools: MoneyRow['pools']): MoneyRow => ({
      pools,
      fundedHomes: 0,
      displacedHomes: 0,
      displacedHomesCompleted: 0,
      publicSpent: 0
    });
    // Row 0 is built without closed or shut; pool a is closed from month 1.
    const rows: MoneyRow[] = [
      moneyRow([entry('a'), entry('b')]),
      moneyRow([entry('a', D, true), entry('b', null, false)]),
      moneyRow([entry('a', D, true), entry('b', null, false)])
    ];
    const moneyChunk = (from: number, money: MoneyRow[]): SeriesChunk => ({
      ...c(from, from + money.length - 1),
      money
    });
    const moneyStatics = { ...statics, limits: [], debts: [] } as unknown as ScoreStatics;

    it("MoneyView.closed is the last row's value for every pool", () => {
      const m = viewOf([moneyChunk(0, rows)], moneyStatics).money!;
      expect(m.closed).toEqual({ a: D, b: null });
      expect(viewOf(chunksBefore([moneyChunk(0, rows)], 1), moneyStatics).money!.closed).toEqual({
        a: null,
        b: null
      });
    });

    it('MoneyView.shut has one entry per filled month, false for a row without shut', () => {
      const m = viewOf([moneyChunk(0, rows)], moneyStatics).money!;
      expect(m.shut).toEqual({ a: [false, true, true], b: [false, false, false] });
      expect(viewOf(chunksBefore([moneyChunk(0, rows)], 2), moneyStatics).money!.shut).toEqual({
        a: [false, true],
        b: [false, false]
      });
    });
  });

  it('empty view has filledThrough -1 and empty series', () => {
    const v = viewOf([], statics);
    expect(v.filledThrough).toBe(-1);
    expect(v.rows).toEqual([]);
    expect(v.planEffect).toEqual([]);
    expect(v.targets.every((t) => t.fraction.length === 0)).toBe(true);
  });

  it('a refill equals a fresh fill', () => {
    const fresh = [c(0, 3), c(4, 7), c(8, 11)];
    const cut = chunksBefore(fresh, 6);
    expect(cut).toHaveLength(2);
    expect(cut[1].from).toBe(4);
    expect(cut[1].rows).toHaveLength(2);
    expect(cut[1].planEffect).toHaveLength(2);
    expect(viewOf(cut, statics).filledThrough).toBe(5);
    expect(viewOf([...cut, c(6, 11)], statics)).toEqual(viewOf(fresh, statics));
    expect(fresh[1].rows).toHaveLength(4);
  });

  it('gaps and overlaps throw', () => {
    expect(() => viewOf([c(1, 3)], statics)).toThrow();
    expect(() => viewOf([c(0, 3), c(5, 7)], statics)).toThrow();
    expect(() => viewOf([c(0, 3), c(3, 7)], statics)).toThrow();
  });
});
