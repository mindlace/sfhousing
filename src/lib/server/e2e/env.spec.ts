import { afterEach, describe, expect, it, vi } from 'vitest';
import { isE2eEnv } from './env';

function platform(environment: string | undefined): App.Platform {
  return { env: { ENVIRONMENT: environment } } as unknown as App.Platform;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isE2eEnv', () => {
  it('is false in a normal build, even in development', () => {
    vi.stubEnv('VITE_E2E', '');
    expect(isE2eEnv(platform('development'))).toBe(false);
  });

  it('is true in an e2e build in development', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(isE2eEnv(platform('development'))).toBe(true);
  });

  it('is false in an e2e build outside development', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(isE2eEnv(platform('production'))).toBe(false);
    expect(isE2eEnv(platform('staging'))).toBe(false);
    expect(isE2eEnv(platform(undefined))).toBe(false);
  });

  it('is false with no platform', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(isE2eEnv(undefined)).toBe(false);
  });
});
