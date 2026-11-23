import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { AUTH_COPY } from '$lib/account/copy';
import type { AuthMethod } from '$lib/server/auth/methods';
import Page from './+page.svelte';

const signInPasskey = vi.fn().mockResolvedValue({ data: {} });
const signInSocial = vi.fn();
vi.mock('$lib/account/auth-client', () => ({
  authClient: {
    signIn: {
      passkey: (...a: unknown[]) => signInPasskey(...a),
      social: (...a: unknown[]) => signInSocial(...a)
    }
  }
}));

const ALL: AuthMethod[] = ['magic-link', 'password', 'passkey', 'google'];

type Props = Parameters<typeof render<typeof Page>>[1];

/** The page's props: the load's fields (every method on unless `data` says otherwise). */
function props(data: Record<string, unknown> = {}, form: Record<string, unknown> | null = null) {
  return {
    data: {
      signup: false,
      googleError: false,
      linkError: false,
      pendingIdentifier: null,
      reset: false,
      methods: ALL,
      ...data
    },
    form
  } as unknown as Props;
}

test('offers Google sign-in in sign-in mode and calls signIn.social when clicked', async () => {
  const screen = await render(Page, props());
  await screen.getByRole('button', { name: AUTH_COPY.googleButton }).click();
  expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));
});

test('offers Google sign-in in sign-up mode', async () => {
  const screen = await render(Page, props({ signup: true }));
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.googleButton }))
    .toBeInTheDocument();
});

test('offers passkey sign-in and calls signIn.passkey when clicked', async () => {
  // Return an error so the component skips window.location navigation (which would kill the iframe)
  signInPasskey.mockResolvedValueOnce({ error: { message: 'cancelled' } });
  const screen = await render(Page, props());
  await screen.getByRole('button', { name: AUTH_COPY.passkeyButton }).click();
  expect(signInPasskey).toHaveBeenCalled();
});

test('sign-in mode: Choose one label, passkey, and the email-or-handle field', async () => {
  const screen = await render(Page, props());
  await expect.element(screen.getByText(AUTH_COPY.chooseOne)).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.passkeyButton }))
    .toBeInTheDocument();
  await expect.element(screen.getByLabelText(AUTH_COPY.identifierLabel)).toBeInTheDocument();
});

test('sign-up mode: Sign up heading, email-only, no passkey, no Choose one', async () => {
  const screen = await render(Page, props({ signup: true }));
  await expect.element(screen.getByRole('heading', { name: AUTH_COPY.signUp })).toBeInTheDocument();
  await expect.element(screen.getByLabelText(AUTH_COPY.emailLabel)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: AUTH_COPY.passkeyButton }).elements()).toHaveLength(0);
  expect(screen.getByText(AUTH_COPY.chooseOne).elements()).toHaveLength(0);
  expect(screen.container.querySelector('#identifier')!.getAttribute('autocomplete')).toBe('email');
});

test('reveals a password field behind the toggle', async () => {
  const screen = await render(Page, props());
  await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  await expect.element(screen.getByLabelText(AUTH_COPY.passwordLabel)).toBeInTheDocument();
});

test('keeps the magic-link submit as the default path', async () => {
  const screen = await render(Page, props());
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.emailMeLink }))
    .toBeInTheDocument();
  // The password field stays behind the toggle until asked for.
  expect(screen.getByLabelText(AUTH_COPY.passwordLabel).elements()).toHaveLength(0);
});

test('the password submit posts to the signInPassword action', async () => {
  const screen = await render(Page, props());
  await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  const button = screen.container.querySelector('[data-testid="password-submit"]')!;
  expect(button.getAttribute('formaction')).toBe('?/signInPassword');
  // Shares the sendLink form, so the identifier rides along.
  expect(button.closest('form')!.getAttribute('action')).toBe('?/sendLink');
});

test('keeps the password field revealed after a failed password sign-in', async () => {
  // The server re-renders with a fresh `form` after a failure; a mirrored local toggle
  // would collapse the field and orphan the error. The reveal is derived, so it stays.
  const screen = await render(Page, props({}, { error: AUTH_COPY.signinFailed }));
  await expect.element(screen.getByLabelText(AUTH_COPY.passwordLabel)).toBeInTheDocument();
});

test('keeps the password field revealed after a non-signin-failed error (no-JS path)', async () => {
  // On the no-JS full-page-POST path use:enhance never runs, so the local `toggledPassword`
  // toggle resets to its initial value on reload: only the derived clause keeps the field
  // open. It must not be narrowed to signinFailed alone: a 429 (rate limit) is just as
  // reachable while in password mode, and would otherwise collapse the field and orphan
  // its own error.
  const screen = await render(Page, props({}, { error: AUTH_COPY.tooManySignin }));
  await expect.element(screen.getByLabelText(AUTH_COPY.passwordLabel)).toBeInTheDocument();
});

