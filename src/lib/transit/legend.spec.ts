import { describe, expect, it } from 'vitest';
import { ACCESS_BINS, ACCESS_LEGEND, accessBin } from './legend';

describe('access legend', () => {
  it('bins on 200 / 1k / 3k / 10k / 30k, below 200 is bin 0 (transparent)', () => {
    expect(ACCESS_BINS).toEqual([200, 1000, 3000, 10000, 30000]);
    expect(
      [0, 199, 200, 999, 1000, 2999, 3000, 9999, 10000, 29999, 30000, 1e6].map(accessBin)
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(ACCESS_LEGEND).toHaveLength(5);
  });
});
