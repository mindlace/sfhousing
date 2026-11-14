import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AuthenticationPane from './AuthenticationPane.svelte';
import {
  ACCOUNT_COPY,
  emailChangeSent,
  emailConfirmed,
  emailSentTo,
  removePasskeyNamed
} from '$lib/account/account-copy';

const { passkey, linkSocial } = vi.hoisted(() => {
  const passkey = {
    listUserPasskeys: vi.fn(async () => ({ data: [{ id: 'pk1', name: 'my laptop' }] })),
    addPasskey: vi.fn(async () => ({})),
    deletePasskey: vi.fn(async () => ({}))
  };
  const linkSocial = vi.fn(async () => ({}));
  return { passkey, linkSocial };
});

vi.mock('$lib/account/auth-client', () => ({ authClient: { passkey, linkSocial } }));

const registered = { email: 'ada@x.com', handle: 'ada', name: 'Ada', pseudonymous: false };
const pseudonymous = { email: '', handle: 'ada', name: 'Ada', pseudonymous: true };
const passkeyName = 'my laptop';
const ALL = ['magic-link', 'password', 'passkey', 'google'];
const pwProps = { methods: ALL, hasPassword: false, canRemovePassword: false };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('AuthenticationPane', () => {
  it('removing a passkey calls deletePasskey with its id and says so inline', async () => {
    expect.hasAssertions();
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: true,
      ...pwProps
    });
    await expect.element(screen.getByText(passkeyName)).toBeInTheDocument();
    await screen.getByRole('button', { name: removePasskeyNamed(passkeyName) }).click();
    await vi.waitFor(() => expect(passkey.deletePasskey).toHaveBeenCalledWith({ id: 'pk1' }));
    await expect
      .element(screen.getByTestId('passkey-status'))
      .toHaveTextContent(ACCOUNT_COPY.passkeyRemoved);
  });

  it('shows connected Google state', async () => {
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: true,
      ...pwProps
    });
    await expect.element(screen.getByText(ACCOUNT_COPY.googleConnected)).toBeInTheDocument();
  });

  it('connects Google with callback "/"', async () => {
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: false,
      ...pwProps
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.googleConnect }).click();
    expect(linkSocial).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/' });
  });

  it('registered user sees confirmed email', async () => {
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: false,
      ...pwProps
    });
    await expect.element(screen.getByText(emailConfirmed('ada@x.com'))).toBeInTheDocument();
  });

  it('registered user can reveal change email form', async () => {
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: false,
      ...pwProps
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.changeEmail }).click();
    await expect.element(screen.getByLabelText(ACCOUNT_COPY.newEmailLabel)).toBeInTheDocument();
  });

  it('wraps the email section in a section with its heading', async () => {
    const screen = await render(AuthenticationPane, {
      user: { email: 'a@b.test', pseudonymous: false, handle: 'ada' },
      hasGoogle: false,
      ...pwProps
    });
    const heading = screen.getByRole('heading', { name: ACCOUNT_COPY.emailHeading }).element();
    expect(heading.closest('section')).not.toBeNull();
  });

  it('email input has autocomplete=email; error associates and focuses', async () => {
    expect.hasAssertions();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ changeError: ACCOUNT_COPY.invalidEmail }), { status: 400 })
      );
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: false,
      ...pwProps
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.changeEmail }).click();
    const input = screen.container.querySelector('#newEmail') as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('email');
    await screen.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
    await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('newEmail-error');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/account/email',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' }
      })
    );
  });

  it('email-change-sent announces via a focused status node', async () => {
    expect.hasAssertions();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emailChangeSent: true, email: 'x@y.z' }), { status: 200 })
    );
    const { container, getByRole } = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: false,
      ...pwProps
    });
    await getByRole('button', { name: ACCOUNT_COPY.changeEmail }).click();
    await getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
    const status = container.querySelector('[data-testid="email-status"]') as HTMLElement;
    expect(status.getAttribute('role')).toBe('status');
    await expect.poll(() => status.textContent).toContain(emailChangeSent('ada@x.com', 'x@y.z'));
    await expect.poll(() => document.activeElement).toBe(status);
  });

  it('each passkey remove button names its passkey', async () => {
    expect.hasAssertions();
    const { container } = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: true,
      ...pwProps
    });
    const btn = await vi.waitFor(() => {
      const el = container.querySelector(`[aria-label="${removePasskeyNamed(passkeyName)}"]`);
      if (!el) throw new Error('remove button not found yet');
      return el;
    });
    expect(btn).not.toBeNull();
  });

  it('passkey loading paragraph is a status region', async () => {
    expect.hasAssertions();
    // Keep the passkey fetch pending so the loading state is observable rather
    // than racing onMount's resolution.
    passkey.listUserPasskeys.mockReturnValueOnce(new Promise(() => {}));
    const { container } = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: true,
      ...pwProps
    });
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses.some((el) => el.textContent?.includes(ACCOUNT_COPY.loading))).toBe(true);
  });

  it('adding a passkey successfully says so inline', async () => {
    expect.hasAssertions();
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: true,
      ...pwProps
    });
    await expect.element(screen.getByText(passkeyName)).toBeInTheDocument();
    await screen.getByRole('button', { name: ACCOUNT_COPY.passkeyAdd }).click();
    await vi.waitFor(() => expect(passkey.addPasskey).toHaveBeenCalled());
    await expect
      .element(screen.getByTestId('passkey-status'))
      .toHaveTextContent(ACCOUNT_COPY.passkeyAdded);
  });

  it('a failed removal error replaces the status, and a later successful add replaces the error', async () => {
    expect.hasAssertions();
    passkey.deletePasskey.mockResolvedValueOnce({ error: { message: 'nope' } } as never);
    const screen = await render(AuthenticationPane, {
      user: registered,
      hasGoogle: true,
      ...pwProps
    });
    await expect.element(screen.getByText(passkeyName)).toBeInTheDocument();
    await screen.getByRole('button', { name: removePasskeyNamed(passkeyName) }).click();
    await vi.waitFor(() => expect(passkey.deletePasskey).toHaveBeenCalled());
    const status = screen.getByTestId('passkey-status');
    await expect.element(status).toHaveTextContent(ACCOUNT_COPY.passkeyRemoveError);
    expect(status.element().getAttribute('data-tone')).toBe('error');

    await screen.getByRole('button', { name: ACCOUNT_COPY.passkeyAdd }).click();
    await vi.waitFor(() => expect(passkey.addPasskey).toHaveBeenCalled());
    await expect.element(status).toHaveTextContent(ACCOUNT_COPY.passkeyAdded);
    expect(status.element().getAttribute('data-tone')).toBe('info');
  });

  it('pseudonymous user sees the add-email prompt, not the change-email flow', async () => {
    const screen = await render(AuthenticationPane, {
      user: pseudonymous,
      hasGoogle: false,
      ...pwProps
    });
    await expect.element(screen.getByText(ACCOUNT_COPY.emailAddPrompt)).toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.changeEmail }))
      .not.toBeInTheDocument();
  });

  it('pseudonymous user sends the verify link and sees the sent state', async () => {
    expect.hasAssertions();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emailSent: true, email: 'new@x.com' }), { status: 200 })
    );
    const screen = await render(AuthenticationPane, {
      user: pseudonymous,
      hasGoogle: false,
      ...pwProps
    });
    await screen.getByLabelText(ACCOUNT_COPY.emailLabel).fill('new@x.com');
    await screen.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/account/email/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      })
    );
    await expect.element(screen.getByText(emailSentTo('new@x.com'))).toBeInTheDocument();
  });

  it('pseudonymous user sees a dev-link anchor when the endpoint returns one', async () => {
    expect.hasAssertions();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          emailSent: true,
          email: 'new@x.com',
          devLink: 'https://app.test/api/auth/magic-link/verify?token=xyz'
        }),
        { status: 200 }
      )
    );
    const screen = await render(AuthenticationPane, {
      user: pseudonymous,
      hasGoogle: false,
      ...pwProps
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
    const link = screen.getByTestId('dev-link');
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute('href')).toBe(
      'https://app.test/api/auth/magic-link/verify?token=xyz'
    );
  });

  it('add-email error renders through FieldError and associates with the input', async () => {
    expect.hasAssertions();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ emailError: ACCOUNT_COPY.invalidEmail }), { status: 400 })
    );
    const { container } = await render(AuthenticationPane, {
      user: pseudonymous,
      hasGoogle: false,
      ...pwProps
    });
    const input = container.querySelector('#email') as HTMLInputElement;
    await (container.querySelector('button[type="submit"]') as HTMLElement).click();
    await expect.poll(() => input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');
    const err = container.querySelector('[data-testid="email-error"]') as HTMLElement;
    expect(err).not.toBeNull();
    expect(err.id).toBe('email-error');
    expect(err.textContent).toBe(ACCOUNT_COPY.invalidEmail);
  });

  describe('by sign-in method', () => {
    const none = { methods: ['magic-link'], hasPassword: false, canRemovePassword: false };

    it('with only the default methods shows the email section and no password, passkey or Google control', async () => {
      const screen = await render(AuthenticationPane, {
        user: registered,
        hasGoogle: false,
        ...none
      });
      await expect
        .element(screen.getByRole('heading', { name: ACCOUNT_COPY.emailHeading }))
        .toBeInTheDocument();
      const text = screen.container.textContent ?? '';
      expect(text).not.toContain(ACCOUNT_COPY.passwordHeading);
      expect(text).not.toContain(ACCOUNT_COPY.passkeysHeading);
      expect(text).not.toContain(ACCOUNT_COPY.googleHeading);
      expect(screen.container.querySelector('input[type="password"]')).toBeNull();
      expect(passkey.listUserPasskeys).not.toHaveBeenCalled();
    });

    it('with no sign-in method in effect, offers a registered user no control that sends mail', async () => {
      const screen = await render(AuthenticationPane, {
        user: registered,
        hasGoogle: false,
        methods: [],
        hasPassword: false,
        canRemovePassword: false
      });
      await expect.element(screen.getByText(emailConfirmed('ada@x.com'))).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: ACCOUNT_COPY.changeEmail }).elements()
      ).toHaveLength(0);
      expect(screen.container.querySelector('input[type="email"]')).toBeNull();
      expect(screen.getByRole('button', { name: ACCOUNT_COPY.sendLink }).elements()).toHaveLength(
        0
      );
    });

    it('with no sign-in method in effect, offers a pseudonymous user no add-email form', async () => {
      const screen = await render(AuthenticationPane, {
        user: pseudonymous,
        hasGoogle: false,
        methods: [],
        hasPassword: false,
        canRemovePassword: false
      });
      expect(screen.container.querySelector('input[type="email"]')).toBeNull();
      expect(screen.getByText(ACCOUNT_COPY.emailAddPrompt).elements()).toHaveLength(0);
      expect(screen.getByRole('button', { name: ACCOUNT_COPY.sendLink }).elements()).toHaveLength(
        0
      );
    });

    it('with password on, renders the password section', async () => {
      const screen = await render(AuthenticationPane, {
        user: registered,
        hasGoogle: false,
        methods: ['magic-link', 'password'],
        hasPassword: false,
        canRemovePassword: false
      });
      await expect
        .element(screen.getByRole('heading', { name: ACCOUNT_COPY.passwordHeading }))
        .toBeInTheDocument();
      expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passkeysHeading);
      expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.googleHeading);
    });

    it('with passkey on, renders the passkey section and lists the passkeys', async () => {
      const screen = await render(AuthenticationPane, {
        user: registered,
        hasGoogle: false,
        methods: ['magic-link', 'passkey'],
        hasPassword: false,
        canRemovePassword: false
      });
      await expect
        .element(screen.getByRole('heading', { name: ACCOUNT_COPY.passkeysHeading }))
        .toBeInTheDocument();
      await expect.element(screen.getByText(passkeyName)).toBeInTheDocument();
      expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordHeading);
    });

    it('with passkey on and none on the account, skips the list fetch', async () => {
      const screen = await render(AuthenticationPane, {
        user: registered,
        hasGoogle: false,
        methods: ['magic-link', 'passkey'],
        hasPassword: false,
        canRemovePassword: false,
        hasPasskey: false
      });
      await expect.element(screen.getByText(ACCOUNT_COPY.noPasskeys)).toBeInTheDocument();
      expect(passkey.listUserPasskeys).not.toHaveBeenCalled();
    });

    it('with google on, renders the Google section', async () => {
      const screen = await render(AuthenticationPane, {
        user: registered,
        hasGoogle: false,
        methods: ['magic-link', 'google'],
        hasPassword: false,
        canRemovePassword: false
      });
      await expect
        .element(screen.getByRole('button', { name: ACCOUNT_COPY.googleConnect }))
        .toBeInTheDocument();
      expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordHeading);
      expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passkeysHeading);
    });
  });
});
