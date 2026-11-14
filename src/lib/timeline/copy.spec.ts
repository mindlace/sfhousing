// The render-time remaps of texts that hashed or /lesscars-imported files keep (rule 38).
import { describe, expect, it } from 'vitest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { marketSentence } from '$lib/fzp/market-view';
import { MONEY_SOURCES } from '$lib/sim/scenario/finance-score';
import { PER_HOME_SOURCE, marketBody, perHomeMethod } from './copy';

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

describe('marketBody', () => {
  it('drops the market sentence’s closing disclaimer', () => {
    const s = marketSentence(fixtureCalibration(), 'all')!;
    expect(s).toContain('it is not a forecast');
    expect(marketBody(s)).not.toContain('forecast');
    expect(marketBody(s).endsWith('to the end of the timeline.')).toBe(true);
  });
});
