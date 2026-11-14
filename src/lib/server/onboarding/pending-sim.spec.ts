import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import {
  PENDING_SIM_COOKIE,
  stashPendingSim,
  readPendingSim,
  clearPendingSim
} from './pending-sim';

function fakeCookies(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    set: vi.fn((name: string, value: string) => {
      store[name] = value;
    }),
    get: vi.fn((name: string) => store[name]),
    delete: vi.fn((name: string) => {
      delete store[name];
    })
  } as unknown as Cookies & { set: ReturnType<typeof vi.fn> };
}

describe('pending-sim cookie', () => {
  it('stashes a trimmed title under the cookie name with httpOnly + short maxAge', () => {
    const cookies = fakeCookies();
    stashPendingSim(cookies, '  Build a shed  ');
    expect(cookies.set).toHaveBeenCalledWith(
      PENDING_SIM_COOKIE,
      'Build a shed',
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600 })
    );
  });

  it('reads back the stashed title', () => {
    const cookies = fakeCookies({ [PENDING_SIM_COOKIE]: 'Plan a trip' });
    expect(readPendingSim(cookies)).toBe('Plan a trip');
  });

  it('returns null when absent or blank', () => {
    expect(readPendingSim(fakeCookies())).toBeNull();
    expect(readPendingSim(fakeCookies({ [PENDING_SIM_COOKIE]: '   ' }))).toBeNull();
  });

  it('clears the cookie', () => {
    const cookies = fakeCookies({ [PENDING_SIM_COOKIE]: 'x' });
    clearPendingSim(cookies);
    expect(cookies.delete).toHaveBeenCalledWith(PENDING_SIM_COOKIE, { path: '/' });
  });
});
