import { describe, it, expect } from 'vitest';
import { isValidEmail } from './validate';

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });
  it('rejects empty / malformed input', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@example.com')).toBe(false);
    expect(isValidEmail('two@@example.com')).toBe(false);
  });
});
