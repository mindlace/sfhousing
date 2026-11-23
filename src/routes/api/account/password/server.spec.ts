import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { AUTH_COPY } from '$lib/account/copy';
import { PASSWORD_MAX_LENGTH } from '$lib/server/auth/password-policy';

const {
  setPassword,
  changePassword,
  revokeOtherSessions,
  mayRemove,
  hasPw,
  liveUser,
  breached,
  deleteWhere,
  enforceRate
} = vi.hoisted(() => ({
  setPassword: vi.fn(async (_opts: { body: Record<string, unknown> }) => ({})),
  changePassword: vi.fn(async (_opts: { body: Record<string, unknown> }) => ({})),
  revokeOtherSessions: vi.fn(async () => ({ status: true })),
  mayRemove: vi.fn(async () => true),
  hasPw: vi.fn(async () => true),
  liveUser: vi.fn(
    async (): Promise<{ id: string; email: string | null; emailVerified: boolean } | null> => ({
      id: 'live1',
      email: null,
      emailVerified: false
    })
  ),
  breached: vi.fn(async () => false),
  deleteWhere: vi.fn(async (_predicate: unknown) => undefined),
  enforceRate: vi.fn(async () => true)
}));

vi.mock('$lib/server/auth/better-auth', () => ({
  authFor: () => ({ api: { setPassword, changePassword, revokeOtherSessions } })
}));
vi.mock('$lib/server/user-store/password-credential', () => ({
  mayRemovePasswordForUser: mayRemove,
  hasPasswordForUser: hasPw,
  liveUserFor: liveUser
}));
vi.mock('$lib/server/auth/password-breach', () => ({ isPasswordBreached: breached }));
vi.mock('$lib/server/security/rate-limit', () => ({ enforceRate }));
vi.mock('$lib/server/db', () => ({
  getDb: () => ({ delete: () => ({ where: deleteWhere }) })
}));

import { POST, DELETE } from './+server';
import { account } from '$lib/server/db/schema';

// `ACCOUNT_EDIT_RL` must be present: `enforceRate` is called with `critical:
// true`, and a missing binding takes its "critical limiter binding missing"
// branch, which writes to stderr — a signoff failure even when tests pass.
const platform = {
  env: { ACCOUNT_EDIT_RL: {}, AUTH_METHODS: 'password' }
} as unknown as App.Platform;
const locals = { user: { id: 'u1' }, session: { id: 's1', userId: 'live1' } };
const anonymous = { user: null, session: null };
const validPassword = 'correct horse battery staple';
const currentPassword = 'the previous passphrase';
const liveUserId = 'live1';
const CREDENTIAL = 'credential';

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/account/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function evt(body: unknown, over: Record<string, unknown> = {}) {
  return {
    request: req(body),
    url: new URL('http://localhost/api/account/password'),
    locals,
    platform,
    getClientAddress: () => '1.2.3.4',
    ...over
  } as never;
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.clearAllMocks();
  mayRemove.mockResolvedValue(true);
  // No password yet is the default: POST then takes the SET branch.
  hasPw.mockResolvedValue(false);
  breached.mockResolvedValue(false);
  liveUser.mockResolvedValue({ id: liveUserId, email: null, emailVerified: false });
  enforceRate.mockResolvedValue(true);
});

/**
 * Flatten a drizzle SQL predicate into the column names and bound values it
 * references, so a test can assert WHAT a `where` was scoped to rather than
 * merely that it was called.
 */
function predicateOf(node: unknown, out = { params: [] as unknown[], columns: [] as string[] }) {
  if (!node || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.queryChunks)) n.queryChunks.forEach((chunk) => predicateOf(chunk, out));
  if ('value' in n && 'encoder' in n) out.params.push(n.value);
  if (typeof n.name === 'string' && 'table' in n) out.columns.push(n.name);
  return out;
}

