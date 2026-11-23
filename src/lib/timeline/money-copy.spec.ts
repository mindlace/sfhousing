// The render-time remaps of the public-money texts that hashed files keep (rule 38).
import { describe, expect, it } from 'vitest';
import { MONEY_SOURCES } from '$lib/sim/scenario/finance-score';
import { PER_HOME_SOURCE, perHomeMethod } from './money-copy';

describe('perHomeMethod', () => {
  it('replaces the completion-month tail of the per-home entry with PER_HOME_SOURCE', () => {
    const out = perHomeMethod(MONEY_SOURCES[1].method!);
    expect(out.endsWith(PER_HOME_SOURCE)).toBe(true);
    expect(out).not.toContain('when the funded project completes');
    expect(out).not.toContain('end of the run');
  });

  it('leaves any other method as it is', () => {
    expect(perHomeMethod(MONEY_SOURCES[3].method!)).toBe(MONEY_SOURCES[3].method);
  });
});
