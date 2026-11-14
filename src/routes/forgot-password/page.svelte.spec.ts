import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { AUTH_COPY } from '$lib/account/copy';
import Page from './+page.svelte';

type Props = Parameters<typeof render<typeof Page>>[1];
const props = (form: Record<string, unknown> | null = null) =>
  ({ data: {}, form }) as unknown as Props;

test('renders the identifier field and the submit button', async () => {
  const screen = await render(Page, props());
  await expect.element(screen.getByLabelText(AUTH_COPY.forgotIdentifierLabel)).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.forgotSubmit }))
    .toBeInTheDocument();
});

test('shows the neutral confirmation once sent, and hides the form', async () => {
  const screen = await render(Page, props({ sent: true }));
  await expect.element(screen.getByText(AUTH_COPY.forgotSent)).toBeInTheDocument();
  await expect
    .element(screen.getByRole('button', { name: AUTH_COPY.forgotSubmit }))
    .not.toBeInTheDocument();
});

test('the identifier input carries the username autocomplete token (SC 3.3.8)', async () => {
  const screen = await render(Page, props());
  expect(screen.container.querySelector('#identifier')!.getAttribute('autocomplete')).toBe(
    'username'
  );
});

test('renders an action error against the identifier field', async () => {
  const screen = await render(Page, props({ error: AUTH_COPY.tooManySignin }));
  await expect
    .element(screen.getByTestId('identifier-error'))
    .toHaveTextContent(AUTH_COPY.tooManySignin);
});
