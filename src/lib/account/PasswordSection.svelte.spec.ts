import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PasswordSection from './PasswordSection.svelte';
import { ACCOUNT_COPY, passwordSignInAs } from '$lib/account/account-copy';
import { AUTH_COPY } from '$lib/account/copy';

const handle = 'ada-blue';
const goodPassword = 'correct horse battery staple';
const oldPassword = 'a former passphrase here';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PasswordSection', () => {
  it('offers to set a password when none is set', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: false
    });
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }))
      .toBeInTheDocument();
  });

  it('shows the no-recovery warning for an account with no email', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: false
    });
    await expect.element(screen.getByText(ACCOUNT_COPY.passwordNoRecovery)).toBeInTheDocument();
  });

  it('omits the no-recovery warning when an email exists', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: true
    });
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordNoRecovery);
  });

  it('tells the user which handle they will sign in as', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: false
    });
    await expect.element(screen.getByText(passwordSignInAs(handle))).toBeInTheDocument();
  });

  it('disables Remove when the password is the last way back in, with the reason associated', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: false,
      handle,
      hasEmail: false
    });
    const btn = screen.getByRole('button', { name: ACCOUNT_COPY.remove }).element();
    expect(btn).toBeDisabled();
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(String(describedBy))?.textContent).toBe(
      ACCOUNT_COPY.passwordLastFactor
    );
  });

  it('enables Remove when another factor exists', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    const btn = screen.getByRole('button', { name: ACCOUNT_COPY.remove }).element();
    expect(btn).not.toBeDisabled();
  });

  it('setting the first password posts it, shows the recovery nudge, and reports a set (not a change)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: false
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
    await screen.getByLabelText(ACCOUNT_COPY.passwordLabel).fill(goodPassword);
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
    await expect
      .element(screen.getByText(ACCOUNT_COPY.passwordAddRecoveryNudge))
      .toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
    const done = screen.getByTestId('password-done');
    await expect.element(done).toHaveTextContent(ACCOUNT_COPY.passwordSetDone);
    expect(done.element().textContent).not.toContain(ACCOUNT_COPY.passwordChangedDone);
  });

  it('changing an existing password sends the current password and reports a change (not a set), skipping the nudge', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }).click();
    await screen.getByLabelText(ACCOUNT_COPY.passwordCurrentLabel).fill(oldPassword);
    // Exact: "Password" is a substring of "Current password".
    await screen.getByLabelText(ACCOUNT_COPY.passwordLabel, { exact: true }).fill(goodPassword);
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      password: goodPassword,
      currentPassword: oldPassword
    });
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }))
      .toBeInTheDocument();
    // The nudge is for a FIRST password only — a change means they already saw it.
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordAddRecoveryNudge);
    const done = screen.getByTestId('password-done');
    await expect.element(done).toHaveTextContent(ACCOUNT_COPY.passwordChangedDone);
    expect(done.element().textContent).not.toContain(ACCOUNT_COPY.passwordSetDone);
  });

  it('honours a hasPassword prop that arrives after mount', async () => {
    // The account payload loads asynchronously, so the pane can mount this
    // section before `hasPassword` is known. Capturing the seed value forever
    // strands a user who HAS a password on the set-branch form, which omits the
    // current-password field the endpoint then demands.
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: true
    });
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }))
      .toBeInTheDocument();
    await screen.rerender({ hasPassword: true, canRemove: true, handle, hasEmail: true });
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }))
      .toBeInTheDocument();
    const removeBtn = screen.getByRole('button', { name: ACCOUNT_COPY.remove }).element();
    expect(removeBtn).not.toBeDisabled();
  });

  it('withholds every claim until the account payload resolves', async () => {
    const screen = await render(PasswordSection, {
      // What the caller passes before the fetch lands: both facts default false,
      // which would wrongly claim "has an email" (no warning) and "no password".
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: true,
      loading: true
    });
    await expect.element(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordSet);
  });

  it('shows the warning once a load resolves the user as pseudonymous', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: true,
      loading: true
    });
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordNoRecovery);
    await screen.rerender({
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: false,
      loading: false
    });
    await expect.element(screen.getByText(ACCOUNT_COPY.passwordNoRecovery)).toBeInTheDocument();
  });

  it('blames the current-password field when the server says it is wrong', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: ACCOUNT_COPY.passwordCurrentWrong, field: 'currentPassword' }),
        { status: 400 }
      )
    );
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }).click();
    const current = screen.getByLabelText(ACCOUNT_COPY.passwordCurrentLabel);
    await current.fill(oldPassword);
    await screen.getByLabelText(ACCOUNT_COPY.passwordLabel, { exact: true }).fill(goodPassword);
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
    await expect.element(current).toHaveAttribute('aria-invalid', 'true');
    await expect.element(current).toHaveFocus();
    await expect
      .element(screen.getByLabelText(ACCOUNT_COPY.passwordLabel, { exact: true }))
      .not.toHaveAttribute('aria-invalid');
  });

  it('focuses the first field when the editor opens', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }).click();
    await expect.element(screen.getByLabelText(ACCOUNT_COPY.passwordCurrentLabel)).toHaveFocus();
  });

  it('a server blaming the absent current-password field mounts it and lands the blame there, never orphaning the error', async () => {
    // The host fetches /api/account once and never refetches, so a remount after
    // a write hands this section `hasPassword: false` for a user who HAS one.
    // The set-branch form omits the current-password field, the server answers
    // 400 blaming `currentPassword` — and blaming a field that is not on screen
    // strands the error: FieldError's focus target does not exist, and no input
    // wires `aria-describedby` to it. The component self-corrects (isSet becomes
    // true, see the comment above `setLocally = true` in `fail()`), mounting the
    // current-password field so the blame lands there, not on the always-rendered
    // new-password field.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: ACCOUNT_COPY.passwordCurrentWrong, field: 'currentPassword' }),
        { status: 400 }
      )
    );
    const screen = await render(PasswordSection, {
      hasPassword: false, // stale — the account payload predates the write
      canRemove: false,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
    const newField = screen.getByLabelText(ACCOUNT_COPY.passwordLabel, { exact: true });
    await newField.fill(goodPassword);
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();

    // Self-correction: the server demanding a current password proves one is
    // set, so the field appears and the form becomes satisfiable at all.
    const current = screen.getByLabelText(ACCOUNT_COPY.passwordCurrentLabel);
    await expect.element(current).toBeInTheDocument();
    await expect.element(current).toHaveAttribute('aria-invalid', 'true');

    // The always-rendered new-password field must not be wrongly blamed.
    await expect.element(newField).not.toHaveAttribute('aria-invalid');

    // The invariant: the error is associated with the on-screen field.
    const describedBy = current.element().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(String(describedBy))?.textContent).toBe(
      ACCOUNT_COPY.passwordCurrentWrong
    );
  });

  it('does not steal focus when the current-password field mounts mid-edit', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
    const newField = screen.getByLabelText(ACCOUNT_COPY.passwordLabel, { exact: true });
    await expect.element(newField).toHaveFocus();
    // The account payload lands and says a password exists: the current-password
    // input mounts above the caret. Focus must stay where the user is typing.
    await screen.rerender({ hasPassword: true, canRemove: true, handle, hasEmail: true });
    await expect.element(screen.getByLabelText(ACCOUNT_COPY.passwordCurrentLabel)).toBeVisible();
    await expect.element(newField).toHaveFocus();
  });

  it('keeps the password-set override when only canRemove changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.remove }).click();
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }))
      .toBeInTheDocument();
    // A fresh `canRemove` says nothing about whether a password exists, so it
    // must not discard what we just learned from the DELETE.
    await screen.rerender({ hasPassword: true, canRemove: false, handle, hasEmail: true });
    await expect
      .element(screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }))
      .toBeInTheDocument();
  });

  it('says the load failed rather than claiming to still be loading', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: true,
      loading: true,
      loadFailed: true
    });
    await expect.element(screen.getByText(ACCOUNT_COPY.loadFailed)).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.loading);
    // Still inert — no affordance is offered on facts we never got.
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordSet);
  });

  it('surfaces the breach error from the server', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: AUTH_COPY.passwordBreached }), { status: 400 })
    );
    const screen = await render(PasswordSection, {
      hasPassword: false,
      canRemove: false,
      handle,
      hasEmail: false
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
    await screen.getByLabelText(ACCOUNT_COPY.passwordLabel).fill(goodPassword);
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
    await expect.element(screen.getByText(AUTH_COPY.passwordBreached)).toBeInTheDocument();
  });

  it('shows a network error and leaves no unhandled rejection when save cannot reach the server', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    try {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
      const screen = await render(PasswordSection, {
        hasPassword: false,
        canRemove: false,
        handle,
        hasEmail: false
      });
      await screen.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
      await screen.getByLabelText(ACCOUNT_COPY.passwordLabel).fill(goodPassword);
      await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
      await expect.element(screen.getByText(ACCOUNT_COPY.passwordNetworkError)).toBeInTheDocument();
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });

  it('shows a network error and leaves no unhandled rejection when remove cannot reach the server', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    try {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
      const screen = await render(PasswordSection, {
        hasPassword: true,
        canRemove: true,
        handle,
        hasEmail: true
      });
      await screen.getByRole('button', { name: ACCOUNT_COPY.remove }).click();
      await expect.element(screen.getByText(ACCOUNT_COPY.passwordNetworkError)).toBeInTheDocument();
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });

  it('clears a stale error when Cancel is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: ACCOUNT_COPY.passwordCurrentWrong, field: 'currentPassword' }),
        { status: 400 }
      )
    );
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }).click();
    await screen.getByLabelText(ACCOUNT_COPY.passwordCurrentLabel).fill(oldPassword);
    await screen.getByLabelText(ACCOUNT_COPY.passwordLabel, { exact: true }).fill(goodPassword);
    await screen.getByRole('button', { name: ACCOUNT_COPY.save }).click();
    await expect.element(screen.getByText(ACCOUNT_COPY.passwordCurrentWrong)).toBeInTheDocument();
    await screen.getByRole('button', { name: ACCOUNT_COPY.cancel }).click();
    // The error described the field that was in the form that just unmounted —
    // it must not resurface, detached, next to Set/Change.
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordCurrentWrong);
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }).click();
    expect(screen.container.textContent).not.toContain(ACCOUNT_COPY.passwordCurrentWrong);
  });

  it('password inputs carry the autocomplete tokens password managers key on (SC 3.3.8)', async () => {
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.passwordChange }).click();
    const c = screen.container;
    expect(c.querySelector('#current-password')!.getAttribute('autocomplete')).toBe(
      'current-password'
    );
    expect(c.querySelector('#new-password')!.getAttribute('autocomplete')).toBe('new-password');
  });

  it('fires onChanged after a successful removal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const onChanged = vi.fn();
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true,
      onChanged
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.remove }).click();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('does not fire onChanged when removal is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: ACCOUNT_COPY.passwordLastFactor }), {
        status: 409
      })
    );
    const onChanged = vi.fn();
    const screen = await render(PasswordSection, {
      hasPassword: true,
      canRemove: true,
      handle,
      hasEmail: true,
      onChanged
    });
    await screen.getByRole('button', { name: ACCOUNT_COPY.remove }).click();
    await expect.element(screen.getByRole('button', { name: ACCOUNT_COPY.remove })).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
