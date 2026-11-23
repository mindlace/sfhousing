import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearE2eMail, readE2eMail, recordE2eMail } from './mail-sink';

const DEV = { env: { ENVIRONMENT: 'development' } } as unknown as App.Platform;
const PROD = { env: { ENVIRONMENT: 'production' } } as unknown as App.Platform;

beforeEach(() => {
  clearE2eMail();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearE2eMail();
});

describe('e2e mail sink', () => {
  it('records nothing outside an e2e build', () => {
    vi.stubEnv('VITE_E2E', '');
    recordE2eMail(DEV, 'password-reset', 'a@example.com', 'https://x/1');
    expect(readE2eMail('password-reset', 'a@example.com')).toBeNull();
  });

  it('records nothing in an e2e build outside development', () => {
    vi.stubEnv('VITE_E2E', '1');
    recordE2eMail(PROD, 'password-reset', 'a@example.com', 'https://x/1');
    expect(readE2eMail('password-reset', 'a@example.com')).toBeNull();
  });

  it('records and reads by kind and lower-cased address', () => {
    vi.stubEnv('VITE_E2E', '1');
    recordE2eMail(DEV, 'password-reset', 'Ada@Example.com', 'https://x/reset');
    expect(readE2eMail('password-reset', 'ada@example.com')).toBe('https://x/reset');
    expect(readE2eMail('password-reset', 'ADA@EXAMPLE.COM')).toBe('https://x/reset');
    expect(readE2eMail('change-email-verify', 'ada@example.com')).toBeNull();
  });

  it('keeps the latest url per kind and address', () => {
    vi.stubEnv('VITE_E2E', '1');
    recordE2eMail(DEV, 'change-email-approve', 'a@example.com', 'https://x/1');
    recordE2eMail(DEV, 'change-email-approve', 'a@example.com', 'https://x/2');
    expect(readE2eMail('change-email-approve', 'a@example.com')).toBe('https://x/2');
  });

  it('forgets everything on clear', () => {
    vi.stubEnv('VITE_E2E', '1');
    recordE2eMail(DEV, 'password-reset', 'a@example.com', 'https://x/1');
    clearE2eMail();
    expect(readE2eMail('password-reset', 'a@example.com')).toBeNull();
  });
});
