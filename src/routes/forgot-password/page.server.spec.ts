import { expect, test, vi, beforeEach } from 'vitest';
import { AUTH_COPY } from '$lib/account/copy';

const requestPasswordReset = vi.fn().mockResolvedValue({ status: true });
const resolveHandleToEmail = vi.fn();
const enforceRate = vi.fn().mockResolvedValue(true);

vi.mock('$lib/server/auth/better-auth', () => ({
  authFor: () => ({
    api: { requestPasswordReset: (...a: unknown[]) => requestPasswordReset(...a) }
  })
}));
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/auth/magic-link', () => ({
  resolveHandleToEmail: (...a: unknown[]) => resolveHandleToEmail(...a)
}));
vi.mock('$lib/server/security/rate-limit', () => ({
  enforceRate: (...a: unknown[]) => enforceRate(...a)
}));

const { load, actions } = await import('./+page.server');

function eventWithForm(fields: Record<string, string>, env: Record<string, unknown> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request('https://example.com/forgot-password', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.1' }
  });
  // The action reads the body via request.formData(); override it directly rather
  // than constructing a real multipart body.
  request.formData = async () => form;
  return {
    request,
    platform: { env: { AUTH_METHODS: 'password', AUTH_LINK_RL: {}, ...env } },
    url: new URL('https://example.com/forgot-password'),
    cookies: { get: vi.fn() },
    locals: {}
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  enforceRate.mockResolvedValue(true);
});

test('a raw email is passed through lowercased, with redirectTo pointing at /reset-password', async () => {
  const res = await actions.requestReset(eventWithForm({ identifier: 'Person@Example.com' }));
  expect(requestPasswordReset).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { email: 'person@example.com', redirectTo: '/reset-password' }
    })
  );
  expect(res).toEqual({ sent: true });
});

test('a handle is resolved to its email before sending', async () => {
  resolveHandleToEmail.mockResolvedValue('resolved@example.com');
  await actions.requestReset(eventWithForm({ identifier: 'alice' }));
  expect(requestPasswordReset).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { email: 'resolved@example.com', redirectTo: '/reset-password' }
    })
  );
});

test('an unresolvable handle returns the same neutral result and sends nothing', async () => {
  resolveHandleToEmail.mockResolvedValue(undefined);
  const res = await actions.requestReset(eventWithForm({ identifier: 'nobody' }));
  expect(requestPasswordReset).not.toHaveBeenCalled();
  expect(res).toEqual({ sent: true });
});

test('exceeding the per-email limit is silent: neutral result, no send', async () => {
  resolveHandleToEmail.mockResolvedValue('resolved@example.com');
  enforceRate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const res = await actions.requestReset(eventWithForm({ identifier: 'alice' }));
  expect(requestPasswordReset).not.toHaveBeenCalled();
  expect(res).toEqual({ sent: true });
});

test('exceeding the per-IP limit is a visible 429', async () => {
  enforceRate.mockResolvedValueOnce(false);
  const res = await actions.requestReset(eventWithForm({ identifier: 'alice' }));
  expect(res).toMatchObject({ status: 429, data: { error: AUTH_COPY.tooManySignin } });
});

test('an empty identifier fails before any limiter runs', async () => {
  const res = await actions.requestReset(eventWithForm({ identifier: '   ' }));
  expect(enforceRate).not.toHaveBeenCalled();
  expect(res).toMatchObject({ status: 400 });
});

test('under the default methods the load answers 404', () => {
  const event = eventWithForm({}, { AUTH_METHODS: 'magic-link' });
  expect(() => load(event as never)).toThrowError(expect.objectContaining({ status: 404 }));
});

test('under the default methods the action answers 404 and does nothing', async () => {
  const event = eventWithForm({ identifier: 'a@b.com' }, { AUTH_METHODS: 'magic-link' });
  await expect(actions.requestReset(event)).rejects.toMatchObject({ status: 404 });
  expect(enforceRate).not.toHaveBeenCalled();
  expect(requestPasswordReset).not.toHaveBeenCalled();
});