test('a Cancel link collapses the password field and clears its value', async () => {
  const screen = await render(Page, props());
  await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  const input = screen.getByLabelText(AUTH_COPY.passwordLabel);
  await input.fill('correct horse battery staple');
  await screen.getByRole('button', { name: AUTH_COPY.cancel }).click();
  expect(screen.getByLabelText(AUTH_COPY.passwordLabel).elements()).toHaveLength(0);
  // Reopening must not resurrect the cleared value.
  await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  await expect.element(screen.getByLabelText(AUTH_COPY.passwordLabel)).toHaveValue('');
});

test('omits the password option in sign-up mode', async () => {
  // There is no password sign-up path, so offering one here would be a dead end.
  const screen = await render(Page, props({ signup: true }));
  expect(screen.getByRole('button', { name: AUTH_COPY.usePassword }).elements()).toHaveLength(0);
});

test('associates the server error with the identifier field and focuses it', async () => {
  const { container } = await render(Page, props({}, { error: AUTH_COPY.enterIdentifier }));
  const input = container.querySelector('#identifier')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe('identifier-error');
  expect(container.querySelector('#identifier-error')!.textContent).toContain(
    AUTH_COPY.enterIdentifier
  );
  await expect.poll(() => document.activeElement).toBe(input);
});

test('sent state announces via the persistent status node and focuses it', async () => {
  const { container } = await render(Page, props({}, { sent: true }));
  const status = container.querySelector('[data-testid="form-status"]') as HTMLElement;
  expect(status.getAttribute('role')).toBe('status');
  expect(status.textContent).toContain(AUTH_COPY.emailSent);
  await expect.poll(() => document.activeElement).toBe(status);
});

test('shows the dev link in the sent state when the server returned one', async () => {
  const screen = await render(
    Page,
    props({}, { sent: true, devLink: 'http://localhost/api/auth/magic-link/verify?token=t' })
  );
  await expect.element(screen.getByTestId('dev-link')).toHaveTextContent(AUTH_COPY.devLink);
});

test('google error routes through the status node with error tone', async () => {
  const { container } = await render(Page, props({ googleError: true }));
  const status = container.querySelector('[data-testid="form-status"]')!;
  expect(status.textContent).toContain(AUTH_COPY.googleError);
  expect(status.getAttribute('data-tone')).toBe('error');
});

test('seeds the identifier field from a stashed pending identifier (SC 3.3.7 Redundant Entry)', async () => {
  const { container } = await render(Page, props({ pendingIdentifier: 'someone@example.com' }));
  const input = container.querySelector('#identifier') as HTMLInputElement;
  expect(input.value).toBe('someone@example.com');
});

test('no aria-invalid/describedby without an error', async () => {
  const { container } = await render(Page, props());
  const input = container.querySelector('#identifier')!;
  expect(input.getAttribute('aria-invalid')).toBeNull();
  expect(input.getAttribute('aria-describedby')).toBeNull();
});

test('renders no "Start fresh without an account"', async () => {
  const screen = await render(Page, props());
  await expect.element(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(screen.getByText('Start fresh without an account').elements()).toHaveLength(0);
});

test('offers a forgot-password link once password mode is open', async () => {
  const screen = await render(Page, props());
  // Not offered before the password field is revealed.
  await expect
    .element(screen.getByRole('link', { name: AUTH_COPY.forgotPassword }))
    .not.toBeInTheDocument();
  await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  await expect
    .element(screen.getByRole('link', { name: AUTH_COPY.forgotPassword }))
    .toBeInTheDocument();
});

test('auth inputs carry the autocomplete tokens password managers key on (SC 3.3.8)', async () => {
  const screen = await render(Page, props());
  await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  const c = screen.container;
  expect(c.querySelector('#identifier')!.getAttribute('autocomplete')).toBe('username');
  expect(c.querySelector('#password')!.getAttribute('autocomplete')).toBe('current-password');
});

test('shows the post-reset confirmation when arriving with ?reset=1', async () => {
  const screen = await render(Page, props({ reset: true }));
  await expect
    .element(screen.getByTestId('reset-done'))
    .toHaveTextContent(AUTH_COPY.passwordResetDone);
});

test('default methods render no password field, no passkey button, no Google button', async () => {
  const screen = await render(Page, props({ methods: ['magic-link'] }));
  expect(screen.getByRole('button', { name: AUTH_COPY.usePassword }).elements()).toHaveLength(0);
  expect(screen.getByLabelText(AUTH_COPY.passwordLabel).elements()).toHaveLength(0);
  expect(screen.getByRole('button', { name: AUTH_COPY.passkeyButton }).elements()).toHaveLength(0);
  expect(screen.getByRole('button', { name: AUTH_COPY.googleButton }).elements()).toHaveLength(0);
  expect(screen.getByText(AUTH_COPY.chooseOne).elements()).toHaveLength(0);
  // The magic link stays.
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.emailMeLink }))
    .toBeInTheDocument();
});

