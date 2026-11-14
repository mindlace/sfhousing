import { afterEach, describe, it, test, expect, vi } from 'vitest';
import { parseAdditionalUserInputFromProviderProfile, parseUserInput } from 'better-auth/db';
import { freshDb, makePlatform } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { clearE2eMail, readE2eMail } from '$lib/server/e2e/mail-sink';
import { getAuth, verifyAuthSecret, authGenerateId } from './better-auth';
import { PSEUDONYMOUS_EMAIL_DOMAIN } from './brand';
import type { AuthMethod } from './methods';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './password-policy';
import { isValidId } from '$lib/server/ids/factory';

/** Every method on, so the config under test is the full one. */
const ALL_METHODS: ReadonlySet<AuthMethod> = new Set([
  'magic-link',
  'password',
  'passkey',
  'google'
]);

function fakePlatform(secret = 'a'.repeat(64), env: Record<string, unknown> = {}) {
  const { shim } = freshDb();
  return makePlatform(shim, {
    BETTER_AUTH_SECRET: secret,
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    ...env
  });
}

/** `fakePlatform`, extended with what `sendResetPassword`'s e2e mail record needs: an e2e
 *  build (`VITE_E2E`, stubbed per test) in `ENVIRONMENT=development`, and `SES_FROM` so the
 *  real `sendEmail` call that follows does not throw for a missing From address (it falls
 *  into its log-mode no-op since no SES/Resend credentials are set). */
function e2ePlatform() {
  return fakePlatform(undefined, {
    ENVIRONMENT: 'development',
    SES_FROM: 'noreply@example.com'
  });
}

function fullAuth(platform = fakePlatform(), origin = 'https://sfhousing.example') {
  return getAuth(platform, origin, { methods: ALL_METHODS });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearE2eMail();
});

describe('authGenerateId', () => {
  it('mints valid app ids for Better-Auth rows', () => {
    expect(isValidId(authGenerateId())).toBe(true);
  });
  it('mints a distinct id each call', () => {
    expect(authGenerateId()).not.toBe(authGenerateId());
  });
});

describe('verifyAuthSecret', () => {
  it('rejects known placeholders', () => {
    expect(() => verifyAuthSecret('DEV_SECRET_CHANGE_FOR_PRODUCTION')).toThrow();
    expect(() => verifyAuthSecret('change-me')).toThrow();
    expect(() => verifyAuthSecret('')).toThrow();
  });
  it('rejects short secrets', () => {
    expect(() => verifyAuthSecret('a'.repeat(31))).toThrow();
  });
  it('rejects a missing secret with the operator message, not a TypeError', () => {
    const message = /BETTER_AUTH_SECRET is missing, too short/;
    expect(() => verifyAuthSecret(undefined)).toThrow(message);
    expect(() => verifyAuthSecret('')).toThrow(message);
    expect(() => verifyAuthSecret('a'.repeat(31))).toThrow(message);
  });
  it('accepts a 32+ char non-placeholder', () => {
    expect(() => verifyAuthSecret('a'.repeat(32))).not.toThrow();
  });
});

