// Email on /account: a registered user changes it through the two-hop confirmation, and a
// pseudonymous visitor makes the account theirs by adding one through a magic link.
import { expect, test } from '@playwright/test';
import {
  ACCOUNT_COPY,
  emailChangeSent,
  emailConfirmed,
  emailSentTo
} from '../src/lib/account/account-copy';
import { loginAs, readMail, uniqueEmail } from './helpers/auth';
import { gotoAccount, startPseudonymous } from './helpers/account';

test.use({ storageState: { cookies: [], origins: [] } });

test('a registered user changes their email via the dual-confirm flow', async ({
  page,
  request
}) => {
  const first = uniqueEmail('e2e-first');
  await loginAs(page, first);
  await gotoAccount(page);
  await expect(page.getByText(emailConfirmed(first))).toBeVisible();

  const next = uniqueEmail('e2e-next');
  await page.getByRole('button', { name: ACCOUNT_COPY.changeEmail }).click();
  await page.getByLabel(ACCOUNT_COPY.newEmailLabel).fill(next);
  await page.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
  await expect(page.getByTestId('email-status')).toHaveText(emailChangeSent(first, next));

  // Hop one: the APPROVE link sent to the CURRENT address.
  await page.goto(await readMail(request, 'change-email-approve', first));
  // Hop two: the CONFIRM link sent to the NEW address (sent after the first link is followed).
  await page.goto(await readMail(request, 'change-email-verify', next));

  await gotoAccount(page);
  await expect(page.getByText(emailConfirmed(next))).toBeVisible();
});

test('a pseudonymous visitor adds an email through a magic link and keeps the account', async ({
  page
}) => {
  await startPseudonymous(page);
  await gotoAccount(page);
  const handle = await page.locator('#handle').inputValue();
  await expect(page.getByText(ACCOUNT_COPY.emailAddPrompt)).toBeVisible();

  const email = uniqueEmail('e2e-claim');
  await page.getByLabel(ACCOUNT_COPY.emailLabel, { exact: true }).fill(email);
  await page.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
  await expect(page.getByTestId('email-status')).toHaveText(emailSentTo(email));
  // The link verifies the email and lands on '/' (the callback).
  await page.getByTestId('dev-link').click();
  await page.waitForURL((url) => url.pathname === '/');

  // The same account, now with a confirmed email.
  await gotoAccount(page);
  await expect(page.getByText(emailConfirmed(email))).toBeVisible();
  await expect(page.locator('#handle')).toHaveValue(handle);
});
