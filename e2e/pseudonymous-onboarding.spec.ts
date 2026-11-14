// Sign-in side of pseudonymous onboarding: a known device steered to /signin keeps a working
// escape hatch (and the response that starts fresh stages two cookies at once), and a
// pseudonymous visitor adds an unclaimed email through the magic link and keeps their sim.
// The create-a-sim side is in sims-onboarding.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { AUTH_COPY, pendingSimLine } from '../src/lib/account/copy';
import { MEMBERS_COPY, SIMS_COPY, inviteHeading } from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { loginAs, readMail, uniqueEmail } from './helpers/auth';

const SESSION_COOKIE = 'better-auth.session_token';
const PENDING_SIM_COOKIE = 'sfh_pending_sim';

test.use({ storageState: { cookies: [], origins: [] } });

async function createSim(page: Page, title: string) {
  await page.goto('/sims');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByLabel(SIMS_COPY.titleLabel).fill(title);
  await page.getByRole('button', { name: SIMS_COPY.create }).click();
}

test('known device is steered to /signin with a working escape hatch', async ({
  page,
  context,
  baseURL
}) => {
  // A durable credential was used here before (sfh_known), so creating a sim steers a
  // signed-out visitor to /signin instead of silently minting a second account.
  const title = 'Comeback Tour';
  await context.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
  await createSim(page, title);
  await page.waitForURL((url) => url.pathname === '/signin');
  await expect(page.getByText(pendingSimLine(title))).toBeVisible();

  // The one /signin state a pseudonymous visitor uniquely sees: the banner above the form.
  await expectNoA11yViolations(page);

  // The escape hatch mints fresh instead of steering into an existing account.
  await page.getByTestId('start-fresh').click();
  await page.waitForURL(/\/sims\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
});

test('start fresh answers one redirect that sets the session and clears the pending sim', async ({
  page,
  context,
  baseURL
}) => {
  await context.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
  await createSim(page, 'Two Cookies');
  await page.waitForURL((url) => url.pathname === '/signin');

  // The pending-sim cookie was stashed on the way here; no session yet.
  const before = (await context.cookies()).map((c) => c.name);
  expect(before).toContain(PENDING_SIM_COOKIE);
  expect(before).not.toContain(SESSION_COOKIE);

  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  // Listen before the click, so the response cannot arrive first.
  const startFresh = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('startFresh')
  );
  await page.getByTestId('start-fresh').click();
  const res = await startFresh;
  await page.waitForURL(/\/sims\/[^/]+$/);

  // The browser context after that response: the session is there, the stash is gone.
  const after = (await context.cookies()).map((c) => c.name);
  expect(after).toContain(SESSION_COOKIE);
  expect(after).not.toContain(PENDING_SIM_COOKIE);

  // Both effects came on ONE response: the 303 to the new sim (kept whole through
  // headersHandle's re-wrap of a redirect).
  expect(res.status()).toBe(303);
  const setCookie = (await res.headersArray())
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
  const names = setCookie.map((c) => c.split('=', 1)[0]);
  expect(names).toContain(SESSION_COOKIE);
  expect(names).toContain(PENDING_SIM_COOKIE);
  const cleared = setCookie.find((c) => c.startsWith(`${PENDING_SIM_COOKIE}=`))!;
  expect(cleared).toMatch(/Max-Age=0/i);
});

test('a pseudonymous user adds an unclaimed email through the link and keeps their sim', async ({
  page,
  baseURL
}) => {
  const title = 'Attic Studio';
  await createSim(page, title);
  await page.waitForURL(/\/sims\/[^/]+$/);
  const simPath = new URL(page.url()).pathname;

  // A signed-in visitor is redirected off the /signin page, but the sendLink action takes the
  // pseudonymous session with it: the same request the form posts, carrying the cookie.
  const email = uniqueEmail('pseudo');
  const res = await page.request.post('/signin?/sendLink', {
    headers: { origin: baseURL!, 'x-sveltekit-action': 'true' },
    form: { identifier: email }
  });
  const body = (await res.json()) as { type: string; data: string };
  expect(body.type).toBe('success');
  const link = /https?:[^"\\]*magic-link\/verify[^"\\]*/.exec(body.data)?.[0];
  expect(link, 'dev link in the action data').toBeTruthy();

  await page.goto(link!);
  const session = (await (await page.request.get('/api/auth/get-session')).json()) as {
    user?: { email?: string; isAnonymous?: boolean };
  } | null;
  expect(session?.user?.email).toBe(email);
  expect(session?.user?.isAnonymous).toBeFalsy();

  // The sim survived the upgrade: same sim, not a fresh or empty account.
  await page.goto(simPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await page.goto('/sims');
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
});

test('the escape hatch without a stashed sim lands on /sims', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByRole('button', { name: AUTH_COPY.startFresh }).click();
  await page.waitForURL((url) => url.pathname === '/sims');
});

// A handle invite carries no invitedEmail: whoever holds the link joins on submit, with no
// magic-link round trip, and gets a fresh pseudonymous account (claim.ts's
// `{ kind: 'mint', pseudonymous: true }`). A manager creates the sim and the invite, a second
// registered user supplies the @handle, and the invite link comes from the e2e mail sink.
test('a visitor with no account joins from an invite link and gets a pseudonymous account', async ({
  page,
  browser
}) => {
  const targetEmail = uniqueEmail('invitee');
  const targetHandle = targetEmail.split('@')[0];
  const targetCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const targetLogin = await targetCtx.request.post('/api/e2e/login', {
    data: { email: targetEmail }
  });
  expect(targetLogin.ok()).toBeTruthy();
  await targetCtx.close();

  const inviterEmail = uniqueEmail('inviter');
  await loginAs(page, inviterEmail);
  const title = 'Cold Invite Sim';
  const created = await page.request.post('/api/sims', { data: { title } });
  expect(created.status()).toBe(201);
  const { simId } = (await created.json()) as { simId: string };
  const invited = await page.request.post(`/api/sims/${simId}/invites`, {
    data: { target: `@${targetHandle}` }
  });
  expect(invited.status()).toBe(201);
  const inviteUrl = await readMail(page.request, 'invite', targetEmail);

  const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const invitePage = await fresh.newPage();
  await invitePage.goto(new URL(inviteUrl).pathname);
  await expect(invitePage.locator('html')).toHaveAttribute('data-hydrated', '');
  await expect(invitePage.getByRole('heading', { level: 1 })).toHaveText(
    inviteHeading(inviterEmail.split('@')[0], title)
  );
  await invitePage.getByRole('button', { name: MEMBERS_COPY.inviteJoinSim }).click();
  await invitePage.waitForURL(new RegExp(`/sims/${simId}$`));
  await expect(invitePage.getByRole('heading', { level: 1 })).toHaveText(title);

  const session = (await (await invitePage.request.get('/api/auth/get-session')).json()) as {
    user?: { isAnonymous?: boolean };
  } | null;
  expect(session?.user?.isAnonymous).toBe(true);
  await fresh.close();
});
