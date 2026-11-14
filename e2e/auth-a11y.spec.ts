// E2e a11y gates for /signin: axe AA on every rendered state, the identifier field's
// label and error association, and live-region announce and focus on the confirmation.
// Later auth pages add their cases here.
import { expect, test, type Page } from '@playwright/test';
import { AUTH_COPY } from '../src/lib/account/copy';
import { MEMBERS_COPY } from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { enableAuthMethods, loginAs, readMail, uniqueEmail } from './helpers/auth';
import { openHeaderMenu } from './helpers/sharing';

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoSignin(page: Page, path = '/signin'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

test('signin: no axe violations in sign-in or sign-up mode', async ({ page }) => {
  await gotoSignin(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(AUTH_COPY.signIn);
  await expectNoA11yViolations(page);

  await gotoSignin(page, '/signin?signup=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(AUTH_COPY.signUp);
  await expectNoA11yViolations(page);
});

test('signin: no axe violations with password and passkey on, password mode open', async ({
  page,
  context
}) => {
  await enableAuthMethods(context, ['password', 'passkey']);
  await gotoSignin(page);
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: AUTH_COPY.usePassword }).click();
  await expect(page.getByLabel(AUTH_COPY.passwordLabel)).toBeVisible();
  await expectNoA11yViolations(page);
});

test('signin: identifier field is labelled and a provoked error is associated and focused', async ({
  page
}) => {
  await gotoSignin(page);
  const input = page.locator('#identifier');
  await expect(input).toHaveAccessibleName(AUTH_COPY.identifierLabel);
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');

  // A single space passes the `required` attribute; the server trims it to empty and
  // re-renders with `form.error` set.
  await input.fill(' ');
  await page.getByTestId('sendlink-submit').click();
  await expect(page.getByTestId('identifier-error')).toHaveText(AUTH_COPY.enterIdentifier);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAttribute('aria-describedby', 'identifier-error');
  await expect(input).toBeFocused();
  await expectNoA11yViolations(page);
});

test('signin: sent confirmation announces via the live region and takes focus', async ({
  page
}) => {
  await gotoSignin(page);
  await page.locator('#identifier').fill(uniqueEmail('signin-a11y'));
  const status = page.getByTestId('form-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await page.getByTestId('sendlink-submit').click();
  await expect(status).toHaveText(AUTH_COPY.emailSent);
  await expect(status).toBeFocused();
  await expectNoA11yViolations(page);
});

test('signin: submit button goes aria-busy and disabled while the action is pending', async ({
  page
}) => {
  await gotoSignin(page);
  // Hold the sendLink request until the test has seen the pending state, then release it.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/*sendLink*', async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('#identifier').fill(uniqueEmail('signin-busy'));
  const submit = page.getByTestId('sendlink-submit');
  const clickPromise = submit.click();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit).toBeDisabled();
  release();
  await clickPromise;
  // The sent state replaces the form, so the busy button is simply gone.
  await expect(page.getByTestId('form-status')).toHaveText(AUTH_COPY.emailSent);
  await expect(submit).toHaveCount(0);
});

test('forgot-password: no axe violations, empty, with an error, and after sending', async ({
  page,
  context
}) => {
  await enableAuthMethods(context, ['password']);
  await gotoSignin(page, '/forgot-password');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(AUTH_COPY.forgotHeading);
  await expect(page.locator('#identifier')).toHaveAccessibleName(AUTH_COPY.forgotIdentifierLabel);
  await expectNoA11yViolations(page);

  await page.locator('#identifier').fill(' ');
  await page.getByTestId('request-reset-submit').click();
  await expect(page.getByTestId('identifier-error')).toHaveText(AUTH_COPY.enterIdentifier);
  await expect(page.locator('#identifier')).toBeFocused();
  await expectNoA11yViolations(page);

  await page.locator('#identifier').fill(uniqueEmail('forgot-a11y'));
  await page.getByTestId('request-reset-submit').click();
  await expect(page.getByTestId('reset-sent')).toHaveText(AUTH_COPY.forgotSent);
  await expect(page.getByTestId('reset-sent')).toBeFocused();
  await expectNoA11yViolations(page);
});

test('reset-password: no axe violations with a token and with a rejected link', async ({
  page,
  context
}) => {
  await enableAuthMethods(context, ['password']);
  await gotoSignin(page, '/reset-password?token=abc');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(AUTH_COPY.resetHeading);
  await expect(page.getByLabel(AUTH_COPY.resetNewLabel, { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await gotoSignin(page, '/reset-password?error=INVALID_TOKEN');
  await expect(page.getByTestId('reset-invalid')).toHaveText(AUTH_COPY.resetInvalid);
  await expectNoA11yViolations(page);
});

test('route announcer: a client-side nav to /signin announces the new page title', async ({
  page
}) => {
  await page.goto('/about');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  // The header's Sign in link is the in-app anchor to /signin; clicking it is a client-side nav,
  // so SvelteKit's route announcer picks up the new title. Below lg it waits in the Menu.
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/signin(\?|$)/);
  await expect(page.locator('#svelte-announcer')).toHaveText(AUTH_COPY.pageTitle);
});

test('header: signed out shows Sign in, signed in shows the handle, both axe clean', async ({
  page
}) => {
  await gotoSignin(page, '/about');
  await openHeaderMenu(page);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })
  ).toHaveAttribute('href', '/signin');
  await expectNoA11yViolations(page);

  await loginAs(page, uniqueEmail('header-entry'));
  await gotoSignin(page, '/about');
  await openHeaderMenu(page);
  const entry = page.getByRole('banner').getByRole('link', { name: /^@/ });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('href', '/account');
  await expectNoA11yViolations(page);
});

test('invite page: no axe violations for a bad link, the join form and the accept button', async ({
  page,
  browser
}) => {
  await page.goto('/invite/not-a-real-token');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(MEMBERS_COPY.inviteInvalidTitle);
  await expectNoA11yViolations(page);

  // A manager invites a registered user by handle; the link arrives through the mail sink.
  const inviteeEmail = uniqueEmail('a11y-invitee');
  const inviteeCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect(
    (await inviteeCtx.request.post('/api/e2e/login', { data: { email: inviteeEmail } })).ok()
  ).toBeTruthy();
  await loginAs(page, uniqueEmail('a11y-inviter'));
  const created = await page.request.post('/api/sims', { data: { title: 'Invite A11y' } });
  const { simId } = (await created.json()) as { simId: string };
  const invited = await page.request.post(`/api/sims/${simId}/invites`, {
    data: { target: `@${inviteeEmail.split('@')[0]}` }
  });
  expect(invited.status()).toBe(201);
  const invitePath = new URL(await readMail(page.request, 'invite', inviteeEmail)).pathname;

  // Signed out: the join form with its email field.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(invitePath);
  await expect(visitorPage.locator('html')).toHaveAttribute('data-hydrated', '');
  await expect(visitorPage.getByLabel(MEMBERS_COPY.inviteEmailLabel)).toBeVisible();
  await expectNoA11yViolations(visitorPage);
  await visitor.close();

  // Signed in as the invitee: the accept button.
  const inviteePage = await inviteeCtx.newPage();
  await inviteePage.goto(invitePath);
  await expect(inviteePage.getByRole('button', { name: MEMBERS_COPY.inviteAccept })).toBeVisible();
  await expectNoA11yViolations(inviteePage);
  await inviteeCtx.close();
});
