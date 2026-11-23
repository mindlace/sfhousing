import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { enforceRate } from './rate-limit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enforceRate', () => {
  it('always allows in development without calling the limiter', async () => {
    const limiter = new FakeRateLimiter({ allow: 0 });
    expect(await enforceRate(limiter, 'publish:1.2.3.4', { ENVIRONMENT: 'development' })).toBe(
      true
    );
    expect(limiter.calls).toEqual([]);
  });

  it('fails closed in production when the binding is missing, logging only the label', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await enforceRate(
        undefined,
        'publish:1.2.3.4',
        { ENVIRONMENT: 'production' },
        {
          critical: true
        }
      )
    ).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
    const msg = err.mock.calls[0][0];
    expect(typeof msg).toBe('string');
    expect(msg).toContain('publish');
    expect(msg).not.toContain('1.2.3.4');
    for (const arg of err.mock.calls[0]) expect(String(arg)).not.toContain('1.2.3.4');
  });

  it('allows in staging when the binding is missing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await enforceRate(
        undefined,
        'publish:1.2.3.4',
        { ENVIRONMENT: 'staging' },
        { critical: true }
      )
    ).toBe(true);
    for (const call of err.mock.calls) {
      for (const arg of call) expect(String(arg)).not.toContain('1.2.3.4');
    }
  });

  it('enforces the limiter in production', async () => {
    const limiter = new FakeRateLimiter({ allow: 1 });
    const env = { ENVIRONMENT: 'production' };
    expect(await enforceRate(limiter, 'publish:1.2.3.4', env)).toBe(true);
    expect(await enforceRate(limiter, 'publish:1.2.3.4', env)).toBe(false);
  });

  it('forwards the key verbatim', async () => {
    const limiter = new FakeRateLimiter({ allow: 5 });
    await enforceRate(limiter, 'publish:2001:db8::1', { ENVIRONMENT: 'production' });
    expect(limiter.calls).toEqual(['publish:2001:db8::1']);
  });

  it('allows a missing binding in production when not critical (the default)', async () => {
    const env = { ENVIRONMENT: 'production' };
    expect(await enforceRate(undefined, 'invite:u1', env)).toBe(true);
    expect(await enforceRate(undefined, 'invite:u1', env, { critical: false })).toBe(true);
  });

  it('development allows even a critical limiter that denies', async () => {
    const limiter = new FakeRateLimiter({ allow: 0 });
    const env = { ENVIRONMENT: 'development' };
    expect(await enforceRate(limiter, 'invite:u1', env, { critical: true })).toBe(true);
  });
});
