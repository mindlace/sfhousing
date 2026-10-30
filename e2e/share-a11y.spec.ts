// Plan sharing a11y (spec §6, accessibility §4.9): axe WCAG 2.2 AA scans of the shared plan page,
// the not-found page, and the Publish dialog in its success and error states, at both viewports.
// Scans are unscoped, like the brush and scoreboard specs.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import {
  gotoEditor,
  paintOnce,
  publishDialog,
  openPublish,
  smallText,
  waitForMap
} from './helpers/sharing';

// No horizontal page scroll (375 px on the mobile project), as in pages-a11y.spec.ts.
async function expectNoHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
}

test('axe: a shared plan page /p/:id', async ({ page, request }) => {
  const res = await request.post('/api/plans', {
    data: smallText,
    headers: { 'content-type': 'application/json' }
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/p/${id}`);
  await waitForMap(page);
  await expect(page.getByRole('region', { name: 'Shared plan' })).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);
});

test('axe: the plan-not-found page', async ({ page }) => {
  const res = await page.goto('/p/zzzzzzzz');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Plan not found' })).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);
});

test('axe: the Publish dialog after a successful publish', async ({ page, isMobile }) => {
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = publishDialog(page);
  await dialog.getByLabel('Title').fill('A11y check');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  await expect(dialog.getByLabel('Link')).toBeFocused();
  await expectNoA11yViolations(page);
});

test('axe: the Publish dialog in an error state (rate limited)', async ({ page, isMobile }) => {
  await page.route('**/api/plans', (r) =>
    r.fulfill({
      status: 429,
      headers: { 'retry-after': '5', 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'rate_limited', message: '' } })
    })
  );
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = publishDialog(page);
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('alert')).not.toBeEmpty();
  await expectNoA11yViolations(page);
});