describe('POST /api/account/password', () => {
  it('rejects an anonymous caller with 401 before touching better-auth', async () => {
    const res = await POST(evt({ password: validPassword }, { locals: anonymous }));
    expect(res.status).toBe(401);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it.each([
    ['too short', 'short'],
    ['too long', 'a'.repeat(PASSWORD_MAX_LENGTH + 1)]
  ])(
    'rejects an out-of-bounds password (%s) without calling better-auth',
    async (_label, password) => {
      const res = await POST(evt({ password }));
      expect(res.status).toBe(400);
      expect(setPassword).not.toHaveBeenCalled();
    }
  );

  it('returns 429 when the rate limiter refuses, before touching better-auth', async () => {
    enforceRate.mockResolvedValueOnce(false);
    const res = await POST(evt({ password: validPassword }));
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.tooManyChanges);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('rejects a breached password with the password-specific message', async () => {
    breached.mockResolvedValueOnce(true);
    const res = await POST(evt({ password: validPassword }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(AUTH_COPY.passwordBreached);
    expect(setPassword).not.toHaveBeenCalled();
  });

  // Setting a FIRST password is add-a-credential, not rotation. There is no old password
  // to invalidate and the user's other devices are legitimately their own, so signing
  // them out would be gratuitous. `setPassword` has no revoke flag at all — asserting the
  // exact body is what keeps one from being added by reflex.
  it('sets a valid password when none is set yet (exact body — no revoke flag)', async () => {
    const res = await POST(evt({ password: validPassword }));
    expect(res.status).toBe(200);
    expect(setPassword.mock.calls[0][0].body).toEqual({ newPassword: validPassword });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('reports a password that is already set as a 409', async () => {
    setPassword.mockRejectedValueOnce(
      Object.assign(new Error('already set'), { body: { code: 'PASSWORD_ALREADY_SET' } })
    );
    const res = await POST(evt({ password: validPassword }));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.passwordAlreadySet);
  });

  it('reports an unknown better-auth failure as a generic 400', async () => {
    setPassword.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(evt({ password: validPassword }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.passwordSetError);
  });
});

describe('POST /api/account/password — changing an existing password', () => {
  beforeEach(() => hasPw.mockResolvedValue(true));

  // A change is a credential rotation: every session minted under the OLD password must
  // die. Better-Auth's flag deletes all of them and re-mints the caller's, rotating the
  // cookie via the sveltekitCookies after-hook — so the acting user stays signed in and
  // every other device is evicted.
  it('routes to changePassword with the supplied current password', async () => {
    const res = await POST(evt({ password: validPassword, currentPassword }));
    expect(res.status).toBe(200);
    expect(changePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { newPassword: validPassword, currentPassword, revokeOtherSessions: true }
      })
    );
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('refuses to change without the current password', async () => {
    const res = await POST(evt({ password: validPassword }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.passwordCurrentRequired);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('reports a wrong current password distinctly from a generic failure', async () => {
    changePassword.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { body: { code: 'INVALID_PASSWORD' } })
    );
    const res = await POST(evt({ password: validPassword, currentPassword }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.passwordCurrentWrong);
  });

  it('breach-checks the NEW password on the change path too', async () => {
    breached.mockResolvedValueOnce(true);
    const res = await POST(evt({ password: validPassword, currentPassword }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(AUTH_COPY.passwordBreached);
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/account/password', () => {
  beforeEach(() => hasPw.mockResolvedValue(true));

  it('rejects an anonymous caller with 401', async () => {
    const res = await DELETE(evt(null, { locals: anonymous }));
    expect(res.status).toBe(401);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('returns 429 when the rate limiter refuses, deleting nothing', async () => {
    enforceRate.mockResolvedValueOnce(false);
    const res = await DELETE(evt(null));
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.tooManyChanges);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('refuses when the password is the last way back in, deleting nothing', async () => {
    mayRemove.mockResolvedValueOnce(false);
    const res = await DELETE(evt(null));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe(ACCOUNT_COPY.passwordLastFactor);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('scopes the delete to THIS user and ONLY the credential provider', async () => {
    const res = await DELETE(evt(null));
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalledOnce();
    const { params, columns } = predicateOf(deleteWhere.mock.calls[0][0]);
    // Both halves of the scoping must be present, or the delete could widen to
    // every credential row, or to every account row this user owns.
    expect(columns).toContain(account.userId.name);
    expect(columns).toContain(account.providerId.name);
    expect(params).toContain(liveUserId);
    expect(params).toContain(CREDENTIAL);
    expect(params).toHaveLength(2);
  });

  it('deletes against the LIVE user row, not the raw session user id', async () => {
    const survivor = 'live-survivor';
    liveUser.mockResolvedValueOnce({ id: survivor, email: null, emailVerified: false });
    await DELETE(evt(null));
    expect(predicateOf(deleteWhere.mock.calls[0][0]).params).toContain(survivor);
  });

  it('is idempotent when no password is set', async () => {
    hasPw.mockResolvedValueOnce(false);
    const res = await DELETE(evt(null));
    expect(res.status).toBe(200);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('is a no-op when the identity resolves to no live user', async () => {
    liveUser.mockResolvedValueOnce(null);
    const res = await DELETE(evt(null));
    expect(res.status).toBe(200);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  // Removing the credential is a credential change like the others. The last-factor
  // guard above has already proven another way back in exists, so the acting session is
  // safe to keep — but sessions elsewhere must not outlive the password that may have
  // minted them.
  it('revokes other sessions after removing the password', async () => {
    const res = await DELETE(evt(null));
    expect(res.status).toBe(200);
    expect(revokeOtherSessions).toHaveBeenCalledOnce();
  });

  // Order matters: revoking first would evict the user's other devices even on a run
  // that then removes nothing at all.
  it('does not revoke when removal is refused by the last-factor guard', async () => {
    mayRemove.mockResolvedValueOnce(false);
    const res = await DELETE(evt(null));
    expect(res.status).toBe(409);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });

  // The idempotent no-password path returns before the delete, so there is no
  // credential rotation to propagate — evicting devices there would be a sign-out
  // triggered by a request that changed nothing.
  // The credential row is already gone by the time revocation runs, so a throw here
  // must not turn a successful removal into a 500 the user would read as "it failed".
  it('still reports success when revocation fails after the credential is deleted', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    revokeOtherSessions.mockRejectedValueOnce(new Error('session store unavailable'));
    const res = await DELETE(evt(null));
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith('auth.revoke_error', expect.anything());
    logged.mockRestore();
  });

  it('does not revoke when there was no password to remove', async () => {
    hasPw.mockResolvedValueOnce(false);
    const res = await DELETE(evt(null));
    expect(res.status).toBe(200);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });
});

describe('/api/account/password with password sign-in off', () => {
  const off = { env: { ACCOUNT_EDIT_RL: {} } } as unknown as App.Platform;

  async function statusOf(call: () => unknown): Promise<number | undefined> {
    try {
      await call();
    } catch (err) {
      return (err as { status?: number }).status;
    }
    return undefined;
  }

  it('POST answers 404 before reaching setPassword, changePassword or any read', async () => {
    const status = await statusOf(() => POST(evt({ password: validPassword }, { platform: off })));
    expect(status).toBe(404);
    expect(setPassword).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
    expect(liveUser).not.toHaveBeenCalled();
    expect(enforceRate).not.toHaveBeenCalled();
    expect(breached).not.toHaveBeenCalled();
  });

  it('POST answers 404 for a signed-out caller too, before the 401', async () => {
    const status = await statusOf(() =>
      POST(evt({ password: validPassword }, { platform: off, locals: anonymous }))
    );
    expect(status).toBe(404);
  });

  it('DELETE answers 404 and deletes nothing', async () => {
    const status = await statusOf(() => DELETE(evt(null, { platform: off })));
    expect(status).toBe(404);
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(mayRemove).not.toHaveBeenCalled();
  });

  it('answers 404 under an AUTH_METHODS that lists only other methods', async () => {
    const other = {
      env: { ACCOUNT_EDIT_RL: {}, AUTH_METHODS: 'passkey' }
    } as unknown as App.Platform;
    const status = await statusOf(() =>
      POST(evt({ password: validPassword }, { platform: other }))
    );
    expect(status).toBe(404);
    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe('cross-site guard on /api/account/password', () => {
  it('POST: 415 when the body is not JSON, before any read or write', async () => {
    const request = req({ password: validPassword }, { 'content-type': 'text/plain' });
    const res = await POST(evt(null, { request }));
    expect(res.status).toBe(415);
    expect(await errorOf(res)).toBe(AUTH_COPY.jsonRequired);
    expect(enforceRate).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('POST: 403 for a foreign Origin, before any read or write', async () => {
    const request = req({ password: validPassword }, { origin: 'https://evil.example' });
    const res = await POST(evt(null, { request }));
    expect(res.status).toBe(403);
    expect(enforceRate).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('DELETE: 415 when the body is not JSON, deleting nothing', async () => {
    const request = req(null, { 'content-type': 'text/plain' });
    const res = await DELETE(evt(null, { request }));
    expect(res.status).toBe(415);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('DELETE: 403 for a foreign Origin, deleting nothing', async () => {
    const request = req(null, { origin: 'https://evil.example' });
    const res = await DELETE(evt(null, { request }));
    expect(res.status).toBe(403);
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
