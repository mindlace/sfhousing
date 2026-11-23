import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_SUFFIX,
  hasSessionCookie,
  routeNeedsSession,
  shouldResolveSession
} from './session-gate';

describe('hasSessionCookie', () => {
  it('is false with no cookie header', () => {
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie('')).toBe(false);
  });

  it('finds the plain and the __Secure- session cookie names', () => {
    expect(SESSION_COOKIE_SUFFIX).toBe('better-auth.session_token');
    expect(hasSessionCookie('better-auth.session_token=t')).toBe(true);
    expect(hasSessionCookie('__Secure-better-auth.session_token=t')).toBe(true);
    expect(hasSessionCookie('a=1; better-auth.session_token=t.sig; b=2')).toBe(true);
  });

  it('ignores other cookies, including look-alike names and values', () => {
    expect(hasSessionCookie('sfh_e2e_auth_methods=password')).toBe(false);
    expect(hasSessionCookie('better-auth.session_token_x=t')).toBe(false);
    expect(hasSessionCookie('x-better-auth.session_token=t')).toBe(false);
    expect(hasSessionCookie('a=better-auth.session_token')).toBe(false);
    expect(hasSessionCookie('better-auth.session_data=t')).toBe(false);
  });
});

describe('routeNeedsSession', () => {
  it.each([
    '/api/auth',
    '/api/auth/get-session',
    '/account',
    '/account/security',
    '/api/account/password',
    '/signin',
    '/forgot-password',
    '/reset-password',
    '/api/e2e/login'
  ])('is true for %s', (path) => {
    expect(routeNeedsSession(path)).toBe(true);
  });

  it.each([
    '/api/auth',
    '/account',
    '/api/account',
    '/signin',
    '/forgot-password',
    '/reset-password',
    '/api/e2e'
  ])('the prefix %s is a session route', (prefix) => {
    expect(routeNeedsSession(prefix)).toBe(true);
    expect(routeNeedsSession(`${prefix}/x`)).toBe(true);
  });

  it.each([
    '/sims',
    '/sims/abc',
    '/api/sims/abc/members',
    '/invite/xyz',
    '/api/invites/xyz/accept',
    '/',
    '/sim',
    '/s/abc',
    '/p/abc',
    '/about',
    '/attribution',
    '/data/fixture-0/manifest.json',
    '/api/plans',
    '/api/e2e2',
    '/signing',
    '/simsx',
    '/accounts'
  ])('is false for %s', (path) => {
    expect(routeNeedsSession(path)).toBe(false);
  });
});

describe('shouldResolveSession', () => {
  const headers = (cookie?: string) => new Headers(cookie ? { cookie } : {});
  const url = (path: string) => new URL(`http://localhost${path}`);

  it('is false for a signed-out page', () => {
    for (const path of ['/', '/sim', '/s/abc', '/p/abc']) {
      expect(shouldResolveSession(url(path), headers())).toBe(false);
    }
  });

  it('is true for any page with a session cookie', () => {
    expect(shouldResolveSession(url('/'), headers('better-auth.session_token=t'))).toBe(true);
  });

  it('is true for a session route without a cookie', () => {
    expect(shouldResolveSession(url('/signin'), headers())).toBe(true);
  });

  it('is false under /data/, even with a cookie', () => {
    expect(
      shouldResolveSession(
        url('/data/fixture-0/manifest.json'),
        headers('better-auth.session_token=t')
      )
    ).toBe(false);
  });

  it('is false under a percent-encoded /data/, which routes to the same handler', () => {
    for (const path of ['/%64ata/fixture-0/manifest.json', '/d%61ta/fixture-0/x.json']) {
      expect(shouldResolveSession(url(path), headers('better-auth.session_token=t')), path).toBe(
        false
      );
    }
  });

  it('falls back to the raw path when it does not decode', () => {
    expect(shouldResolveSession(url('/%E0%A4%A/x'), headers('better-auth.session_token=t'))).toBe(
      true
    );
  });
});
