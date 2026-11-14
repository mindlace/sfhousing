import { describe, expect, it } from 'vitest';
import { PSEUDONYMOUS_EMAIL_DOMAIN } from '$lib/server/auth/brand';
import { isDeliverable, mailCanBeDelivered, mailProvider } from './provider';

describe('mailProvider', () => {
  it('is null with no keys (log mode)', () => {
    expect(mailProvider({})).toBeNull();
  });

  it('is ses with both SES keys', () => {
    expect(mailProvider({ SES_ACCESS_KEY_ID: 'a', SES_SECRET_ACCESS_KEY: 'b' })).toBe('ses');
  });

  it('is null with only one SES key', () => {
    expect(mailProvider({ SES_ACCESS_KEY_ID: 'a' })).toBeNull();
    expect(mailProvider({ SES_SECRET_ACCESS_KEY: 'b' })).toBeNull();
  });

  it('is resend with EMAIL_PROVIDER=resend and RESEND_API_KEY', () => {
    expect(mailProvider({ EMAIL_PROVIDER: 'Resend', RESEND_API_KEY: 'k' })).toBe('resend');
  });

  it('is null with EMAIL_PROVIDER=resend and no key, even when SES keys are set', () => {
    expect(
      mailProvider({ EMAIL_PROVIDER: 'resend', SES_ACCESS_KEY_ID: 'a', SES_SECRET_ACCESS_KEY: 'b' })
    ).toBeNull();
  });

  it('ignores RESEND_API_KEY unless EMAIL_PROVIDER=resend', () => {
    expect(mailProvider({ RESEND_API_KEY: 'k' })).toBeNull();
  });
});

describe('mailCanBeDelivered', () => {
  it('reads the platform env', () => {
    expect(mailCanBeDelivered(undefined)).toBe(false);
    expect(mailCanBeDelivered({ env: {} } as App.Platform)).toBe(false);
    expect(
      mailCanBeDelivered({
        env: { SES_ACCESS_KEY_ID: 'a', SES_SECRET_ACCESS_KEY: 'b' }
      } as unknown as App.Platform)
    ).toBe(true);
  });
});

describe('isDeliverable', () => {
  it('is false for a pseudonymous address, in any case', () => {
    expect(isDeliverable(`temp-x@${PSEUDONYMOUS_EMAIL_DOMAIN}`)).toBe(false);
    expect(isDeliverable(`temp-x@${PSEUDONYMOUS_EMAIL_DOMAIN.toUpperCase()}`)).toBe(false);
  });

  it('is false for no address', () => {
    expect(isDeliverable(null)).toBe(false);
    expect(isDeliverable('')).toBe(false);
  });

  it('is true for an ordinary address', () => {
    expect(isDeliverable('alice@example.com')).toBe(true);
  });
});