describe('getAuth', () => {
  it('throws when secret is a placeholder', () => {
    expect(() =>
      getAuth(fakePlatform('DEV_SECRET_CHANGE_FOR_PRODUCTION'), 'http://localhost:5173')
    ).toThrow();
  });
  it('exposes a fetch handler', () => {
    expect(typeof getAuth(fakePlatform(), 'http://localhost:5173').handler).toBe('function');
  });
  it('registers google as a social provider', () => {
    const providers = Object.keys(fullAuth().options.socialProviders ?? {});
    expect(providers).toContain('google');
  });
  it('trusts both the resolved baseURL and the per-request fallback origin', () => {
    const platform = fakePlatform(undefined, { BETTER_AUTH_URL: 'http://localhost:4173' });
    const opts = getAuth(platform, 'http://sfhousing.example').options;
    expect(opts.baseURL).toBe('http://localhost:4173');
    expect(opts.trustedOrigins).toEqual(
      expect.arrayContaining(['http://localhost:4173', 'http://sfhousing.example'])
    );
  });
  it('collapses trusted origins to one entry in prod (baseURL = fallback)', () => {
    const opts = getAuth(fakePlatform(), 'https://sfhousing.example').options;
    expect(opts.trustedOrigins).toEqual(['https://sfhousing.example']);
  });

  // Regression: a cold "Sign in with Google" (no existing account → a CREATE) must not be
  // refused by Better-Auth's required-field validation. userIdentity/handle/handleSkeleton are
  // minted by the create.before hook, never carried in a Google profile, so requiring them at
  // input-validation time threw `userIdentity is required` (surfaced to the user as ?error=...).
  // See the additionalFields note in better-auth.ts.
  it('lets a cold Google sign-up parse without requiring hook-minted identity fields', () => {
    const opts = fullAuth().options;
    const googleProfile = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
      image: 'https://example.com/ada.png'
    };
    expect(() =>
      parseAdditionalUserInputFromProviderProfile(opts, googleProfile, 'create')
    ).not.toThrow();
  });

  it('declares userIdentity/handle/handleSkeleton as hook-populated (input:false, not required)', () => {
    const fields = fullAuth().options.user!.additionalFields as Record<string, unknown>;
    for (const key of ['userIdentity', 'handle', 'handleSkeleton']) {
      expect(fields[key]).toMatchObject({ input: false, required: false });
    }
  });
});

