import { describe, expect, it } from 'vitest';
import { chunkOf } from './chunk';
import { BAND_Z, chunksBefore, viewOf } from './view';
import type { MonthRow, ScoreStatics, SeriesChunk, WorldSeries } from './types';

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
const plan = [0, 1, 2, 3].map((w) =>
  stub(Array.from({ length: MONTHS }, (_, i) => row(w * 10 + i * (w + 1), i + w, i * 2 + w * w)))
);
const twin = [0, 1, 2, 3].map((w) =>
  stub(Array.from({ length: MONTHS }, (_, i) => row(w * 10 + i, i, i * 2)))
);
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
  limits: null
} as unknown as ScoreStatics;

describe('viewOf', () => {
  it('joins chunks and builds the band', () => {
    const v = viewOf([c(0, 3), c(4, 7), c(8, 11)], statics);
    const all = c(0, 11);
    expect(v.filledThrough).toBe(11);
    expect(v.mean).toEqual(all.mean);
    expect(v.shown).toEqual(all.shown);
    expect(v.months).toBe(statics.months);
    expect(v.mean).toHaveLength(12);
    expect(v.band).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(v.band[i].lo).toBe(all.mean[i].completedNet - 1.2816 * all.sd[i].completedNet);
      expect(v.band[i].hi).toBe(all.mean[i].completedNet + 1.2816 * all.sd[i].completedNet);
      const pe = all.planEffect[i];
      expect(v.planEffect[i]).toEqual(pe.mean);
      expect(v.planEffectBand[i].lo.entitledNew).toBe(
        pe.mean.entitledNew - 1.2816 * pe.sd.entitledNew
      );
      expect(v.planEffectBand[i].hi.completedNetNew).toBe(
        pe.mean.completedNetNew + 1.2816 * pe.sd.completedNetNew
      );
      for (const t of v.targets) {
        expect(t.fraction[i]).toBe((1000 + all.mean[i].completedNet) / t.target.units);
      }
    }
    expect(v.baseline).toEqual({ completedNet: 1000, since: 'x', provenance: 'p' });
    expect(v.tierTargets).toBeNull();
    expect(v.money).toBeNull();
    expect(BAND_Z).toBe(1.2816);
  });

  it('empty view has filledThrough -1 and empty series', () => {
    const v = viewOf([], statics);
    expect(v.filledThrough).toBe(-1);
    expect(v.mean).toEqual([]);
    expect(v.band).toEqual([]);
    expect(v.shown).toEqual([]);
    expect(v.planEffect).toEqual([]);
    expect(v.planEffectBand).toEqual([]);
    expect(v.targets.every((t) => t.fraction.length === 0)).toBe(true);
  });

  it('a refill equals a fresh fill', () => {
    const fresh = [c(0, 3), c(4, 7), c(8, 11)];
    const cut = chunksBefore(fresh, 6);
    expect(cut).toHaveLength(2);
    expect(cut[1].from).toBe(4);
    expect(cut[1].mean).toHaveLength(2);
    expect(cut[1].shown).toHaveLength(2);
    expect(cut[1].planEffect).toHaveLength(2);
    expect(viewOf(cut, statics).filledThrough).toBe(5);
    expect(viewOf([...cut, c(6, 11)], statics)).toEqual(viewOf(fresh, statics));
    expect(fresh[1].mean).toHaveLength(4);
  });

  it('gaps and overlaps throw', () => {
    expect(() => viewOf([c(1, 3)], statics)).toThrow();
    expect(() => viewOf([c(0, 3), c(5, 7)], statics)).toThrow();
    expect(() => viewOf([c(0, 3), c(3, 7)], statics)).toThrow();
  });
});
