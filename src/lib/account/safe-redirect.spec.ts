import { describe, it, expect } from 'vitest';
import { safeReturnTo } from './safe-redirect';

describe('safeReturnTo', () => {
  it('accepts a same-origin absolute path', () => {
    expect(safeReturnTo('/sims/abc')).toBe('/sims/abc');
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/signin?returnTo=%2Fx')).toBe('/signin?returnTo=%2Fx');
    expect(safeReturnTo('/sims/x#section')).toBe('/sims/x#section');
  });

  it('rejects absolute URLs with a scheme', () => {
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('http://evil.com/path')).toBe('/');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
    expect(safeReturnTo('data:text/html,x')).toBe('/');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('//evil.com/path')).toBe('/');
  });

  it('rejects backslash tricks browsers normalize to slashes', () => {
    expect(safeReturnTo('/\\evil.com')).toBe('/');
    expect(safeReturnTo('/\\/evil.com')).toBe('/');
    expect(safeReturnTo('\\/evil.com')).toBe('/');
  });

  it('rejects control characters and whitespace that bypass prefix checks', () => {
    expect(safeReturnTo('/\t/evil.com')).toBe('/');
    expect(safeReturnTo('/\n//evil.com')).toBe('/');
    expect(safeReturnTo('\t//evil.com')).toBe('/');
    expect(safeReturnTo(' //evil.com')).toBe('/');
  });

  it('rejects values that are not absolute paths', () => {
    expect(safeReturnTo('sims/abc')).toBe('/');
    expect(safeReturnTo('../etc')).toBe('/');
    expect(safeReturnTo('')).toBe('/');
  });

  it('rejects non-string input', () => {
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });

  it('honors a custom fallback', () => {
    expect(safeReturnTo(null, '/account')).toBe('/account');
    expect(safeReturnTo('https://evil.com', '/account')).toBe('/account');
  });
});
