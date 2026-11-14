import { describe, it, expect } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import {
  PENDING_IDENTIFIER_COOKIE,
  stashPendingIdentifier,
  readPendingIdentifier,
  clearPendingIdentifier
} from './pending-identifier';

/** Minimal Cookies stand-in: only the three methods this seam uses. */
function fakeCookies(): Cookies & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (name: string) => store.get(name),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name)
  } as unknown as Cookies & { store: Map<string, string> };
}

/** Cookies stand-in that also captures the options passed to `set`, so a regression
 *  dropping e.g. httpOnly is caught rather than silently ignored (fakeCookies above
 *  discards the options argument entirely). */
function optionCapturingCookies(): Cookies & {
  lastOptions: Record<string, unknown> | undefined;
} {
  let lastOptions: Record<string, unknown> | undefined;
  return {
    get lastOptions() {
      return lastOptions;
    },
    get: () => undefined,
    set: (_name: string, _value: string, options?: Record<string, unknown>) => {
      lastOptions = options;
    },
    delete: () => undefined
  } as unknown as Cookies & { lastOptions: Record<string, unknown> | undefined };
}

describe('pending identifier cookie', () => {
  it('round-trips a stashed identifier', () => {
    const cookies = fakeCookies();
    stashPendingIdentifier(cookies, 'someone@example.com');
    expect(readPendingIdentifier(cookies)).toBe('someone@example.com');
  });

  it('trims surrounding whitespace on write', () => {
    const cookies = fakeCookies();
    stashPendingIdentifier(cookies, '  someone@example.com  ');
    expect(cookies.store.get(PENDING_IDENTIFIER_COOKIE)).toBe('someone@example.com');
  });

  it('reads null when nothing is stashed', () => {
    expect(readPendingIdentifier(fakeCookies())).toBeNull();
  });

  it('reads null for a whitespace-only value rather than seeding a blank field', () => {
    const cookies = fakeCookies();
    cookies.set(PENDING_IDENTIFIER_COOKIE, '   ', { path: '/' });
    expect(readPendingIdentifier(cookies)).toBeNull();
  });

  it('does not stash an empty identifier, so a skipped field seeds nothing', () => {
    const cookies = fakeCookies();
    stashPendingIdentifier(cookies, '   ');
    expect(cookies.store.has(PENDING_IDENTIFIER_COOKIE)).toBe(false);
  });

  it('sets httpOnly, sameSite=lax, path=/, and a 600s max age', () => {
    const cookies = optionCapturingCookies();
    stashPendingIdentifier(cookies, 'someone@example.com');
    expect(cookies.lastOptions).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600
    });
  });

  it('clears the cookie once consumed', () => {
    const cookies = fakeCookies();
    stashPendingIdentifier(cookies, 'someone@example.com');
    clearPendingIdentifier(cookies);
    expect(readPendingIdentifier(cookies)).toBeNull();
  });
});
