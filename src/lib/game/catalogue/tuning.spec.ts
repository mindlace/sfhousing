import { describe, expect, it } from 'vitest';
import { RUNG_LUMP, SIDE_TUNING } from './tuning';

describe('tuning', () => {
  it('has the starting lump and no side tuning', () => {
    expect(RUNG_LUMP).toEqual({ home: 2000 });
    expect(SIDE_TUNING).toEqual({});
  });
});
