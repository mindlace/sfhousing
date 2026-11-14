import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { KNOWN_DEVICE_COOKIE, markKnownDevice, isKnownDevice } from './known-device';

function fakeCookies(initial: Record<string, string> = {}) {
  const store = { ...initial };
  const setCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];
  return {
    setCalls,
    set: vi.fn((name: string, value: string, opts: Record<string, unknown>) => {
      store[name] = value;
      setCalls.push({ name, value, opts });
    }),
    get: vi.fn((name: string) => store[name]),
    delete: vi.fn((name: string) => {
      delete store[name];
    })
  } as unknown as Cookies & {
    set: ReturnType<typeof vi.fn>;
    setCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }>;
  };
}

describe('known-device cookie', () => {
  it('marks and reads', () => {
    const cookies = fakeCookies();
    expect(isKnownDevice(cookies)).toBe(false);
    markKnownDevice(cookies);
    expect(isKnownDevice(cookies)).toBe(true);
  });

  it('sets a ~400-day HttpOnly Lax cookie', () => {
    const cookies = fakeCookies();
    markKnownDevice(cookies);
    expect(cookies.setCalls[0]).toMatchObject({
      name: KNOWN_DEVICE_COOKIE,
      opts: { path: '/', maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', httpOnly: true }
    });
  });
});
