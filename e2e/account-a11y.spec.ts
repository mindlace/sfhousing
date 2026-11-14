// E2e a11y gates for /account: axe AA on every rendered state (pseudonymous and registered
// accounts, each method switched on, each form opened or in error), the profile form's label
// and error association, live-region announce on save, and the delete confirmation's focus.
import { expect, test } from '@playwright/test';
import { ACCOUNT_COPY } from '../src/lib/account/account-copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { enableAuthMethods, loginAs, uniqueEmail } from './helpers/auth';
import { gotoAccount, startPseudonymous, submitPasswordForm } from './helpers/account';

test.use({ storageState: { cookies: [], origins: [] } });

test('account: a registered account has no axe violations, closed and with each form open', async ({
  page
}) => {
  await loginAs(page, uniqueEmail('a11y-registered'));
  await gotoAccount(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACCOUNT_COPY.heading);
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: ACCOUNT_COPY.changeEmail }).click();
  await expect(page.getByLabel(ACCOUNT_COPY.newEmailLabel)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
  await expect(page.locator('#confirmHandle')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('account: a pseudonymous account has no axe violations, with the email form and after sending', async ({
  page
}) => {
  await startPseudonymous(page, 'A11y pseudonymous');
  await gotoAccount(page);
  await expect(page.getByText(ACCOUNT_COPY.emailAddPrompt)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel(ACCOUNT_COPY.emailLabel, { exact: true }).fill(uniqueEmail('a11y-claim'));
  await page.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
  const status = page.getByTestId('email-status');
  await expect(status).toBeFocused();
  await expectNoA11yViolations(page);
});

test('account: no axe violations with password and passkey on', async ({ page, context }) => {
  await enableAuthMethods(context, ['password', 'passkey']);
  await loginAs(page, uniqueEmail('a11y-methods'));
  await gotoAccount(page);
  await expect(page.getByRole('heading', { name: ACCOUNT_COPY.passwordHeading })).toBeVisible();
  await expect(page.getByRole('heading', { name: ACCOUNT_COPY.passkeysHeading })).toBeVisible();
  await expect(page.getByRole('button', { name: ACCOUNT_COPY.passwordSet })).toBeVisible();
  await expect(page.getByText(ACCOUNT_COPY.noPasskeys)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: ACCOUNT_COPY.passwordSet }).click();
  await expect(page.locator('#new-password')).toBeFocused();
  await expectNoA11yViolations(page);

  // A too-short password is refused by the server: the error is associated and focused.
  await page.locator('#new-password').fill('short');
  await submitPasswordForm(page);
  await expect(page.getByTestId('new-password-error')).toBeVisible();
  await expect(page.locator('#new-password')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#new-password')).toHaveAttribute(
    'aria-describedby',
    'new-password-error'
  );
  await expect(page.locator('#new-password')).toBeFocused();
  await expectNoA11yViolations(page);
});

test('account: the profile form is labelled, an invalid handle is associated and focused, a save announces', async ({
  page
}) => {
  await loginAs(page, uniqueEmail('a11y-profile'));
  await gotoAccount(page);
  const handle = page.locator('#handle');
  await expect(handle).toHaveAccessibleName(ACCOUNT_COPY.handleLabel);
  await expect(page.locator('#name')).toHaveAccessibleName(ACCOUNT_COPY.displayNameLabel);
  await expect(handle).not.toHaveAttribute('aria-invalid', 'true');

  await handle.fill('!');
  await page.getByRole('button', { name: ACCOUNT_COPY.save, exact: true }).click();
  await expect(page.getByTestId('handle-error')).toBeVisible();
  await expect(handle).toHaveAttribute('aria-invalid', 'true');
  await expect(handle).toHaveAttribute('aria-describedby', 'handle-error');
  await expect(handle).toBeFocused();
  await expectNoA11yViolations(page);

  const status = page.getByTestId('form-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await handle.fill(`qa-a11y-${Date.now().toString(36)}`);
  await page.getByRole('button', { name: ACCOUNT_COPY.save, exact: true }).click();
  await expect(status).toHaveText(ACCOUNT_COPY.saved);
});

test('account: reveal focuses the confirm field and cancel returns focus to the trigger', async ({
  page
}) => {
  await loginAs(page, uniqueEmail('a11y-delete'));
  await gotoAccount(page);
  const trigger = page.getByRole('button', { name: ACCOUNT_COPY.deleteButton });
  await trigger.click();
  await expect(page.locator('#confirmHandle')).toBeFocused();
  await page.getByRole('button', { name: ACCOUNT_COPY.cancel }).click();
  await expect(trigger).toBeFocused();
});

test('account: a signed-out visit goes to /signin with returnTo=/account', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/signin\?returnTo=(%2F|\/)account$/);
});

// The skip-link case of the original account a11y suite, run against /account.
test('account: the focused skip link does not overlap the header controls', async ({ page }) => {
  await loginAs(page, uniqueEmail('a11y-skip'));
  await gotoAccount(page);
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await expect(skipLink).toBeFocused();
  const overlaps = await page.evaluate(() => {
    const skip = document.activeElement!.getBoundingClientRect();
    return [...document.querySelectorAll('header button, header [data-header-account]')].filter(
      (el) => {
        const b = el.getBoundingClientRect();
        return (
          b.width > 0 &&
          skip.left < b.right &&
          skip.right > b.left &&
          skip.top < b.bottom &&
          skip.bottom > b.top
        );
      }
    ).length;
  });
  // The site-name link at the left edge sits under the skip link when it is focused (existing root layout
  // behaviour); the controls that must stay clear are the Menu and the account entry.
  expect(overlaps, 'the focused skip link overlaps a header control').toBe(0);
});
