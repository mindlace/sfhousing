// Each record's own-year market for the choice-spread fit (building-choice plan, Task 13a).
import { describe, expect, it } from 'vitest';
import { shippedPrices } from '../../src/lib/sim/choice/test/model';
import * as era from '../lib/fzp-cal/era-market';
import { ERA_VALUE_INDEX, eraPrices, eraRatios } from '../lib/fzp-cal/era-market';

/** A synthetic cost index (not the CCCI's values). */
const COST = { 2016: 50, 2018: 60, 2020: 80, 2024: 100 };

describe('eraRatios', () => {
  it("prices a year against the shipped year by each index's own ratio", () => {
    const v = ERA_VALUE_INDEX.value;
    expect(eraRatios(2018, 2024, COST)).toEqual({ value: v[2018] / v[2024], cost: 0.6 });
    expect(eraRatios(2024, 2024, COST)).toEqual({ value: 1, cost: 1 });
  });

  it('holds an index at its nearest year outside the years it covers', () => {
    const v = ERA_VALUE_INDEX.value;
    const vLast = Math.max(...Object.keys(v).map(Number));
    expect(eraRatios(vLast + 3, 2020, COST).value).toBe(v[vLast] / v[2020]);
    expect(eraRatios(2010, 2020, COST).cost).toBe(50 / 80);
    expect(eraRatios(2030, 2020, COST).cost).toBe(100 / 80);
  });

  it('covers every record year from 2015 with the value index', () => {
    for (let y = 2015; y <= 2025; y++) expect(ERA_VALUE_INDEX.value[y]).toBeGreaterThan(0);
  });

  it('carries no cost index values in the code (the CCCI is a fetched source)', () => {
    expect(Object.keys(era)).not.toContain('ERA_COST_INDEX');
    expect(era.ERA_COST_PROVENANCE.tier).toBe(1);
  });

  it('refuses an empty cost index', () => {
    expect(() => eraRatios(2018, 2024, {})).toThrow(/empty/);
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
