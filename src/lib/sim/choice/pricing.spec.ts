import { describe, expect, it } from 'vitest';
import { PROTOTYPES, type PrototypeId } from '../finance/prototypes';
import { bandOf, carryPerHome, costPerHome, optionPrototype, valuePerHome } from './pricing';
import { stepAt, type HeightTimeStep, type PriceStep } from './types';

const anchors = Object.fromEntries(
  PROTOTYPES.map((p) => [
    p.id,
    {
      stories: p.stories,
      homes: p.homes,
      costPerHome: p.costPerHome,
      valuePerHome: p.costPerHome - p.shortfallPerHome
    }
  ])
) as PriceStep['anchors'];
const m: PriceStep = { anchors, aboveTopCostRatio: 1.39, carrying: { rate: 0.085, drawn: 0.55 } };
const upTo = [4, 7, 12, 20, 999];
const ht: HeightTimeStep = {
  permitIssued: [1, 1, 1, 1, 1],
  construction: [1, 1, 1, 1, 1],
  constructionMonths: [26.2, 29.3, 28.6, 27.4, 34.7]
};

describe('pricing by option', () => {
  it('prices Type V as A, and as E under 25 homes', () => {
    expect(costPerHome({ type: 'V', stories: 5, homes: 45 }, m)).toBe(729_700);
    expect(costPerHome({ type: 'V', stories: 3, homes: 24 }, m)).toBe(929_700);
    expect(valuePerHome({ type: 'V', stories: 5, homes: 45 }, m)).toBe(552_700);
  });
  it('prices E for Type V only: a small Type III or Type I keeps its own anchor', () => {
    expect(costPerHome({ type: 'III', stories: 5, homes: 24 }, m)).toBe(736_700);
    expect(valuePerHome({ type: 'III', stories: 5, homes: 24 }, m)).toBe(584_700);
    expect(costPerHome({ type: 'I', stories: 3, homes: 10 }, m)).toBe(857_700);
    expect(optionPrototype({ type: 'III', stories: 5, homes: 24 }, m).id).toBe('B');
    expect(optionPrototype({ type: 'V', stories: 3, homes: 24 }, m).id).toBe('E');
  });
  it('prices Type III as B and Type I below 13 as C', () => {
    expect(costPerHome({ type: 'III', stories: 7, homes: 80 }, m)).toBe(736_700);
    expect(costPerHome({ type: 'I', stories: 9, homes: 80 }, m)).toBe(857_700);
    expect(valuePerHome({ type: 'I', stories: 9, homes: 80 }, m)).toBe(651_700);
  });
  it('interpolates Type I from C at 13 to D at 24', () => {
    expect(costPerHome({ type: 'I', stories: 13, homes: 300 }, m)).toBe(857_700);
    expect(costPerHome({ type: 'I', stories: 24, homes: 300 }, m)).toBe(918_700);
    expect(costPerHome({ type: 'I', stories: 18, homes: 300 }, m)).toBeCloseTo(
      857_700 + (5 / 11) * 61_000,
      6
    );
    expect(valuePerHome({ type: 'I', stories: 18, homes: 300 }, m)).toBeCloseTo(
      651_700 - (5 / 11) * 25_000,
      6
    );
  });
  it('scales cost, not value, above 24 stories', () => {
    expect(costPerHome({ type: 'I', stories: 40, homes: 500 }, m)).toBeCloseTo(918_700 * 1.39, 6);
    expect(valuePerHome({ type: 'I', stories: 40, homes: 500 }, m)).toBe(626_700);
  });
  it('charges carrying cost only beyond the anchor band', () => {
    expect(carryPerHome({ type: 'III', stories: 8, homes: 130 }, m, ht, upTo)).toBe(0);
    expect(carryPerHome({ type: 'I', stories: 22, homes: 300 }, m, ht, upTo)).toBeGreaterThan(0);
    expect(carryPerHome({ type: 'I', stories: 18, homes: 300 }, m, ht, upTo)).toBe(0);
  });
  it('finds the band of a story count', () => {
    expect(bandOf({ upTo }, 4)).toBe(0);
    expect(bandOf({ upTo }, 5)).toBe(1);
    expect(bandOf({ upTo }, 80)).toBe(4);
  });
  it('keys Type I prices by stories and reuses PROTOTYPES for anchors', () => {
    expect(optionPrototype({ type: 'V', stories: 5, homes: 45 }, m)).toBe(PROTOTYPES[0]);
    expect(optionPrototype({ type: 'I', stories: 18, homes: 300 }, m).id).toBe('I18');
    const id: PrototypeId = 'C';
    expect(optionPrototype({ type: 'I', stories: 9, homes: 80 }, m).id).toBe(id);
  });
  it('returns a synthetic prototype when the step moves an anchor', () => {
    const moved: PriceStep = {
      ...m,
      anchors: { ...anchors, A: { ...anchors.A, costPerHome: 800_000 } }
    };
    const p = optionPrototype({ type: 'V', stories: 5, homes: 45 }, moved);
    expect(p).not.toBe(PROTOTYPES[0]);
    expect(p.costPerHome).toBe(800_000);
  });
});

describe('stepAt', () => {
  it('reads the step in force on a day', () => {
    const series = [
      { from: 100, value: 'a' },
      { from: 200, value: 'b' }
    ];
    expect(stepAt(series, 50)).toEqual({ index: 0, value: 'a' });
    expect(stepAt(series, 199).index).toBe(0);
    expect(stepAt(series, 200)).toEqual({ index: 1, value: 'b' });
    expect(() => stepAt([], 0)).toThrow();
    expect(() =>
      stepAt(
        [
          { from: 5, value: 1 },
          { from: 2, value: 2 }
        ],
        0
      )
    ).toThrow();
  });
});
