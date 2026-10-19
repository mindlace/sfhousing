import { describe, expect, it } from 'vitest';
import { MAX_SEED, parseSeed, searchWithSeed } from './seed';

const parse = (qs: string) => parseSeed(new URLSearchParams(qs));

describe('parseSeed', () => {
  it('accepts decimal seeds up to MAX_SEED', () => {
    expect(MAX_SEED).toBe(4_294_967_295);
    expect(parse('?seed=0')).toEqual({ seed: 0, invalid: false });
    expect(parse('?seed=4294967295')).toEqual({ seed: 4294967295, invalid: false });
    expect(parse('?seed=00012')).toEqual({ seed: 12, invalid: false });
  });

  it.each(['4294967296', '-1', '1e3', '%2012', '12345678901', '', 'abc', '1.5'])(
    'rejects seed=%s',
    (value) => {
      expect(parse(`?seed=${value}`)).toEqual({ seed: null, invalid: true });
    }
  );

  it('treats a missing seed as absent, not invalid', () => {
    expect(parse('')).toEqual({ seed: null, invalid: false });
    expect(parse('?foo=1')).toEqual({ seed: null, invalid: false });
  });
});

describe('searchWithSeed', () => {
  it('sets, replaces and removes the seed, keeping other params in order', () => {
    expect(searchWithSeed('?foo=1&seed=3', 9)).toBe('?foo=1&seed=9');
    expect(searchWithSeed('?foo=1&seed=3', null)).toBe('?foo=1');
    expect(searchWithSeed('?seed=3', null)).toBe('');
    expect(searchWithSeed('', 5)).toBe('?seed=5');
    expect(searchWithSeed('?a=1&seed=2&b=3', 7)).toBe('?a=1&seed=7&b=3');
  });
});
