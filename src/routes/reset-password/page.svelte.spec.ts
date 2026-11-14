import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { AUTH_COPY } from '$lib/account/copy';
import Page from './+page.svelte';

type Props = Parameters<typeof render<typeof Page>>[1];
const props = (
  data: { token: string; invalid: boolean },
  form: Record<string, unknown> | null = null
) => ({ data, form }) as unknown as Props;

test('renders the new-password form when a token is present', async () => {
  const screen = await render(Page, props({ token: 'abc', invalid: false }));
  // exact:true: "New password" is otherwise a case-insensitive substring of
  // "Confirm new password", so the default (substring) match resolves to both labels.
  await expect
    .element(screen.getByLabelText(AUTH_COPY.resetNewLabel, { exact: true }))
    .toBeInTheDocument();
  await expect.element(screen.getByLabelText(AUTH_COPY.resetConfirmLabel)).toBeInTheDocument();
});

test('carries the token in a hidden field so the action receives it', async () => {
  const screen = await render(Page, props({ token: 'abc', invalid: false }));
  await expect.element(screen.getByTestId('reset-token')).toHaveValue('abc');
});

test('shows the invalid state and no form when the link was rejected', async () => {
  const screen = await render(Page, props({ token: '', invalid: true }));
  await expect.element(screen.getByText(AUTH_COPY.resetInvalid)).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.resetSubmit }))
    .not.toBeInTheDocument();
});

test('renders an action error against the new-password field', async () => {
  const screen = await render(
    Page,
    props({ token: 'abc', invalid: false }, { error: AUTH_COPY.resetMismatch })
  );
  await expect
    .element(screen.getByTestId('new-password-error'))
    .toHaveTextContent(AUTH_COPY.resetMismatch);
});

test('password inputs carry new-password autocomplete tokens (SC 3.3.8)', async () => {
  const screen = await render(Page, props({ token: 'abc', invalid: false }));
  const c = screen.container;
  expect(c.querySelector('#new-password')!.getAttribute('autocomplete')).toBe('new-password');
  expect(c.querySelector('#confirm-password')!.getAttribute('autocomplete')).toBe('new-password');
});

test('a submit-time invalid-token error still leaves an escape route to request a new link', async () => {
  // `usable` is derived from load data only, so a token valid on load that expires
  // before submit still renders the form (usable stays true) alongside the
  // invalid-token error the action returned. The user must not be trapped here.
  const screen = await render(
    Page,
    props({ token: 'abc', invalid: false }, { error: AUTH_COPY.resetInvalid })
  );
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.resetSubmit }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole('link', { name: AUTH_COPY.resetRequestAnother }))
    .toBeInTheDocument();
});