test('every method on renders the password toggle, the passkey button and the Google button', async () => {
  const screen = await render(Page, props({ methods: ALL }));
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.usePassword }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.passkeyButton }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.googleButton }))
    .toBeInTheDocument();
});

test('each method renders only its own control', async () => {
  for (const [method, shown, hidden] of [
    ['password', AUTH_COPY.usePassword, [AUTH_COPY.passkeyButton, AUTH_COPY.googleButton]],
    ['passkey', AUTH_COPY.passkeyButton, [AUTH_COPY.usePassword, AUTH_COPY.googleButton]],
    ['google', AUTH_COPY.googleButton, [AUTH_COPY.usePassword, AUTH_COPY.passkeyButton]]
  ] as const) {
    const screen = await render(Page, props({ methods: ['magic-link', method] }));
    await expect.element(screen.getByRole('button', { name: shown })).toBeInTheDocument();
    for (const name of hidden) {
      expect(
        screen.getByRole('button', { name }).elements(),
        `${method} hides ${name}`
      ).toHaveLength(0);
    }
    screen.unmount();
  }
});

test('carries returnTo on the form actions, which would otherwise drop the query', async () => {
  const stub = (await import('$app/state')).page;
  const before = stub.url;
  stub.url = new URL('http://localhost/signin?returnTo=/account') as never;
  try {
    const screen = await render(Page, props());
    await screen.getByRole('button', { name: AUTH_COPY.usePassword }).click();
    const submit = screen.container.querySelector('[data-testid="password-submit"]')!;
    expect(submit.getAttribute('formaction')).toBe('?/signInPassword&returnTo=%2Faccount');
    expect(submit.closest('form')!.getAttribute('action')).toBe('?/sendLink&returnTo=%2Faccount');
  } finally {
    stub.url = before;
  }
});

test('drops an unsafe returnTo from the form actions', async () => {
  const stub = (await import('$app/state')).page;
  const before = stub.url;
  stub.url = new URL('http://localhost/signin?returnTo=//evil.com') as never;
  try {
    const screen = await render(Page, props());
    const form = screen.container.querySelector('#identifier')!.closest('form')!;
    expect(form.getAttribute('action')).toBe('?/sendLink');
  } finally {
    stub.url = before;
  }
});

test('a stale form error does not reveal a password field when password is off', async () => {
  const screen = await render(
    Page,
    props({ methods: ['magic-link'] }, { error: AUTH_COPY.enterIdentifier })
  );
  expect(screen.getByLabelText(AUTH_COPY.passwordLabel).elements()).toHaveLength(0);
});

test('with no sign-in method in effect renders its heading and no form', async () => {
  const screen = await render(Page, props({ methods: [] }));
  await expect
    .element(screen.getByRole('heading', { level: 1 }))
    .toHaveTextContent(AUTH_COPY.signIn);
  expect(screen.container.querySelector('form')).toBeNull();
  expect(screen.container.querySelector('#identifier')).toBeNull();
  expect(screen.getByTestId('sendlink-submit').elements()).toHaveLength(0);
  expect(screen.getByRole('button', { name: AUTH_COPY.emailMeLink }).elements()).toHaveLength(0);
});

test('with password but no magic link: the password field shows and posts to signInPassword', async () => {
  const screen = await render(Page, props({ methods: ['password'] }));
  await expect.element(screen.getByLabelText(AUTH_COPY.passwordLabel)).toBeInTheDocument();
  expect(screen.getByTestId('sendlink-submit').elements()).toHaveLength(0);
  expect(screen.getByTestId('password-cancel').elements()).toHaveLength(0);
  const form = screen.container.querySelector('#identifier')!.closest('form')!;
  expect(form.getAttribute('action')).toMatch(/^\?\/signInPassword/);
});

test('a failed magic link shows one line in the status under the heading', async () => {
  const screen = await render(Page, props({ methods: ['magic-link'], linkError: true }));
  const status = screen.getByTestId('form-status');
  await expect.element(status).toHaveTextContent(AUTH_COPY.linkFailed);
  await expect.element(status).toHaveAttribute('data-tone', 'error');
  expect(status.element().textContent).not.toContain(AUTH_COPY.googleError);
});

test('with passkey only and no link: no form posts to a method that is off', async () => {
  const screen = await render(Page, props({ methods: ['passkey'] }));
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.passkeyButton }))
    .toBeInTheDocument();
  // Enter in a field would submit its form to the form's action: there must be none here
  // that answers 404 (signInPassword with password off, sendLink with no mail).
  for (const form of screen.container.querySelectorAll('form')) {
    const action = form.getAttribute('action') ?? '';
    expect(action).not.toMatch(/signInPassword|sendLink/);
    for (const b of form.querySelectorAll('[formaction]')) {
      expect(b.getAttribute('formaction')).not.toMatch(/signInPassword|sendLink/);
    }
  }
});
