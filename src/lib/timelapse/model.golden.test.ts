import { describe, expect, it } from 'vitest';
import golden from './fixtures/model-golden.json';
import { modelGoldenCases } from './model.golden.cases';

describe('model.ts cross-engine golden (server / V8)', () => {
  it('has a populated golden covering every model function', () => {
    const fns = new Set(golden.cases.map((c) => c.fn));
    expect([...fns].sort()).toEqual([
      'chanceTable',
      'cumulativeIncidence',
      'initiationHazard',
      'sampleTransition',
      'typicalMonths'
    ]);
    expect(golden.cases.filter((c) => c.fn === 'sampleTransition')).toHaveLength(50);
    expect(golden.cases.filter((c) => c.fn === 'initiationHazard')).toHaveLength(20);
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
