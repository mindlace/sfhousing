// Plan sharing e2e states (spec §6): not-found page, a rate-limited publish (route-mocked 429; the
// development preview bypasses the real limiter), autosave restore on reload, the Remix confirm,
// and two states only a row seeded through the e2e-only route can produce (N6, unparsable).
import { expect, test, type Page } from '@playwright/test';
import {
  PLAN_KEY,
  gotoEditor,
  oldVersionText,
  ops,
  paintOnce,
  publishDialog,
  publishOpen,
  seedPlanRow,
  smallText,
  waitForMap
} from './helpers/sharing';

// The header's indicator reads "Saved" before the first write too, so also wait for the write.
async function waitSaved(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((k) => {
        const raw = localStorage.getItem(k);
        if (!raw) return 0;
        const record = JSON.parse(raw) as { plan: string };
        return (JSON.parse(record.plan) as { ops: unknown[] }).ops.length;
      }, PLAN_KEY)
    )
    .toBe(1);
  await expect(page.getByRole('banner').getByText('Saved', { exact: true })).toBeVisible();
}

test('an unknown id is a 404 "Plan not found" page, noindex', async ({ page }) => {
  const res = await page.goto('/p/zzzzzzzz');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Plan not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start your own plan' })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
});

test('a rate-limited publish shows the alert and a countdown, then re-enables Publish', async ({
  page,
  isMobile
}) => {
  await page.route('**/api/plans', (r) =>
    r.fulfill({
      status: 429,
      headers: { 'retry-after': '5', 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'rate_limited', message: '' } })
    })
  );
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  await expect(publishOpen(page)).toBeEnabled();
  await publishOpen(page).click();
  const dialog = publishDialog(page);
  const publish = dialog.getByRole('button', { name: 'Publish' });
  await publish.click();

  await expect(dialog.getByRole('alert')).toHaveText(
    'Too many plans published from your network. Try again in a minute.'
  );
  await expect(dialog.getByText(/You can publish again in \d s\./)).toBeVisible();
  await expect(publish).toBeDisabled();
  await expect(publish).toBeEnabled({ timeout: 7_000 });
  await expect(dialog.getByText(/You can publish again in/)).toBeHidden();
});

test('reload restores the autosaved plan', async ({ page, isMobile }) => {
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  await waitSaved(page);
  await page.reload();
  await waitForMap(page);
  await expect.poll(() => ops(page)).toBe(1);
});

test('Remix over a non-empty local plan asks first; Cancel stays on the shared plan', async ({
  page,
  request,
  isMobile
}) => {
  const res = await request.post('/api/plans', {
    data: smallText,
    headers: { 'content-type': 'application/json' }
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };

  await gotoEditor(page);
  await paintOnce(page, isMobile);
  await waitSaved(page);

  await page.goto(`/p/${id}`);
  const banner = page.getByRole('region', { name: 'Shared plan' });
  await expect(banner).toContainText('Untitled plan');
  // Hydration wires the Remix handler; wait for the map so the click is not lost to SSR markup.
  await waitForMap(page);
  await banner.getByRole('button', { name: 'Remix' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('(1 strokes)');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/p/${id}$`));
});

test('N6: a share link whose dataset version is gone renders on the current data', async ({
  page,
  request
}) => {
  const id = await seedPlanRow(request, { body: oldVersionText });
  const res = await page.goto(`/p/${id}`);
  expect(res?.status()).toBe(200);
  const banner = page.getByRole('region', { name: 'Shared plan' });
  await expect(banner).toContainText(
    'Made with map data fixture-0000, which is no longer available. Shown on the current data ' +
      '(fixture-0); numbers may differ from when it was published.'
  );
  await expect(banner.getByRole('button', { name: 'Open with current data' })).toBeVisible();
  await waitForMap(page);
  await expect(page.getByTestId('score-net')).not.toHaveText('0');
});

test('a stored plan this app cannot parse is a 500 page with its own copy', async ({
  page,
  request
}) => {
  const id = await seedPlanRow(request, {
    body: '{"schema":1,"datasetVersion":"fixture-0","ops":"nope"}'
  });
  const res = await page.goto(`/p/${id}`);
  expect(res?.status()).toBe(500);
  await expect(
    page.getByRole('heading', { name: "This plan can't be shown by this version of the app." })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
});
