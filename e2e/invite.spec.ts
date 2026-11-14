// Invitations end to end: a manager invites from the sim page, the invitee joins cold or
// from their own account, and the roster follows. Axe passes on each new page state.
import { expect, test } from '@playwright/test';
import {
  MEMBERS_COPY,
  inviteHeading,
  invitationsAcceptNamed,
  membersResendNamed,
  membersRevokeNamed
} from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { loginAs, uniqueEmail } from './helpers/auth';
import {
  coldJoin,
  freshContext,
  inviteLinkFor,
  inviteViaApi,
  openMembers,
  signInAndCreateSim
} from './helpers/members';

test.use({ storageState: { cookies: [], origins: [] } });

test('invite by email: the invitee joins cold and the manager sees them as an editor', async ({
  page,
  browser
}, testInfo) => {
  const simTitle = `invite-e2e-${Date.now()}`;
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), simTitle);
  const invited = uniqueEmail('guest');

  // The manager types the address into the Members panel.
  await openMembers(page, simId);
  await page.getByTestId('invite-input').fill(invited);
  await page.getByTestId('invite-submit').click();
  await expect(page.getByText(invited)).toBeVisible();
  await expectNoA11yViolations(page);

  // A signed-out browser follows the mailed link: heading, axe, then join.
  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    const link = await inviteLinkFor(page, invited);
    await guest.goto(link);
    await expect(guest.getByRole('heading', { level: 1 })).toContainText(simTitle);
    await expect(guest.getByRole('heading', { level: 1 })).toContainText('invited you');
    await expectNoA11yViolations(guest);
    await coldJoin(guest, link, invited);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(simTitle);

    // The editor sees the roster but neither roles, invite field nor remove buttons.
    await guest.getByTestId('members').locator('summary').click();
    await expect(guest.getByTestId('invite-input')).toHaveCount(0);
    await expect(guest.getByText('· editor')).toHaveCount(0);
  } finally {
    await fresh.close();
  }

  // The manager now sees the editor and no pending row.
  await openMembers(page, simId);
  await expect(page.getByText('· editor')).toBeVisible();
  await expect(page.getByText(invited)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { level: 3, name: MEMBERS_COPY.membersPending })
  ).toHaveCount(0);
});

test('revoke removes the pending row and kills the link', async ({ page, browser }, testInfo) => {
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), `revoke-${Date.now()}`);
  const invited = uniqueEmail('guest');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);

  await openMembers(page, simId);
  await expect(page.getByText(invited)).toBeVisible();
  await page.getByRole('button', { name: membersRevokeNamed(invited) }).click();
  await expect(page.getByText(invited)).toHaveCount(0);

  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    await guest.goto(link);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(
      MEMBERS_COPY.inviteInvalidTitle
    );
  } finally {
    await fresh.close();
  }
});

test('resend inside the cooldown is refused with a visible message', async ({ page }) => {
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), `resend-${Date.now()}`);
  const invited = uniqueEmail('guest');
  await inviteViaApi(page, simId, invited);

  await openMembers(page, simId);
  // The invite itself started the 60 s cooldown (RESEND_COOLDOWN_MS).
  await page.getByRole('button', { name: membersResendNamed(invited) }).click();
  await expect(page.getByRole('alert')).toHaveText('resend too soon');
  await expectNoA11yViolations(page);
});

test('the manager removes an editor, who then loses the sim', async ({
  page,
  browser
}, testInfo) => {
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), `remove-${Date.now()}`);
  const invited = uniqueEmail('guest');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);

  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    await coldJoin(guest, link, invited);

    await openMembers(page, simId);
    const remove = page.getByRole('button', { name: /^Remove .+ from the sim$/ });
    await expect(remove).toHaveCount(1);
    await remove.click();
    await expect(page.getByText('· editor')).toHaveCount(0);

    const gone = await guest.goto(`/sims/${simId}`);
    expect(gone?.status()).toBe(404);
  } finally {
    await fresh.close();
  }
});

test('an invitation to an existing account shows on /sims and Accept joins the sim', async ({
  page,
  browser
}, testInfo) => {
  const simTitle = `list-${Date.now()}`;
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), simTitle);
  const recipient = uniqueEmail('rcpt');
  await inviteViaApi(page, simId, recipient);

  const fresh = await freshContext(browser, testInfo);
  try {
    const rp = await fresh.newPage();
    await loginAs(rp, recipient);
    await rp.goto('/sims');
    await expect(rp.locator('html')).toHaveAttribute('data-hydrated', '');
    await expect(rp.getByRole('button', { name: invitationsAcceptNamed(simTitle) })).toBeVisible();
    // The banner stays out of the way on the list itself.
    await expect(rp.getByTestId('invite-banner')).toBeEmpty();
    await expectNoA11yViolations(rp);
    await rp.getByRole('button', { name: invitationsAcceptNamed(simTitle) }).click();
    await rp.waitForURL(`**/sims/${simId}`);
    await expect(rp.getByRole('heading', { level: 1 })).toHaveText(simTitle);
  } finally {
    await fresh.close();
  }
});

test('the banner on a sim page offers Accept, and Not now hides it', async ({
  page,
  browser
}, testInfo) => {
  const simTitle = `banner-${Date.now()}`;
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), simTitle);
  const recipient = uniqueEmail('rcpt');
  await inviteViaApi(page, simId, recipient);

  const fresh = await freshContext(browser, testInfo);
  try {
    const rp = await fresh.newPage();
    const ownId = await signInAndCreateSim(rp, recipient, `own-${Date.now()}`);
    await rp.goto(`/sims/${ownId}`);
    await expect(rp.locator('html')).toHaveAttribute('data-hydrated', '');
    const banner = rp.getByTestId('invite-banner');
    await expect(banner).toContainText(simTitle);
    await expect(banner).toContainText('invited you');
    await expectNoA11yViolations(rp);

    await rp.getByRole('button', { name: MEMBERS_COPY.inviteNotNow }).click();
    await expect(banner).toBeEmpty();

    await rp.reload();
    await expect(rp.locator('html')).toHaveAttribute('data-hydrated', '');
    await rp.getByRole('button', { name: MEMBERS_COPY.invitationsAccept }).click();
    await rp.waitForURL(`**/sims/${simId}`);
    await expect(rp.getByRole('heading', { level: 1 })).toHaveText(simTitle);
  } finally {
    await fresh.close();
  }
});

test('the invite heading names the inviter and the sim', async ({ page, browser }, testInfo) => {
  const simTitle = `heading-${Date.now()}`;
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), simTitle);
  const invited = uniqueEmail('guest');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);
  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    await guest.goto(link);
    const text = (await guest.getByRole('heading', { level: 1 }).textContent()) ?? '';
    expect(text).toBe(inviteHeading(text.match(/^@(\S+)/)![1], simTitle));
  } finally {
    await fresh.close();
  }
});
