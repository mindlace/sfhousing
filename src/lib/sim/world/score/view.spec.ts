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
      money,
      waiting: money.map((_, i) => 10 * (from + i))
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

    it('viewOf joins waiting into waitingMoney with filledThrough + 1 entries', () => {
      const v = viewOf(
        [moneyChunk(0, rows.slice(0, 2)), moneyChunk(2, rows.slice(2))],
        moneyStatics
      );
      expect(v.waitingMoney).toEqual([0, 10, 20]);
      expect(v.waitingMoney).toHaveLength(v.filledThrough + 1);
    });

    it("waitingMoney is null when the view's money is null", () => {
      const v = viewOf([c(0, 3)], statics);
      expect(v.money).toBeNull();
      expect(v.waitingMoney).toBeNull();
      const withWaiting: SeriesChunk = { ...c(0, 3), waiting: [1, 2, 3, 4] };
      expect(viewOf([withWaiting], statics).waitingMoney).toBeNull();
    });

    it('waitingMoney is null when a chunk with money lacks waiting (absent or null)', () => {
      const absent = moneyChunk(0, rows);
      delete absent.waiting;
      expect(viewOf([absent], moneyStatics).money).not.toBeNull();
      expect(viewOf([absent], moneyStatics).waitingMoney).toBeNull();
      const nulled: SeriesChunk = { ...moneyChunk(0, rows), waiting: null };
      expect(viewOf([nulled], moneyStatics).waitingMoney).toBeNull();
      const second: SeriesChunk = { ...moneyChunk(2, rows.slice(2)), waiting: null };
      expect(
        viewOf([moneyChunk(0, rows.slice(0, 2)), second], moneyStatics).waitingMoney
      ).toBeNull();
    });

    it('chunksBefore trims waiting, and a refill gives the same view as a fresh fill', () => {
      const all = [moneyChunk(0, rows.slice(0, 2)), moneyChunk(2, rows.slice(2))];
      const cut = chunksBefore(all, 1);
      expect(cut).toHaveLength(1);
      expect(cut[0].waiting).toEqual([0]);
      expect(all[0].waiting).toEqual([0, 10]);
      const rest = [moneyChunk(1, rows.slice(1, 2)), moneyChunk(2, rows.slice(2))];
      expect(viewOf([...cut, ...rest], moneyStatics)).toEqual(viewOf(all, moneyStatics));
      expect(viewOf([...cut, ...rest], moneyStatics).waitingMoney).toEqual([0, 10, 20]);
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
