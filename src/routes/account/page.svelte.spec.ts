import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { gotoCalls } from '../../test-stubs/app/navigation';
import Page from './+page.svelte';

vi.mock('$lib/account/auth-client', () => ({
  authClient: {
    passkey: { listUserPasskeys: vi.fn(async () => ({ data: [] })) },
    linkSocial: vi.fn()
  }
}));

type Props = Parameters<typeof render<typeof Page>>[1];

const registered = {
  id: 'u1',
  handle: 'ada',
  name: 'Ada',
  email: 'ada@x.com',
  pseudonymous: false
};

function props(over: Record<string, unknown> = {}) {
  return {
    data: {
      user: registered,
      methods: ['magic-link'],
      hasPasskey: false,
      hasOAuthAccount: false,
      ...over
    }
  } as unknown as Props;
}

beforeEach(() => {
  vi.restoreAllMocks();
  gotoCalls.length = 0;
});

describe('/account page', () => {
  it('renders the profile, sign-in and delete sections with h2 headings', async () => {
    const screen = await render(Page, props());
    for (const name of [
      ACCOUNT_COPY.profileHeading,
      ACCOUNT_COPY.authHeading,
      ACCOUNT_COPY.deleteHeading
    ]) {
      const heading = screen.getByRole('heading', { name, level: 2 });
      await expect.element(heading).toBeInTheDocument();
      expect(heading.element().closest('section')).not.toBeNull();
    }
  });

  it('under the default methods shows no password, passkey or Google control', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const screen = await render(Page, props());
    await expect
      .element(screen.getByRole('heading', { name: ACCOUNT_COPY.emailHeading }))
      .toBeInTheDocument();
    const text = screen.container.textContent ?? '';
    expect(text).not.toContain(ACCOUNT_COPY.passwordHeading);
    expect(text).not.toContain(ACCOUNT_COPY.passkeysHeading);
    expect(text).not.toContain(ACCOUNT_COPY.googleHeading);
    expect(screen.container.querySelector('input[type="password"]')).toBeNull();
    // Nothing about passwords is asked of the server either.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with password on, fetches the account facts and renders the password section', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          hasGoogle: false,
          hasPassword: true,
          canRemovePassword: true,
          pseudonymous: false
        }),
        { status: 200 }
      )
    );
    const screen = await render(Page, props({ methods: ['magic-link', 'password'] }));
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }))
      .toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith('/api/account');
  });

  it('says the password facts failed to load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    const screen = await render(Page, props({ methods: ['magic-link', 'password'] }));
    await expect.element(screen.getByText(ACCOUNT_COPY.loadFailed)).toBeInTheDocument();
  });

  it('with passkey and Google on, renders their sections', async () => {
    const screen = await render(
      Page,
      props({ methods: ['magic-link', 'passkey', 'google'], hasOAuthAccount: true })
    );
    await expect
      .element(screen.getByRole('heading', { name: ACCOUNT_COPY.passkeysHeading }))
      .toBeInTheDocument();
    await expect.element(screen.getByText(ACCOUNT_COPY.googleConnected)).toBeInTheDocument();
  });

  it('navigates home once the account is deleted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const screen = await render(Page, props());
    await screen.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
    await screen.getByLabelText(ACCOUNT_COPY.deleteConfirmLabel).fill('ada');
    await screen.getByRole('button', { name: ACCOUNT_COPY.deletePermanently }).click();
    await vi.waitFor(() => expect(gotoCalls.map((c) => c.url)).toContain('/'));
  });
});
