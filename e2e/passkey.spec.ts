// Passkeys, with a CDP virtual authenticator (Chromium only): register one from /account,
// then sign in with it in a fresh session.
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { AUTH_COPY } from '../src/lib/account/copy';
import { enableAuthMethods, loginAs, uniqueEmail } from './helpers/auth';
import { gotoAccount } from './helpers/account';

test.use({ storageState: { cookies: [], origins: [] } });

test('register a passkey, then sign in with it in a fresh session', async ({
  page,
  context,
  browserName
}, testInfo) => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'chromium',
    'needs the Chromium virtual authenticator (CDP)'
  );
  await enableAuthMethods(context, ['passkey']);

  // A virtual authenticator stands in for a platform passkey: resident (discoverable)
  // credentials with auto user-verification, so add and sign-in both auto-approve without an
  // OS prompt. It must exist before any WebAuthn call and survives clearCookies (same device).
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });

  // A registered session (the passkey belongs to a verified account).
  await loginAs(page, uniqueEmail('e2e-pk'));
  await gotoAccount(page);
  await expect(page.getByText(ACCOUNT_COPY.noPasskeys)).toBeVisible();
  await page.getByRole('button', { name: ACCOUNT_COPY.passkeyAdd }).click();
  await expect(page.getByTestId('passkey-status')).toHaveText(ACCOUNT_COPY.passkeyAdded);
  await expect(page.getByRole('button', { name: /^Remove passkey/ })).toBeVisible();

  // The credential is genuinely stored in the authenticator.
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials.length).toBeGreaterThan(0);

  // Fresh session: drop cookies (signed out) but keep the same device and authenticator.
  await context.clearCookies();
  await enableAuthMethods(context, ['passkey']);
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByRole('button', { name: AUTH_COPY.passkeyButton }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));

  // Signed in again.
  expect((await page.request.get('/api/account')).status()).toBe(200);
});
