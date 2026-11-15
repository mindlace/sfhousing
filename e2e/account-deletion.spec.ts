// Account deletion from /account. A registered "deleter" owns two sims: a solo one (with a
// pending invitation) and a shared one with a second member. After deleting the account they
// are signed out, the shared sim carries on for the other member, and the solo sim is kept
// with no members: its pending invitation is gone and its link still opens read-only. Each
// run mints its own deleter, so the destructive delete never touches a user other specs
// rely on.
import { expect, test } from '@playwright/test';
import { MEMBERS_COPY } from '../src/lib/members/copy';
import { ACCOUNT_COPY, deleteConfirmLine } from '../src/lib/account/account-copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { uniqueEmail } from './helpers/auth';
import { gotoAccount, readHandle, startPseudonymous } from './helpers/account';
import {
  coldJoin,
  freshContext,
  inviteLinkFor,
  inviteViaApi,
  signInAndCreateSim
} from './helpers/members';
import { openHeaderMenu } from './helpers/sharing';
import { framesAtLeast, openSimSocket } from './helpers/sim-socket';

test.use({ storageState: { cookies: [], origins: [] } });

test('deleting the account signs out and keeps both sims', async ({ page, browser }, testInfo) => {
  const soloId = await signInAndCreateSim(page, uniqueEmail('deleter'), `solo-del-${Date.now()}`);
  const pending = uniqueEmail('pending');
  await inviteViaApi(page, soloId, pending);
  const pendingLink = await inviteLinkFor(page, pending);

  const sharedTitle = `shared-del-${Date.now()}`;
  const sharedRes = await page.request.post('/api/sims', { data: { title: sharedTitle } });
  const { simId: sharedId } = (await sharedRes.json()) as { simId: string };
  const survivorEmail = uniqueEmail('survivor');
  await inviteViaApi(page, sharedId, survivorEmail);
  const survivorLink = await inviteLinkFor(page, survivorEmail);

  const survivorCtx = await freshContext(browser, testInfo);
  try {
    const survivor = await survivorCtx.newPage();
    await coldJoin(survivor, survivorLink, survivorEmail);

    // The deleter confirms with their handle.
    await gotoAccount(page);
    const handle = await readHandle(page);
    await page.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
    await expect(page.getByText(deleteConfirmLine(handle))).toBeVisible();
    await expectNoA11yViolations(page);
    const confirm = page.getByLabel(ACCOUNT_COPY.deleteConfirmLabel);
    await confirm.fill(handle);
    await expect(confirm).toHaveValue(handle);
    await page.getByRole('button', { name: ACCOUNT_COPY.deletePermanently }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // Signed out: the header offers Sign in, not the handle.
    await openHeaderMenu(page);
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })
    ).toBeVisible();
    expect((await page.request.get('/api/account')).status()).toBe(401);

    // The shared sim survives for the other member.
    await survivor.goto(`/sims/${sharedId}`);
    await expect(survivor.getByRole('heading', { level: 1 })).toHaveText(sharedTitle);

    // The solo sim is kept with no members: its pending invitation no longer resolves, and
    // its link still opens, read-only.
    const guest = await (await freshContext(browser, testInfo)).newPage();
    await guest.goto(pendingLink);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(
      MEMBERS_COPY.inviteInvalidTitle
    );
    const s = await openSimSocket(guest, soloId);
    expect((await framesAtLeast(guest, s, 2))[1]).toEqual({ type: 'access', write: false });
    await guest.context().close();
  } finally {
    await survivorCtx.close();
  }
});

test('a wrong handle keeps the delete button off; cancel returns focus to the trigger', async ({
  page
}) => {
  await signInAndCreateSim(page, uniqueEmail('delete-guard'), `guard-${Date.now()}`);
  await gotoAccount(page);
  const trigger = page.getByRole('button', { name: ACCOUNT_COPY.deleteButton });
  await trigger.click();
  await expect(page.locator('#confirmHandle')).toBeFocused();
  const confirmButton = page.getByRole('button', { name: ACCOUNT_COPY.deletePermanently });
  await expect(confirmButton).toBeDisabled();
  await page.locator('#confirmHandle').fill('not-my-handle');
  await expect(confirmButton).toBeDisabled();

  await page.getByRole('button', { name: ACCOUNT_COPY.cancel }).click();
  await expect(trigger).toBeFocused();
  // Nothing was deleted.
  expect((await page.request.get('/api/account')).status()).toBe(200);
});

test('a pseudonymous visitor deletes their account and ends signed out', async ({ page }) => {
  const title = `pseudo-del-${Date.now()}`;
  await startPseudonymous(page, title);
  const simPath = new URL(page.url()).pathname;
  expect((await page.request.get('/api/account')).status()).toBe(200);

  await gotoAccount(page);
  const handle = await readHandle(page);
  await page.getByRole('button', { name: ACCOUNT_COPY.deleteButton }).click();
  const confirm = page.getByLabel(ACCOUNT_COPY.deleteConfirmLabel);
  await confirm.fill(handle);
  await expect(confirm).toHaveValue(handle);
  await page.getByRole('button', { name: ACCOUNT_COPY.deletePermanently }).click();
  await page.waitForURL((url) => url.pathname === '/');

  // Signed out: no session, and the account API refuses.
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await openHeaderMenu(page);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })
  ).toBeVisible();
  const gone = await page.request.get(simPath, { maxRedirects: 0 });
  // Signed out, the sim page answers 401 before it would say whether the sim exists.
  expect(gone.status()).toBe(401);
});
