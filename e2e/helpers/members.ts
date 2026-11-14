// Shared helpers for the membership e2e specs (invite, leave).
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo
} from '@playwright/test';
import { MEMBERS_COPY } from '../../src/lib/members/copy';
import { loginAs, readMail } from './auth';

/** A signed-out context that looks like the running project (viewport, touch, base URL). */
export async function freshContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } =
    testInfo.project.use;
  return browser.newContext({
    baseURL,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
    storageState: { cookies: [], origins: [] }
  });
}

/** Sign `page` in as `email` and create a sim through the API; returns its id. */
export async function signInAndCreateSim(
  page: Page,
  email: string,
  title: string
): Promise<string> {
  await loginAs(page, email);
  const res = await page.request.post('/api/sims', { data: { title } });
  expect(res.status(), 'POST /api/sims').toBe(201);
  return ((await res.json()) as { simId: string }).simId;
}

/** The signed-in handle (no @) of `page`, read from the header's account entry. */
export async function ownHandle(page: Page): Promise<string> {
  const title = await page.locator('[data-header-account]').getAttribute('title');
  expect(title, 'header account entry title').toMatch(/^@/);
  return title!.slice(1);
}

/** Invite `target` to the sim as the page's signed-in manager, through the API. */
export async function inviteViaApi(page: Page, simId: string, target: string): Promise<void> {
  const res = await page.request.post(`/api/sims/${simId}/invites`, { data: { target } });
  expect(res.status(), 'POST invite').toBe(201);
}

/** Open a page on a sim (hydrated) with the Members disclosure open. */
export async function openMembers(page: Page, simId: string): Promise<void> {
  await page.goto(`/sims/${simId}`);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.getByTestId('members').locator('summary').click();
  await expect(page.getByTestId('members').getByRole('list').first()).toBeVisible();
}

/** The invite link mailed to `email`, as a path on this server. */
export async function inviteLinkFor(page: Page, email: string): Promise<string> {
  const url = await readMail(page.request, 'invite', email);
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/** Follow an invite link signed out and join with the invited address. */
export async function coldJoin(page: Page, path: string, email: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.locator('#invite-email').fill(email);
  await page.getByRole('button', { name: MEMBERS_COPY.inviteJoinSim }).click();
  await page.waitForURL(/\/sims\/[^/]+$/);
}
