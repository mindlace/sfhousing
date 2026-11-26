import { describe, expect, it } from 'vitest';
import type { Units } from './state';
import { affords, credit, shortBy, spend, total } from './units';

describe('units', () => {
  it('credit adds by kind and treats a missing kind as 0', () => {
    expect(credit({ home: 3 }, { home: 4 })).toEqual({ home: 7 });
    expect(credit({}, {})).toEqual({});
    expect(credit({ home: 3 }, {})).toEqual({ home: 3 });
  });

  it('affords compares each kind', () => {
    expect(affords({ home: 5 }, { home: 5 })).toBe(true);
    expect(affords({ home: 4 }, { home: 5 })).toBe(false);
    expect(affords({}, {})).toBe(true);
  });

  it('spend subtracts and throws when short', () => {
    expect(spend({ home: 7 }, { home: 3 })).toEqual({ home: 4 });
    expect(() => spend({ home: 4 }, { home: 5 })).toThrow(RangeError);
  });

  it('shortBy holds only the kinds that are short', () => {
    expect(shortBy({ home: 5 }, { home: 5 })).toEqual({});
    expect(shortBy({ home: 2 }, { home: 5 })).toEqual({ home: 3 });
  });

  it('total sums the kinds and ignores a key that is not a kind', () => {
    expect(total({ home: 7 })).toBe(7);
    expect(total({ home: 7, gold: 9 } as Units)).toBe(7);
    expect(total({})).toBe(0);
  });

  it('no function changes its arguments', () => {
    const a = Object.freeze({ home: 7 });
    const b = Object.freeze({ home: 3 });
    expect(() => {
      credit(a, b);
      affords(a, b);
      spend(a, b);
      shortBy(a, b);
      total(a);
    }).not.toThrow();
    expect(a).toEqual({ home: 7 });
    expect(b).toEqual({ home: 3 });
  });
});
