/**
 * The body of the model golden (AC-11), run by `model.golden.test.ts` (Node) and
 * `model.golden.svelte.spec.ts` (the client project's browser engine; `SFH_BROWSER` picks it).
 */
import { describe, expect, it } from 'vitest';
import golden from './fixtures/model-golden.json';
import { bits, modelGoldenCases } from './model.golden.cases';

const ZERO = bits(0);

export function describeModelGolden(where: string): void {
  describe(`model.ts cross-engine golden (${where})`, () => {
    it('has a populated golden covering every model function', () => {
      const count = (fn: string) => golden.cases.filter((c) => c.fn === fn).length;
      expect([...new Set(golden.cases.map((c) => c.fn))].sort()).toEqual([
        'chanceTable',
        'cumulativeIncidence',
        'initiationHazard',
        'sampleTransition',
        'typicalMonths'
      ]);
      expect(count('sampleTransition')).toBe(100);
      expect(count('initiationHazard')).toBe(50);
      expect(count('chanceTable')).toBe(32);
      expect(count('typicalMonths')).toBe(2);
      expect(count('cumulativeIncidence')).toBe(246);
    });

    it('is not degenerate: outputs vary, so an engine difference has something to show', () => {
      const of = (fn: string) => golden.cases.filter((c) => c.fn === fn);
      expect(new Set(of('initiationHazard').map((c) => c.bits[0])).size).toBeGreaterThan(10);
      // At least one sampled outcome is an exit (kind index above 0), and the days vary.
      const samples = of('sampleTransition');
      expect(samples.some((c) => c.bits[1] !== ZERO)).toBe(true);
      expect(new Set(samples.map((c) => c.bits[0])).size).toBeGreaterThan(30);
      // Most chance tables are not a constant, and typical months differ between cells.
      const varying = of('chanceTable').filter((c) => new Set(c.bits).size > 1);
      expect(varying.length).toBeGreaterThan(16);
      const typical = of('typicalMonths').flatMap((c) => c.bits);
      expect(new Set(typical).size).toBeGreaterThan(4);
    });

    it('reproduces the golden bit pattern for every output', () => {
      const now = modelGoldenCases();
      expect(now.length).toBe(golden.cases.length);
      for (let i = 0; i < now.length; i++) {
        expect(now[i].fn).toBe(golden.cases[i].fn);
        expect(now[i].input).toBe(golden.cases[i].input);
        expect(now[i].bits, `${now[i].fn}(${now[i].input})`).toEqual(golden.cases[i].bits);
      }
    });
  });
}
