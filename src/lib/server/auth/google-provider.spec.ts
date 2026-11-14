import { describe, it, expect } from 'vitest';
import { googleConfigured, googleProvider } from './google-provider';

describe('googleProvider', () => {
  it('carries credentials and disables implicit sign-up (existing-account sign-in unless requestSignUp)', () => {
    const p = googleProvider({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
    expect(p).toMatchObject({ clientId: 'cid', clientSecret: 'sec', disableImplicitSignUp: true });
  });
});

describe('googleConfigured', () => {
  it('is true only with both a client id and a secret', () => {
    expect(googleConfigured({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' })).toBe(true);
    expect(googleConfigured({ GOOGLE_CLIENT_ID: 'cid' })).toBe(false);
    expect(googleConfigured({ GOOGLE_CLIENT_SECRET: 'sec' })).toBe(false);
    expect(googleConfigured({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: 'sec' })).toBe(false);
    expect(googleConfigured({})).toBe(false);
  });
});
