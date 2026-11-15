// Leaving a sim: the only member leaving keeps it with no members (its link still opens
// read-only) and ends its pending invitations, the last manager hands off, and a plain member
// just leaves.
import { expect, test } from '@playwright/test';
import { MEMBERS_COPY } from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { uniqueEmail } from './helpers/auth';
import {
  coldJoin,
  freshContext,
  inviteLinkFor,
  inviteViaApi,
  openMembers,
  signInAndCreateSim
} from './helpers/members';
import { framesAtLeast, openSimSocket } from './helpers/sim-socket';

test.use({ storageState: { cookies: [], origins: [] } });

test('the only member leaves: the sim is kept and its pending invitation ends', async ({
  page,
  browser
}, testInfo) => {
  const simId = await signInAndCreateSim(page, uniqueEmail('solo'), `solo-${Date.now()}`);
  const invited = uniqueEmail('pending');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);

  await openMembers(page, simId);
  await page.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
  await expect(page.getByText(MEMBERS_COPY.leaveSoleMemberWarning)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: MEMBERS_COPY.leaveLastButton }).click();
  await page.waitForURL((url) => url.pathname === '/sims');

  // The member area answers the former member as any non-member.
  const closed = await page.goto(`/sims/${simId}`);
  expect(closed?.status()).toBe(404);

  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    await guest.goto(link);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(
      MEMBERS_COPY.inviteInvalidTitle
    );
    // The sim is kept: its link still opens, read-only.
    const s = await openSimSocket(guest, simId);
    expect((await framesAtLeast(guest, s, 2))[1]).toEqual({ type: 'access', write: false });
  } finally {
    await fresh.close();
  }
});

test('the last manager hands off to a member and leaves', async ({ page, browser }, testInfo) => {
  const simTitle = `handoff-${Date.now()}`;
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), simTitle);
  const invited = uniqueEmail('successor');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);

  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    await coldJoin(guest, link, invited);

    await openMembers(page, simId);
    await expect(page.getByText('· editor')).toBeVisible();
    await expect(page.getByLabel(MEMBERS_COPY.leaveSuccessorLabel)).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: MEMBERS_COPY.leaveHandoffButton }).click();
    await page.waitForURL((url) => url.pathname === '/sims');

    // The manager lost access; the successor now manages the sim.
    const lost = await page.goto(`/sims/${simId}`);
    expect(lost?.status()).toBe(404);
    await openMembers(guest, simId);
    await expect(guest.getByText('· manager')).toBeVisible();
    await expect(guest.getByTestId('invite-input')).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test('a plain member leaves and the sim stays for the manager', async ({
  page,
  browser
}, testInfo) => {
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), `plain-${Date.now()}`);
  const invited = uniqueEmail('member');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);

  const fresh = await freshContext(browser, testInfo);
  try {
    const guest = await fresh.newPage();
    await coldJoin(guest, link, invited);
    await openMembers(guest, simId);
    await guest.getByRole('button', { name: MEMBERS_COPY.leaveButton }).click();
    await expect(guest.getByText(MEMBERS_COPY.leaveSimplePrompt)).toBeVisible();
    await expectNoA11yViolations(guest);
    await guest.getByRole('button', { name: MEMBERS_COPY.leaveSimpleButton }).click();
    await guest.waitForURL((url) => url.pathname === '/sims');
    const lost = await guest.goto(`/sims/${simId}`);
    expect(lost?.status()).toBe(404);
  } finally {
    await fresh.close();
  }

  const still = await page.goto(`/sims/${simId}`);
  expect(still?.status()).toBe(200);
});
