// Plan sharing e2e (spec §6, acceptance 1/2/6): paint → publish → open the link in a fresh
// context → same score → Remix → editing a copy. Runs against the VITE_E2E development preview.
import { expect, test } from '@playwright/test';
import {
  PLAN_KEY,
  gotoEditor,
  ops,
  paintOnce,
  publishDialog,
  publishOpen,
  settledNet,
  waitForMap
} from './helpers/sharing';

test('share roundtrip: publish, open in a fresh browser, same score, Remix', async ({
  page,
  browser,
  isMobile
}, testInfo) => {
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  await expect(page.getByTestId('score-net')).not.toHaveText('0');
  const authorNet = await settledNet(page);

  await expect(publishOpen(page)).toBeEnabled();
  await publishOpen(page).click();
  const dialog = publishDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Publish this plan' })).toBeVisible();
  await dialog.getByLabel('Title').fill('Roundtrip');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  const path = new URL(link).pathname;
  expect(path).toMatch(/^\/p\/[1-9A-HJ-NP-Za-km-z]{8}$/);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(publishOpen(page)).toHaveText('Share link');

  // A visitor: a fresh context (empty localStorage) with the same device profile.
  const {
    viewport,
    isMobile: mobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  } = testInfo.project.use;
  const ctx = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  });
  try {
    const visitor = await ctx.newPage();
    // A shared plan has identical score and remix behavior when optional roofs are unavailable.
    await visitor.route('**/roofs/**', (r) => r.abort());
    const res = await visitor.goto(link);
    expect(res?.status()).toBe(200);
    const banner = visitor.getByRole('region', { name: 'Shared plan' });
    await expect(banner).toContainText('Roundtrip');
    await expect(banner).toContainText('Shared plan');
    expect(await visitor.evaluate((k) => localStorage.getItem(k), PLAN_KEY)).toBeNull();

    await waitForMap(visitor);
    await expect(visitor.getByTestId('score-net')).not.toHaveText('0');
    expect(await settledNet(visitor)).toBe(authorNet);
    // Acceptance 6: viewing a shared plan never writes the visitor's autosave.
    expect(await visitor.evaluate((k) => localStorage.getItem(k), PLAN_KEY)).toBeNull();

    // Empty local plan: Remix goes straight to `/` without a confirm.
    await banner.getByRole('button', { name: 'Remix' }).click();
    await expect(visitor).toHaveURL(new URL('/', link).toString());
    await expect(
      visitor.getByText("Remixed from Roundtrip. You're editing your own copy.")
    ).toBeVisible();
    await waitForMap(visitor);
    await expect.poll(() => ops(visitor)).toBe(1);
  } finally {
    await ctx.close();
  }
});
