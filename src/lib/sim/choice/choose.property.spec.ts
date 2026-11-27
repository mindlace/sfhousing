import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { choiceCtxOf, choiceRow, mostHomes, optionHomes } from './choose';
import { choiceModel, heightTime, table } from './test/model';
import { TYPE_FORMS, type BuildingType, type Option } from './types';

const optionArb = fc
  .record({
    type: fc.constantFrom<BuildingType>('V', 'III', 'I'),
    stories: fc.integer({ min: 1, max: 60 }),
    homes: fc.integer({ min: 1, max: 4000 }),
    form: fc.nat(2)
  })
  .map(({ type, stories, homes, form }): Option => ({
    type,
    form: TYPE_FORMS[type][form % TYPE_FORMS[type].length],
    stories,
    homes,
    plates: 1
  }));

const caseArb = fc
  .record({
    options: fc.array(optionArb, { minLength: 1, maxLength: 24 }),
    locationValue: fc.double({ min: 0.1, max: 30, noNaN: true }),
    choiceSpread: fc.double({ min: 0.01, max: 3, noNaN: true }),
    cap: fc.option(fc.integer({ min: 1, max: 4000 }), { nil: null }),
    existing: fc.integer({ min: 0, max: 300 }),
    a: fc.nat(),
    b: fc.nat()
  })
  .map((c) => {
    const options = [...c.options].sort((x, y) => x.stories - y.stories);
    const len = options.length;
    const n = 1 + (c.a % len);
    const m = n + (c.b % (len - n + 1));
    return { ...c, options, n, m };
  });

function rowsOf(c: { options: Option[]; locationValue: number; choiceSpread: number }) {
  const t = table([{ options: c.options, locationValue: c.locationValue }]);
  return choiceCtxOf(t, choiceModel(c.choiceSpread), heightTime);
}

describe('the choice row, over random rows', () => {
  it('keeps the odds between options when more are allowed', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ctx = rowsOf(c);
        const small = new Float32Array(c.m);
        const big = new Float32Array(c.m);
        const gains = choiceRow(ctx, 0, 0, c.n, c.cap, c.existing, 'market', small);
        const wide = choiceRow(ctx, 0, 0, c.m, c.cap, c.existing, 'market', big);
        expect(wide || !gains).toBe(true);
        if (!gains) return;
        // share_m(i) = share_n(i) × (the first n options' mass in the wider row), for every i < n
        const mass = big[c.n - 1];
        for (let i = 0; i < c.n; i++) {
          const sn = small[i] - (i ? small[i - 1] : 0);
          const sm = big[i] - (i ? big[i - 1] : 0);
          expect(Math.abs(sm - sn * mass)).toBeLessThan(1e-5);
        }
      }),
      { numRuns: 200 }
    );
  });
  it('never lowers the most homes when more are allowed', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const t = table([{ options: c.options, locationValue: c.locationValue }]);
        const homes = (n: number) => {
          const k = mostHomes(t, 0, n, c.cap, c.existing);
          return k < 0 ? 0 : optionHomes(t, t.offset[0] + k, c.cap, c.existing);
        };
        expect(homes(c.m)).toBeGreaterThanOrEqual(homes(c.n));
      }),
      { numRuns: 200 }
    );
  });
  it('rises and ends at 1 when it gains, under both rules', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ctx = rowsOf(c);
        for (const rule of ['market', 'most-homes'] as const) {
          const out = new Float32Array(c.m);
          const gains = choiceRow(ctx, 0, 0, c.m, c.cap, c.existing, rule, out);
          for (let k = 1; k < c.m; k++) expect(out[k]).toBeGreaterThanOrEqual(out[k - 1]);
          for (let k = 0; k < c.m; k++) expect(out[k]).toBeGreaterThanOrEqual(0);
          expect(out[c.m - 1]).toBe(gains ? 1 : 0);
        }
      }),
      { numRuns: 200 }
    );
  });
});
