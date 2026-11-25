import { describe, expect, it } from 'vitest';
import { planDrops } from './drops';

describe('drops', () => {
  it('planDrops throws until run-play writes it', () => {
    expect(() => planDrops([], 0, 0)).toThrow('not implemented');
  });
});
