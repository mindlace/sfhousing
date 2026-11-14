// Sign-in side of pseudonymous onboarding: a known device steered to /signin keeps a working
// escape hatch (and the response that starts fresh stages two cookies at once), and a
// pseudonymous visitor adds an unclaimed email through the magic link and keeps their sim.
// The create-a-sim side is in sims-onboarding.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { AUTH_COPY, pendingSimLine } from '../src/lib/account/copy';
import { SIMS_COPY } from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { uniqueEmail } from './helpers/auth';

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
  // Every response in the flow, with the set-cookie headers each carried.
  const seen: { method: string; path: string; status: number; setCookie: string[] }[] = [];
  page.on('response', async (res) => {
    const req = res.request();
    if (req.resourceType() !== 'document' && req.method() !== 'POST') return;
    const url = new URL(res.url());
    if (url.pathname.startsWith('/data/')) return;
    const headers = await res.headersArray().catch(() => []);
    seen.push({
      method: req.method(),
      path: url.pathname + url.search,
      status: res.status(),
      setCookie: headers.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value)
    });
  });

  await context.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
  await createSim(page, 'Two Cookies');
  await page.waitForURL((url) => url.pathname === '/signin');

  // The pending-sim cookie was stashed on the way here; no session yet.
  const before = (await context.cookies()).map((c) => c.name);
  expect(before).toContain(PENDING_SIM_COOKIE);
  expect(before).not.toContain(SESSION_COOKIE);
  const toSignin = seen.splice(0);

  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByTestId('start-fresh').click();
  await page.waitForURL(/\/sims\/[^/]+$/);

  // The browser context after that response: the session is there, the stash is gone.
  const after = (await context.cookies()).map((c) => c.name);
  expect(after).toContain(SESSION_COOKIE);
  expect(after).not.toContain(PENDING_SIM_COOKIE);

  // Both effects came on ONE response: the 303 to the new sim (kept whole through
  // headersHandle's re-wrap of a redirect).
  const startFresh = seen.find((r) => r.method === 'POST' && r.path.includes('startFresh'))!;
  expect(startFresh.status).toBe(303);
  const names = startFresh.setCookie.map((c) => c.split('=', 1)[0]);
  expect(names).toContain(SESSION_COOKIE);
  expect(names).toContain(PENDING_SIM_COOKIE);
  const cleared = startFresh.setCookie.find((c) => c.startsWith(`${PENDING_SIM_COOKIE}=`))!;
  expect(cleared).toMatch(/Max-Age=0/i);
  // Evidence for the report.
  test
    .info()
    .annotations.push({ type: 'responses', description: JSON.stringify([toSignin, seen]) });
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
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});

test('the escape hatch without a stashed sim lands on /sims', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByRole('button', { name: AUTH_COPY.startFresh }).click();
  await page.waitForURL((url) => url.pathname === '/sims');
});
