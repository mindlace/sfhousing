// Each record's own-year market for the choice-spread fit (building-choice plan, Task 13a).
import { describe, expect, it } from 'vitest';
import { shippedPrices } from '../../src/lib/sim/choice/test/model';
import { ERA_COST_INDEX, ERA_VALUE_INDEX, eraPrices, eraRatios } from '../lib/fzp-cal/era-market';

describe('eraRatios', () => {
  it("prices a year against the shipped year by each index's own ratio", () => {
    const v = ERA_VALUE_INDEX.value;
    const c = ERA_COST_INDEX.value;
    expect(eraRatios(2018, 2024)).toEqual({ value: v[2018] / v[2024], cost: c[2018] / c[2024] });
    expect(eraRatios(2024, 2024)).toEqual({ value: 1, cost: 1 });
  });

  it('holds an index at its nearest year outside the years it covers', () => {
    const v = ERA_VALUE_INDEX.value;
    const c = ERA_COST_INDEX.value;
    const years = (o: Record<number, number>) => Object.keys(o).map(Number);
    const vLast = Math.max(...years(v));
    const cFirst = Math.min(...years(c));
    expect(eraRatios(vLast + 3, 2020).value).toBe(v[vLast] / v[2020]);
    expect(eraRatios(cFirst - 2, 2020).cost).toBe(c[cFirst] / c[2020]);
  });

  it('covers every record year from 2015 with both indices, rising cost', () => {
    for (let y = 2015; y <= 2025; y++) {
      expect(ERA_VALUE_INDEX.value[y]).toBeGreaterThan(0);
      expect(ERA_COST_INDEX.value[y]).toBeGreaterThan(0);
    }
    expect(ERA_COST_INDEX.value[2015]).toBeLessThan(ERA_COST_INDEX.value[2025]);
  });
});

describe('eraPrices', () => {
  it('scales every anchor cost by the cost ratio and value by the value ratio', () => {
    const p = shippedPrices();
    const out = eraPrices(p, { value: 0.8, cost: 0.6 });
    for (const id of ['A', 'B', 'C', 'D', 'E'] as const) {
      expect(out.anchors[id]).toEqual({
        ...p.anchors[id],
        costPerHome: p.anchors[id].costPerHome * 0.6,
        valuePerHome: p.anchors[id].valuePerHome * 0.8
      });
    }
    expect(out.aboveTopCostRatio).toBe(p.aboveTopCostRatio);
    expect(out.carrying).toEqual(p.carrying);
  });

  it('returns the step itself at ratios of 1', () => {
    const p = shippedPrices();
    expect(eraPrices(p, { value: 1, cost: 1 })).toBe(p);
  });
});
