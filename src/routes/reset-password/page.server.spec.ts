import { expect, test, vi, beforeEach } from 'vitest';
import { AUTH_COPY, passwordTooShort } from '$lib/account/copy';
import { PASSWORD_MIN_LENGTH } from '$lib/server/auth/password-policy';

const resetPassword = vi.fn().mockResolvedValue({ status: true });
const isPasswordBreached = vi.fn().mockResolvedValue(false);
const enforceRate = vi.fn().mockResolvedValue(true);

vi.mock('$lib/server/auth/better-auth', () => ({
  authFor: () => ({ api: { resetPassword: (...a: unknown[]) => resetPassword(...a) } })
}));
vi.mock('$lib/server/auth/password-breach', () => ({
  isPasswordBreached: (...a: unknown[]) => isPasswordBreached(...a)
}));
vi.mock('$lib/server/security/rate-limit', () => ({
  enforceRate: (...a: unknown[]) => enforceRate(...a)
}));

const { load, actions } = await import('./+page.server');

const platform = (env: Record<string, unknown> = {}) => ({
  env: { AUTH_METHODS: 'password', AUTH_PASSWORD_RL: {}, ...env }
});

function eventWithForm(fields: Record<string, string>, env: Record<string, unknown> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request('https://example.com/reset-password', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.1' }
  });
  request.formData = async () => form;
  return {
    request,
    platform: platform(env),
    url: new URL('https://example.com/reset-password'),
    cookies: { get: vi.fn() },
    locals: {}
  } as never;
}

function loadEvent(search: string, env: Record<string, unknown> = {}) {
  return {
    url: new URL(`https://example.com/reset-password${search}`),
    platform: platform(env),
    cookies: { get: vi.fn() }
  } as never;
}

const good = 'correct-horse-battery-staple-42';

beforeEach(() => {
  vi.clearAllMocks();
  isPasswordBreached.mockResolvedValue(false);
  enforceRate.mockResolvedValue(true);
  // vi.clearAllMocks() only clears call history, not a mockRejectedValue set by an
  // earlier test: restore the happy-path implementation each time so tests don't
  // depend on file order.
  resetPassword.mockResolvedValue({ status: true });
});

test('load surfaces the token from the query string', () => {
  expect(load(loadEvent('?token=abc'))).toEqual({ token: 'abc', invalid: false });
});

test('load flags an invalid-token bounce', () => {
  expect(load(loadEvent('?error=INVALID_TOKEN'))).toMatchObject({ invalid: true });
});

test('mismatched confirmation is rejected before Better-Auth is called', async () => {
  const res = await actions.resetPassword(
    eventWithForm({ token: 't', password: good, confirm: `${good}x` })
  );
  expect(resetPassword).not.toHaveBeenCalled();
  expect(res).toMatchObject({ status: 400, data: { error: AUTH_COPY.resetMismatch } });
});

test('a too-short password is rejected with the policy message', async () => {
  const res = await actions.resetPassword(
    eventWithForm({ token: 't', password: 'short', confirm: 'short' })
  );
  expect(resetPassword).not.toHaveBeenCalled();
  expect(res).toMatchObject({
    status: 400,
    data: { error: passwordTooShort(PASSWORD_MIN_LENGTH) }
  });
});

test('exceeding the per-IP rate limit is refused before the breach check runs', async () => {
  // This is the amplification guard: isPasswordBreached makes an outbound HIBP
  // lookup, and it must never fire for an unlimited stream of junk tokens from one
  // IP. The rate limit is the only thing standing in front of that lookup on this
  // action (it never traverses the [...all] catch-all's limiter).
  enforceRate.mockResolvedValue(false);
  const res = await actions.resetPassword(
    eventWithForm({ token: 't', password: good, confirm: good })
  );
  expect(res).toMatchObject({ status: 429, data: { error: AUTH_COPY.tooManySignin } });
  expect(isPasswordBreached).not.toHaveBeenCalled();
  expect(resetPassword).not.toHaveBeenCalled();
});

test('a breached password is rejected', async () => {
  isPasswordBreached.mockResolvedValue(true);
  const res = await actions.resetPassword(
    eventWithForm({ token: 't', password: good, confirm: good })
  );
  expect(resetPassword).not.toHaveBeenCalled();
  expect(res).toMatchObject({ status: 400, data: { error: AUTH_COPY.passwordBreached } });
});

test('a missing token is rejected as an invalid link', async () => {
  const res = await actions.resetPassword(
    eventWithForm({ token: '', password: good, confirm: good })
  );
  expect(res).toMatchObject({ status: 400, data: { error: AUTH_COPY.resetInvalid } });
});

test('a Better-Auth failure maps to the invalid-link message', async () => {
  resetPassword.mockRejectedValue(new Error('INVALID_TOKEN'));
  const res = await actions.resetPassword(
    eventWithForm({ token: 't', password: good, confirm: good })
  );
  expect(res).toMatchObject({ status: 400, data: { error: AUTH_COPY.resetInvalid } });
});

test('a successful reset redirects to signin with the reset flag', async () => {
  await expect(
    actions.resetPassword(eventWithForm({ token: 't', password: good, confirm: good }))
  ).rejects.toMatchObject({ status: 303, location: '/signin?reset=1' });
  expect(resetPassword).toHaveBeenCalledWith(
    expect.objectContaining({ body: { token: 't', newPassword: good } })
  );
});

test('under the default methods the load answers 404', () => {
  expect(() => load(loadEvent('?token=abc', { AUTH_METHODS: 'magic-link' }))).toThrowError(
    expect.objectContaining({ status: 404 })
  );
});

test('under the default methods the action answers 404 and does nothing', async () => {
  const event = eventWithForm(
    { token: 't', password: good, confirm: good },
    { AUTH_METHODS: 'magic-link' }
  );
  await expect(actions.resetPassword(event)).rejects.toMatchObject({ status: 404 });
  expect(enforceRate).not.toHaveBeenCalled();
  expect(resetPassword).not.toHaveBeenCalled();
});
