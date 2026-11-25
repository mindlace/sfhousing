import { describe, expect, it } from 'vitest';
import { LADDER_YEARS } from './ladder-years';

describe('ladder-years', () => {
  it('starts with 2060', () => {
    expect(LADDER_YEARS).toEqual([2060]);
  });
});
