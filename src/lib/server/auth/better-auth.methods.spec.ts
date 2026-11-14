import { afterEach, describe, it, expect, vi } from 'vitest';
import { count } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { freshDb, makePlatform } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { PASSKEY_RP_NAME, PSEUDONYMOUS_EMAIL_DOMAIN } from './brand';
import type { AuthMethod } from './methods';
import { PASSWORD_MIN_LENGTH } from './password-policy';

/** `sveltekitCookies` reads the request event in an after-hook; there is none in a spec. */
vi.mock('$app/server', () => ({
  getRequestEvent: () => ({ cookies: { set: () => {} } })
}));

const { getAuth } = await import('./better-auth');

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = 'http://localhost:5173';
const PASSWORD = `pw-${'x'.repeat(PASSWORD_MIN_LENGTH)}`;

/** A migrated DB and a platform with a 32-char secret and no `AUTH_METHODS`. */
function setup(env: Record<string, unknown> = {}) {
  const { db, shim } = freshDb();
  const platform = makePlatform(shim, { BETTER_AUTH_SECRET: 's'.repeat(32), ...env });
  return { db, platform };
}

function request(method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) {
  const headers = new Headers({ origin: ORIGIN });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function cookieHeader(setCookie: string | null): string {
  if (!setCookie) throw new Error('no session cookie');
  return setCookie
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

async function sessionCount(db: ReturnType<typeof setup>['db']): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.session);
  return row.n;
}

/** A pseudonymous account with a password set (password on while setting it). */
async function pseudonymousWithPassword(platform: App.Platform) {
  const auth = getAuth(platform, ORIGIN, {
    methods: new Set<AuthMethod>(['magic-link', 'password'])
  });
  const { headers, response } = await auth.api.signInAnonymous({ returnHeaders: true });
  await auth.api.setPassword({
    headers: new Headers({ cookie: cookieHeader(headers.get('set-cookie')) }),
    body: { newPassword: PASSWORD }
  });
  return { email: response!.user.email };
}

function pluginIds(auth: ReturnType<typeof getAuth>): string[] {
  return (auth.options.plugins ?? []).map((p: { id: string }) => p.id);
}

describe('Better-Auth with the default sign-in methods', () => {
  it('mints a pseudonymous user on the invalid synthetic domain', async () => {
    const { db, platform } = setup();
    const auth = getAuth(platform, ORIGIN);
    const res = await auth.api.signInAnonymous();
    expect(res?.user.email.endsWith(`@${PSEUDONYMOUS_EMAIL_DOMAIN}`)).toBe(true);
    expect(res?.user.email.endsWith('@pseudonymous.sfhousing.invalid')).toBe(true);
    const [row] = await db.select().from(schema.user);
    expect(row.isAnonymous).toBe(true);
    expect(row.email).toBe(res?.user.email);
  });

  it('refuses password sign-in by default', async () => {
    const { db, platform } = setup();
    const { email } = await pseudonymousWithPassword(platform);
    const before = await sessionCount(db);
    const auth = getAuth(platform, ORIGIN);
    const { error } = mockConsole('error');
    const res = await auth.handler(
      request('POST', '/sign-in/email', { email, password: PASSWORD })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('session_token=');
    expect(await sessionCount(db)).toBe(before);
    expect(String(error.mock.calls[0])).toContain('Email and password is not enabled');
  });

  it('serves no passkey endpoints by default', async () => {
    const { platform } = setup();
    const auth = getAuth(platform, ORIGIN);
    const res = await auth.handler(request('GET', '/passkey/generate-register-options'));
    expect(res.status).toBe(404);
  });

  it('offers no Google provider by default', async () => {
    const { platform } = setup();
    const auth = getAuth(platform, ORIGIN);
    const { error } = mockConsole('error');
    const res = await auth.handler(
      request('POST', '/sign-in/social', { provider: 'google', callbackURL: '/' })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(error.mock.calls[0])).toContain('Provider not found');
  });

  it('builds no configuration for the methods that are off', () => {
    const { platform } = setup({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
    const auth = getAuth(platform, ORIGIN);
    expect(auth.options.emailAndPassword?.enabled).toBe(false);
    expect(pluginIds(auth)).not.toContain('passkey');
    expect(Object.keys(auth.options.socialProviders ?? {})).not.toContain('google');
  });

  it('keeps the pseudonymous account, magic link and sveltekitCookies last', () => {
    const { platform } = setup();
    const ids = pluginIds(getAuth(platform, ORIGIN));
    expect(ids).toContain('anonymous');
    expect(ids).toContain('magic-link');
    expect(ids[ids.length - 1]).toBe('sveltekit-cookies');
  });
});

describe('Better-Auth with a method switched on', () => {
  it('accepts password sign-in when the method is on', async () => {
    const { db, platform } = setup();
    const { email } = await pseudonymousWithPassword(platform);
    const before = await sessionCount(db);
    const auth = getAuth(platform, ORIGIN, {
      methods: new Set<AuthMethod>(['magic-link', 'password'])
    });
    const res = await auth.handler(
      request('POST', '/sign-in/email', { email, password: PASSWORD })
    );
    expect(res.status).toBe(200);
    expect(await sessionCount(db)).toBe(before + 1);
  });

  it('registers the passkey plugin with the product as relying party when on', () => {
    const { platform } = setup();
    const auth = getAuth(platform, ORIGIN, {
      methods: new Set<AuthMethod>(['magic-link', 'passkey'])
    });
    const plugin = (auth.options.plugins ?? []).find((p: { id: string }) => p.id === 'passkey') as
      { options?: { rpName?: string; rpID?: string } } | undefined;
    expect(plugin?.options?.rpName).toBe(PASSKEY_RP_NAME);
    expect(plugin?.options?.rpID).toBe('localhost');
    expect(pluginIds(auth).at(-1)).toBe('sveltekit-cookies');
  });

  it('serves the passkey endpoints when on', async () => {
    const { platform } = setup();
    const auth = getAuth(platform, ORIGIN, {
      methods: new Set<AuthMethod>(['magic-link', 'passkey'])
    });
    const res = await auth.handler(request('GET', '/passkey/generate-register-options'));
    expect(res.status).not.toBe(404);
  });

  it('registers the Google provider when on', () => {
    const { platform } = setup({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
    const auth = getAuth(platform, ORIGIN, {
      methods: new Set<AuthMethod>(['magic-link', 'google'])
    });
    expect(auth.options.socialProviders?.google).toMatchObject({
      clientId: 'gid',
      clientSecret: 'gsecret'
    });
  });

  it('reads the default methods from AUTH_METHODS', () => {
    const { platform } = setup({ AUTH_METHODS: 'magic-link,password,passkey' });
    const auth = getAuth(platform, ORIGIN);
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(pluginIds(auth)).toContain('passkey');
  });

  it('leaves Google out of the default methods without a client id and secret', () => {
    const { platform } = setup({ AUTH_METHODS: 'magic-link,google' });
    const auth = getAuth(platform, ORIGIN);
    expect(Object.keys(auth.options.socialProviders ?? {})).not.toContain('google');
  });
});
