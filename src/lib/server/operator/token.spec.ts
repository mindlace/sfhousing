import { describe, expect, it } from 'vitest';
import { bearerMatches, TOKEN_MIN } from './token';

/** An obviously fake secret of exactly TOKEN_MIN characters. */
const SECRET = 'test-takedown-token-000000000000';

describe('bearerMatches', () => {
  it('the secret used here is exactly TOKEN_MIN characters', () => {
    expect(TOKEN_MIN).toBe(32);
    expect(SECRET).toHaveLength(TOKEN_MIN);
  });

  it('true for the right Bearer token', async () => {
    expect(await bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ['a wrong token of the same length', `Bearer ${SECRET.slice(0, -1)}1`],
    ['a wrong token of another length', `Bearer ${SECRET}0`],
    ['a prefix of the secret', `Bearer ${SECRET.slice(0, 16)}`],
    ['a missing header', null],
    ['an empty header', ''],
    ['the Basic scheme', `Basic ${SECRET}`],
    ['the bare token', SECRET],
    ['an empty bearer', 'Bearer '],
    ['a bearer of spaces', 'Bearer    '],
    ['the token with a trailing space', `Bearer ${SECRET} `]
  ])('false for %s', async (_, header) => {
    expect(await bearerMatches(header, SECRET)).toBe(false);
  });

  it.each([
    ['an undefined secret', undefined],
    ['an empty secret', ''],
    ['a secret of 31 characters', SECRET.slice(0, 31)],
    ['a non-string secret', 12345 as unknown as string]
  ])('false for %s, even when the header matches it', async (_, secret) => {
    expect(await bearerMatches(`Bearer ${secret ?? ''}`, secret)).toBe(false);
    expect(await bearerMatches('Bearer ', secret)).toBe(false);
    expect(await bearerMatches(null, secret)).toBe(false);
  });
});
