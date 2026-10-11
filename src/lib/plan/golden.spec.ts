import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_PLANS } from './fixtures/golden/generate';
import { gridId, gridIndex } from './fixtures/grid-20x20';
import { resolveEnvelopes } from './resolve';
import type { Plan } from './types';

const DIR = join(process.cwd(), 'src/lib/plan/fixtures');
const load = <T>(p: string): T => JSON.parse(readFileSync(join(DIR, p), 'utf8')) as T;

describe('goldens against grid-20x20', () => {
  for (const name of GOLDEN_PLANS) {
    it(name, () => {
      const plan = load<Plan>(`plans/${name}.json`);
      const got = [...resolveEnvelopes(plan, gridIndex())].map(([id, e]) => [id, e.maxStories]);
      expect(got).toEqual(load<[string, number][]>(`golden/${name}.json`));
    });
  }

  it('hand-checked values', () => {
    const r = (name: string) => resolveEnvelopes(load<Plan>(`plans/${name}.json`), gridIndex());
    expect(r('single-stamp').get(gridId(9, 10))).toEqual({ maxStories: 5 });
    expect(r('paint-then-erase').has(gridId(9, 10))).toBe(false); // erased
    expect(r('paint-then-erase').get(gridId(12, 9))).toEqual({ maxStories: 8 }); // 25.5 m out
    expect(r('overlap-lower-wins').get(gridId(7, 5))).toEqual({ maxStories: 3 }); // later wins
    expect(r('overlap-lower-wins').get(gridId(2, 5))).toEqual({ maxStories: 12 });
    expect(r('empty').size).toBe(0);
  });
});