describe('password auth config', () => {
  it('keeps sveltekitCookies last in the plugin array', () => {
    const auth = fullAuth();
    const ids = (auth.options.plugins ?? []).map((p: { id: string }) => p.id);
    expect(ids[ids.length - 1]).toBe('sveltekit-cookies');
  });

  it('enables emailAndPassword with the length-only policy', () => {
    const auth = fullAuth();
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(PASSWORD_MIN_LENGTH);
    expect(auth.options.emailAndPassword?.maxPasswordLength).toBe(PASSWORD_MAX_LENGTH);
  });

  it('never auto-signs-in on password set — it is add-a-credential, not sign-up', () => {
    const auth = fullAuth();
    expect(auth.options.emailAndPassword?.autoSignIn).toBe(false);
  });

  // There is no password sign-up path in this product: a password is only ever set on an
  // already-signed-in session. `enabled` alone publishes an unauthenticated
  // POST /sign-up/email whose USER_ALREADY_EXISTS is an enumeration oracle.
  it('disables password sign-up — a password is added to a session, never signed up with', () => {
    const auth = fullAuth();
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  // Reset is sessionless recovery: the person resetting may be locked out precisely
  // because someone else holds a live session. There is no caller session to preserve
  // (resetPassword runs off a token, not a cookie), so ALL sessions are revoked —
  // unlike the change path, which keeps the caller signed in on a rotated token.
  it('revokes every session on password reset', () => {
    const auth = fullAuth();
    expect(auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('still exposes the add-a-credential and reset endpoints that disableSignUp must not close', () => {
    const auth = fullAuth();
    // disableSignUp is read only by sign-up.mjs; these routes never consult it.
    expect(typeof auth.api.setPassword).toBe('function');
    expect(typeof auth.api.changePassword).toBe('function');
    expect(typeof auth.api.requestPasswordReset).toBe('function');
    expect(typeof auth.api.resetPassword).toBe('function');
  });

  // The username plugin was installed to back handle sign-in, but sign-in never used it:
  // the sign-in action resolves the handle itself (resolveHandleToEmail) and calls
  // signInEmail. All the plugin contributed was two handle-enumeration endpoints
  // (/is-username-available, and a USERNAME_IS_ALREADY_TAKEN pre-hook reachable
  // unauthenticated) plus a client-writable path onto our handle columns. Both are gone.
  it('does not register the username plugin or its handle-field lock', () => {
    const auth = fullAuth();
    const ids = (auth.options.plugins ?? []).map((p: { id: string }) => p.id);
    expect(ids).not.toContain('username');
    expect(ids).not.toContain('lock-handle-fields');
  });

  // This is the guarantee lockHandleFields used to provide for the plugin's remapped
  // fields. It must survive the plugin's removal on its own, via user.additionalFields —
  // handles are minted solely by databaseHooks.user.create.before and there is no
  // handle-change flow, so no client may ever write either column.
  it('still refuses client-supplied handle/handleSkeleton on update', () => {
    const auth = fullAuth();
    expect(() => parseUserInput(auth.options, { handle: 'squatter' }, 'update')).toThrow();
    expect(() => parseUserInput(auth.options, { handleSkeleton: 'squatter' }, 'update')).toThrow();
  });

  it('leaves a benign update untouched, so the lock is not a blanket update ban', () => {
    const auth = fullAuth();
    expect(() => parseUserInput(auth.options, { name: 'Ada' }, 'update')).not.toThrow();
  });

  it('registers the breach check', () => {
    const auth = fullAuth();
    const ids = (auth.options.plugins ?? []).map((p: { id: string }) => p.id);
    expect(ids).toContain('have-i-been-pwned');
  });

  test('sendResetPassword records the URL for e2e when the gate passes', async () => {
    vi.stubEnv('VITE_E2E', '1');
    mockConsole();
    const auth = fullAuth(e2ePlatform(), 'https://example.com');
    await auth.options.emailAndPassword!.sendResetPassword!({
      user: { email: 'real@example.com', emailVerified: true },
      url: 'https://example.com/reset?token=abc'
    } as never);
    expect(readE2eMail('password-reset', 'real@example.com')).toBe(
      'https://example.com/reset?token=abc'
    );
  });

  test('sendResetPassword records nothing for a gate-refused address', async () => {
    vi.stubEnv('VITE_E2E', '1');
    mockConsole();
    const auth = fullAuth(e2ePlatform(), 'https://example.com');
    const email = `anon@${PSEUDONYMOUS_EMAIL_DOMAIN}`;
    await auth.options.emailAndPassword!.sendResetPassword!({
      user: { email, emailVerified: true },
      url: 'https://example.com/reset?token=abc'
    } as never);
    expect(readE2eMail('password-reset', email)).toBeNull();
  });
});

describe('change-email mail records', () => {
  test('sendChangeEmailConfirmation records the approve URL for e2e', async () => {
    vi.stubEnv('VITE_E2E', '1');
    mockConsole();
    const auth = getAuth(e2ePlatform(), 'https://example.com');
    await auth.options.user!.changeEmail!.sendChangeEmailConfirmation!({
      user: { email: 'old@example.com' },
      newEmail: 'new@example.com',
      url: 'https://example.com/approve?token=a'
    } as never);
    expect(readE2eMail('change-email-approve', 'old@example.com')).toBe(
      'https://example.com/approve?token=a'
    );
  });

  test('sendVerificationEmail records the verify URL for e2e', async () => {
    vi.stubEnv('VITE_E2E', '1');
    mockConsole();
    const auth = getAuth(e2ePlatform(), 'https://example.com');
    await auth.options.emailVerification!.sendVerificationEmail!({
      user: { email: 'new@example.com' },
      url: 'https://example.com/verify?token=v'
    } as never);
    expect(readE2eMail('change-email-verify', 'new@example.com')).toBe(
      'https://example.com/verify?token=v'
    );
  });

  test('records nothing outside an e2e build', async () => {
    // Pinned off: a shell that exports VITE_E2E=1 must not flip this case.
    vi.stubEnv('VITE_E2E', '');
    mockConsole();
    const auth = getAuth(e2ePlatform(), 'https://example.com');
    await auth.options.emailVerification!.sendVerificationEmail!({
      user: { email: 'new@example.com' },
      url: 'https://example.com/verify?token=v'
    } as never);
    expect(readE2eMail('change-email-verify', 'new@example.com')).toBeNull();
  });
});
