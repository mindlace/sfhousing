// WCAG 2.2 SC 3.3.7 Redundant Entry: a known-device visitor who types their email on the
// invite page and is steered to /signin must not have to retype it. /signin's #identifier is
// seeded from the pending-identifier cookie the invite `join` action stashes. A redirect,
// a cookie, a load function and a form field: only e2e can host the seam.
import { expect, test } from '@playwright/test';
import { MEMBERS_COPY } from '../src/lib/members/copy';
import { uniqueEmail } from './helpers/auth';
import { freshContext, inviteLinkFor, inviteViaApi, signInAndCreateSim } from './helpers/members';

test.use({ storageState: { cookies: [], origins: [] } });

test('invite on a known device redirects to /signin with the typed email carried over', async ({
  page,
  browser,
  baseURL
}, testInfo) => {
  const simId = await signInAndCreateSim(page, uniqueEmail('mgr'), `redundant-${Date.now()}`);
  // Nobody claims this address, so the typed copy resolves to a fresh mint, which a known
  // device turns into a sign-in.
  const invited = uniqueEmail('redundant');
  await inviteViaApi(page, simId, invited);
  const link = await inviteLinkFor(page, invited);

  const fresh = await freshContext(browser, testInfo);
  try {
    await fresh.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
    const guest = await fresh.newPage();
    await guest.goto(link);
    await expect(guest.locator('html')).toHaveAttribute('data-hydrated', '');
    await guest.locator('#invite-email').fill(invited);
    await guest.getByRole('button', { name: MEMBERS_COPY.inviteJoinSim }).click();
    await guest.waitForURL(/\/signin/);
    await expect(guest.locator('#identifier')).toHaveValue(invited);
  } finally {
    await fresh.close();
  }
});
