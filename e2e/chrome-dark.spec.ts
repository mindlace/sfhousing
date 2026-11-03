// Dark chrome (sim-runs spec §8): the header and the /sim timeline bar take dark variants and stay
// WCAG AA; light-only panels (the scoreboard) keep the light accent. Both Playwright projects.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { startRun } from './helpers/run';
import {
  FRAME,
  gotoEditor,
  headerAction,
  jumpAndIdle,
  projectToPage,
  type LngLat
} from './helpers/sharing';

type FzpWin = Window & { __sfhFzp?: SfhFzpDebug };

test.use({ colorScheme: 'dark' });

/** /sim, ready, in Setup; with `run`, a run started and paused. */
async function gotoSim(page: Page, { run = false }: { run?: boolean } = {}): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await expect(page.locator('.sfh-fzp-scrubber')).toBeVisible();
  if (run) await startRun(page);
}

/** Below md the scoreboard is a sheet behind its bar; from md it is already open. */
async function openScoreboard(page: Page, isMobile: boolean): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Housing scoreboard' });
  if (!isMobile) return region;
  await region.getByRole('button', { name: /net new homes/ }).tap();
  await expect(page.getByRole('group', { name: 'Scoreboard details' })).toBeVisible();
  return region;
}

test('/ header has no axe violations in dark', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.getByRole('banner')).toBeVisible();
  await expectNoA11yViolations(page, { include: ['header'] });
});

test('/sim header and timeline bar have no axe violations in dark, in Setup', async ({ page }) => {
  await gotoSim(page);
  await expect(page.getByRole('banner')).toBeVisible();
  await expectNoA11yViolations(page, { include: ['header', '.sfh-fzp-scrubber'] });
});

test('/sim timeline bar (Today and horizon markers, Play) has no axe violations in dark, in a run', async ({
  page
}) => {
  await gotoSim(page, { run: true });
  await expect(page.getByTestId('fzp-start')).toHaveText('Today');
  await expectNoA11yViolations(page, { include: ['header', '.sfh-fzp-scrubber'] });
});

test('at 375px the open Menu has no axe violations in dark', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoEditor(page);
  const menu = page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('navigation', { name: 'Modes' }).getByRole('link', { name: 'Paint' })
  ).toBeVisible();
  await expectNoA11yViolations(page, { include: ['header'] });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});

test('the header is dark in dark mode', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.getByRole('banner')).toHaveCSS('background-color', 'rgb(28, 29, 31)');
});

test('light-only panels keep the light accent in dark mode', async ({ page, isMobile }) => {
  await gotoEditor(page);
  const region = await openScoreboard(page, isMobile);
  // One bar fill per target row: the primary target's (the h-4 meter) is the one under test.
  // Below md the primary row renders twice (the bar and the open sheet); both share the classes.
  const fill = region.locator('[data-primary="true"] [data-testid="bar-fill"]').first();
  await expect(fill).toBeAttached();
  await expect(fill).toHaveCSS('background-color', 'rgb(163, 71, 44)');
});

// ---- the policy dock (sim-ux plan 2): tabs, Results, the project card and the notice pills ------

const dock = (page: Page): Locator => page.getByTestId('dock');
const dockHandle = (page: Page): Locator => page.getByTestId('dock-handle');

/** The dock's body open: from md the panel is open already; below md the handle opens the sheet. */
async function openDock(page: Page): Promise<void> {
  const handle = dockHandle(page);
  if ((await handle.isVisible()) && (await handle.getAttribute('aria-expanded')) !== 'true') {
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
  }
}

async function openTab(page: Page, name: string): Promise<void> {
  await openDock(page);
  const tab = dock(page).getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

for (const name of ['Transit', 'Paint', 'Permits', 'Protect']) {
  test(`the dock open on ${name} has no axe violations in dark`, async ({ page }) => {
    await gotoSim(page);
    await openTab(page, name);
    await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
  });
}

test('the dock on Permits with a stage open has no axe violations in dark', async ({ page }) => {
  await gotoSim(page);
  await openTab(page, 'Permits');
  const stage = dock(page)
    .getByRole('group', { name: /timeline$/ })
    .first()
    .getByRole('button')
    .first();
  await stage.click();
  await expect(stage).toHaveAttribute('aria-expanded', 'true');
  await expect(dock(page).getByRole('button', { name: 'Shorten by 0.5 month' })).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
});

test('the dock with a rule form and a saved rule card has no axe violations in dark', async ({
  page
}) => {
  await gotoSim(page);
  await openTab(page, 'Transit');
  await dock(page).getByRole('button', { name: 'Add transit layer' }).click({ timeout: 20_000 });
  const form = dock(page).getByRole('form', { name: 'Add a transit rule', exact: true });
  await expect(form).toBeVisible();
  await form.getByRole('checkbox', { name: /^Muni Metro/ }).check();
  await form.getByText('ⓘ').click();
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
  await form.getByRole('button', { name: 'Save rule' }).click();
  await expect(dock(page).getByRole('list', { name: 'New zoning rules' })).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
});

test('the dock on Results during a run has no axe violations in dark', async ({ page }) => {
  await gotoSim(page, { run: true });
  await openDock(page);
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
});

test("the dock's computed background is surface-dark in dark", async ({ page }) => {
  await gotoSim(page);
  await openDock(page);
  const box = page.locator('.sfh-dock-panel, .sfh-dock-sheet').first();
  await expect(box).toBeVisible();
  await expect(box).toHaveCSS('background-color', 'rgb(28, 29, 31)');
});

// The project card: fixture-0's real project, picked on the parcel only it holds.
const DATA = new URL('./fixtures/data/fixture-0/', import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DATA), 'utf8')) as T;

test('an open project card has no axe violations in dark', async ({ isMobile, page }) => {
  const { projects } = readJson<{
    projects: { id: string; label: string | null; parcelIds: string[] }[];
  }>('scenarios/fzp/projects.json');
  const chunk = readJson<{ id: string[]; label: number[] }>('parcels/50_25.json');
  const real = projects.find((p) => p.id === 'PRJ:2019-000001PRJ')!;
  const others = new Set(projects.filter((p) => p !== real).flatMap((p) => p.parcelIds));
  const own = real.parcelIds.find((id) => !others.has(id) && chunk.id.includes(id))!;
  const i = chunk.id.indexOf(own);
  const at: LngLat = [chunk.label[2 * i] / 1e7, chunk.label[2 * i + 1] / 1e7];

  await gotoSim(page);
  await jumpAndIdle(page, { ...FRAME, center: at });
  const card = page.getByRole('region', { name: real.label ?? real.id, exact: true });
  await expect(async () => {
    const [x, y] = await projectToPage(page, at);
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await expect(card).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await expectNoA11yViolations(page, { include: ['section[aria-labelledby]'] });
  await expect(card).toHaveCSS('background-color', 'rgb(28, 29, 31)');
});

test('the pill stack showing a notice has no axe violations in dark', async ({ page }) => {
  // The page's own reroll request is given a seed the worker rejects, so the failed-reroll notice
  // shows and stays.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: never[]) {
      const m = msg as { type?: string };
      return post.call(this, m?.type === 'reroll' ? { ...m, seed: -1 } : msg, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  await gotoSim(page);
  await (await headerAction(page, 'Another future')).click();
  const alert = page.getByRole('alert').filter({ hasText: "Couldn't make another future" });
  await expect(alert).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=fzp-notices]'] });
});
