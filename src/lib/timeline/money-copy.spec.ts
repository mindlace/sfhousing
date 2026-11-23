// The render-time remaps of the public-money texts that hashed files keep (rule 38).
import { describe, expect, it } from 'vitest';
import { MONEY_SOURCES } from '$lib/sim/scenario/finance-score';
import { COVERAGE_OFF_SHORT_SENTENCE4, PER_HOME_SOURCE, perHomeMethod } from './money-copy';

describe('COVERAGE_OFF_SHORT_SENTENCE4', () => {
  it('word for word', () => {
    expect(COVERAGE_OFF_SHORT_SENTENCE4).toBe(
      'Switching a source off takes it out of every offer, so projects go ahead on the rest, at ' +
        'lower odds. A source that runs short makes projects wait for its next money; once it ' +
        'has had its last money, it closes, as if switched off.'
    );
  });
});

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
