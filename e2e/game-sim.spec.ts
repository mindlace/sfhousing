// The game on the simulation (game-sim): a game's page is the simulation tool, its lanes held to
// the rounds offered, and the published view outside the game. Runs against the VITE_E2E build on
// fixture-0 with the goal amount 1; every wait is on the page (the tool's dock) or
// `window.__sfhFzp`.
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { seedRuns, waitSim } from './helpers/play';
import { addPolicy, openKind } from './helpers/run';
import { gotoHydrated, openPublish, type Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

const BOND = 'A housing bond';

// ---- the game's limits --------------------------------------------------------------------------

test('the tool offers no Public money before round 1', async ({ page }) => {
  await seedRuns(page, { phase: 'runs', round: 0 });
  await gotoHydrated(page, '/');
  await waitSim(page);
  const money = page.getByTestId('tl-kind-money');
  await expect(money).toBeAttached();
  await expect(money.getByTestId('tl-locked-lane')).toHaveCount(0);
  await expect(money.locator('button.plus')).toHaveCount(0);
});

// ---- the published view -------------------------------------------------------------------------

/** `path` loaded and hydrated, the session ready and the forecast filled. */
async function gotoSim(page: Page, path: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, path);
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await page.waitForFunction(() => {
    const f = (window as FzpWin).__sfhFzp;
    return !!f && f.lastIndex >= 0 && f.filledThrough === f.lastIndex && !f.stale;
  });
}

/** Closes the editor if it shows. */
async function closeEditor(page: Page): Promise<void> {
  const editor = page.getByTestId('inspector');
  const close = editor.getByRole('button', { name: 'Close editor' });
  if (await close.isVisible()) await close.click();
  await expect(editor).toHaveCount(0);
}

/** A policy's rows (`tl-policy`) by its label. */
const policyRows = (page: Page, label: string): Locator =>
  page.getByTestId('tl-policy').filter({ hasText: label });

/** A second context on this project's device, with its own storage and no game: the open game. */
async function otherPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const ctx = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  });
  return ctx.newPage();
}

/** Publishes the page's policy and returns the `/s/<id>` path. */
async function publish(page: Page): Promise<string> {
  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Publish this policy|Published/ });
  await expect(dialog.getByRole('heading', { name: 'Publish this policy' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();
  const path = new URL(link).pathname;
  expect(path).toMatch(/^\/s\/[1-9A-HJ-NP-Za-km-z]{8}$/);
  return path;
}

/** Publishes `choice` of `kind` from the open game's `/` in another context; returns the path. */
async function publishFromOpenGame(
  browser: Browser,
  testInfo: TestInfo,
  kind: string,
  choice: string
): Promise<string> {
  const author = await otherPage(browser, testInfo);
  try {
    await gotoSim(author, '/');
    await addPolicy(author, kind, choice);
    await closeEditor(author);
    return await publish(author);
  } finally {
    await author.context().close();
  }
}

/** The view outside the game: no phase, no tree, no lock and no Remix. */
async function expectOutsideGame(page: Page): Promise<void> {
  await expect(page.getByTestId('tl-mode')).not.toHaveAttribute('data-phase');
  await expect(page.getByTestId('game-tree-pane')).toHaveCount(0);
  await expect(page.getByTestId('tl-locked-lane')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Remix/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Remix/ })).toHaveCount(0);
}

test('a published policy runs in full outside the game', async ({ page, browser }, testInfo) => {
  const path = await publishFromOpenGame(browser, testInfo, 'Zoning', 'Transit rule');

  await seedRuns(page);
  await gotoSim(page, path);
  await expectOutsideGame(page);
  await openKind(page, 'Zoning');
  await expect(policyRows(page, 'Transit rule')).not.toHaveCount(0);
  for (const row of await policyRows(page, 'Transit rule').all())
    await expect(row).not.toHaveAttribute('data-locked');
});

test('a published given measure runs in full outside the game', async ({
  page,
  browser
}, testInfo) => {
  const path = await publishFromOpenGame(browser, testInfo, 'Public money', BOND);

  await seedRuns(page);
  await gotoSim(page, path);
  await expectOutsideGame(page);
  await openKind(page, 'Public money');
  await expect(policyRows(page, BOND)).not.toHaveCount(0);
  for (const row of await policyRows(page, BOND).all())
    await expect(row).not.toHaveAttribute('data-locked');
  const money = await page.evaluate(() => (window as FzpWin).__sfhFzp!.policy.kinds.money);
  expect(money[0].preset).toBe('housing-bond');
});
