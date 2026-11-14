import { beforeAll, describe, expect, it } from 'vitest';
import { addMonths, dayOf } from '$lib/sim/scenario/dates';
import { REFERENCES, monthsOf, phasingOf } from '$lib/sim/scenario/score';
import type { SimInput } from '$lib/sim/scenario/types';
import { HORIZON } from '$lib/fzp/time';
import { monthLastDay, monthOfDay } from '../months';
import { fixtureInput } from '../test/cities.node';
import { horizonMonth } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import { finalTable, horizonOf, scoreStaticsOf } from './statics';

let input: SimInput;
beforeAll(async () => {
  input = await fixtureInput();
});

const rhna = () => ({
  units: 1000,
  since: dayOf(2022, 6, 30),
  provenance: { tier: 0 as const, label: 'test', sources: [], method: 'test' }
});
const build = (base: 'plan' | 'preFzp', w: number) =>
  scoreStaticsOf(input, oneFrame(frameOf(input)), base, w, rhna());

describe('scoreStaticsOf', () => {
  it('months run from the dataset month to lastIndex', () => {
    const asOf = input.asOf;
    const s = build('plan', horizonMonth(asOf));
    expect(s.months).toEqual(monthsOf(asOf, HORIZON));
    expect(s.lastIndex).toBe(s.months.length - 1);
  });

  it('lastIndex is the last calendar month ending by model month W', () => {
    const asOf = input.asOf;
    for (const w of [1, 2, 12, 13, 480]) {
      const s = build('plan', w);
      expect(horizonOf(s)).toBeLessThanOrEqual(monthLastDay(asOf, w));
      expect(addMonths(s.months[s.lastIndex], 2) - 1).toBeGreaterThan(monthLastDay(asOf, w));
    }
  });

  it('references follow compare', () => {
    const w = horizonMonth(input.asOf);
    expect(build('preFzp', w).references).toEqual(REFERENCES);
    expect(build('plan', w).references).toEqual(
      REFERENCES.filter((r) => r.measure === 'completedNet')
    );
  });

  it('without finance in any frame, limits and tierBaseline are null', () => {
    const s = build('plan', 24);
    expect(s.limits).toBeNull();
    expect(s.tierBaseline).toBeNull();
    expect(s.phasing).toEqual(phasingOf(input.projects, input.asOf));
    expect(s.baseline).toEqual(rhna());
  });

  it('finalTable maps each month to the model month holding its last day', () => {
    const asOf = input.asOf;
    const s = build('plan', 60);
    const t = finalTable(s);
    expect(t.length).toBe(s.lastIndex + 1);
    for (let i = 0; i <= s.lastIndex; i++) {
      expect(t[i]).toBe(monthOfDay(asOf, addMonths(s.months[i], 1) - 1));
      if (i > 0) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
    }
  });
});
