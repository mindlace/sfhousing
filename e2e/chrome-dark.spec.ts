// Dark chrome (sim-runs spec §8, sim-ux spec Goal 9): the header, the /sim timeline bar, the dock
// and its Results face on both pages, and the notice pills take dark variants and stay WCAG AA.
// Both Playwright projects.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { COPY } from '../src/lib/sharing/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { startRun } from './helpers/run';
import {
  FRAME,
  PLAN_KEY,
  gotoEditor,
  headerAction,
  headerNet,
  jumpAndIdle,
  openResults,
  paintOnce,
  projectToPage,
  seedPlanRow,
  SIM_KEY,
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

test("/'s Results face follows the dark tokens: the RHNA fill is the dark accent", async ({
  page
}) => {
  await gotoEditor(page);
  // Pressing the header score shows Results (in the dock from md, in the sheet below).
  const results = await openResults(page);
  const fill = results.locator('[data-primary="true"] [data-testid="bar-fill"]');
  await expect(fill).toBeAttached();
  await expect(fill).toHaveCSS('background-color', 'rgb(224, 149, 90)');
  await expect(results.getByTestId('score-net')).toHaveCSS('color', 'rgb(232, 228, 220)');
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

test("/'s dock on Paint, a painted row selected, has no axe violations in dark", async ({
  page,
  isMobile
}) => {
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  await openDock(page);
  const row = dock(page).locator('[data-paint-row]').first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page).getByRole('button', { name: /^Remove: / })).toBeVisible();
  await expectNoA11yViolations(page, {
    include: ['[data-testid=dock]', '[data-testid=fzp-notices]']
  });
});

test("/'s Results face, a plan painted and both disclosures open, has no axe violations in dark", async ({
  page,
  isMobile
}) => {
  await gotoEditor(page);
  await paintOnce(page, isMobile);
  await expect.poll(() => headerNet(page)).toBeGreaterThan(0);
  const results = await openResults(page);
  for (const d of await results.locator('details > summary').all()) await d.click();
  await expect(results.locator('details[open]')).toHaveCount(2);
  await expectNoA11yViolations(page, { include: ['header', '[data-testid=dock]'] });
});

test("/'s notice pill (N1) in the one stack has no axe violations in dark", async ({ page }) => {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('sfh-e2e-seeded')) return;
    sessionStorage.setItem('sfh-e2e-seeded', '1');
    localStorage.setItem(key, '{not json');
  }, PLAN_KEY);
  await gotoEditor(page);
  const pill = page.getByTestId('fzp-notices').getByTestId('notice');
  await expect(pill).toHaveText(COPY.n1);
  await expect(pill).toHaveCSS('background-color', 'rgb(44, 46, 49)');
  await expectNoA11yViolations(page, { include: ['[data-testid=fzp-notices]'] });
});

test('at 375px the palette strip has no axe violations in dark, palette open and in Erase', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoSim(page);
  await openTab(page, 'Paint');
  await dock(page).getByRole('radio', { name: 'Paint', exact: true }).click();
  const strip = page.getByTestId('palette-strip');
  await expect(strip).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=palette-strip]'] });
  // The height pop-over open; Escape returns focus to the swatch.
  const swatch = strip.getByRole('button', { name: /^Height: / });
  await swatch.click();
  await expect(strip.getByRole('group', { name: 'Height', exact: true })).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=palette-strip]'] });
  await page.keyboard.press('Escape');
  await expect(strip.getByRole('group', { name: 'Height', exact: true })).toBeHidden();
  await expect(swatch).toBeFocused();
  // The radius pop-over open.
  await strip.getByRole('button', { name: /^Brush \d+ m$/ }).click();
  await expect(strip.getByRole('group', { name: 'Brush radius' })).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=palette-strip]'] });
  // Erase: the swatch is disabled and carries the hint.
  await page.keyboard.press('Escape');
  await strip.getByRole('button', { name: 'Tool: Paint' }).click();
  await expect(strip.getByRole('button', { name: 'Tool: Erase' })).toBeVisible();
  await expect(swatch).toBeDisabled();
  await expectNoA11yViolations(page, { include: ['[data-testid=palette-strip]'] });
});

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

test("a selected layer's expanded editor has no axe violations in dark", async ({ page }) => {
  await gotoSim(page);
  await openTab(page, 'Transit');
  await dock(page).getByRole('button', { name: 'Add transit layer' }).click({ timeout: 20_000 });
  const chips = dock(page).getByRole('group', { name: 'Stop types' });
  await expect(chips).toBeVisible();
  // A chip on, and a bound reached: More on the outer band is aria-disabled.
  await chips.getByRole('button', { name: /^Muni Rapid bus/ }).click();
  const outer = dock(page).getByRole('group', { name: 'Band 2' });
  for (let k = 0; k < 2; k++)
    await outer.getByRole('button', { name: 'More stories, band 2', exact: true }).click();
  await expect(
    outer.getByRole('button', { name: 'More stories, band 2', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
  // The FZP baseline row selected: the layer folds.
  const fzp = dock(page).getByRole('button', { name: 'FZP baseline', exact: true });
  await fzp.click();
  await expect(fzp).toHaveAttribute('aria-pressed', 'true');
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
});

test('the dock on Results during a run has no axe violations in dark', async ({ page }) => {
  await gotoSim(page, { run: true });
  await openDock(page);
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible();
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
});

/**
 * A shared policy with one transit rule (so the summary has a row), opened at /s/<id>: the rule is
 * added on /sim, read back from the app's own autosave, seeded as a policy row and visited.
 */
async function gotoSharedPolicy(page: Page): Promise<void> {
  await gotoSim(page);
  await openTab(page, 'Transit');
  await dock(page).getByRole('button', { name: 'Add transit layer' }).click({ timeout: 20_000 });
  await expect(dock(page).getByRole('group', { name: 'Stop types' })).toBeVisible();
  const stored = () =>
    page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw === null ? null : (JSON.parse(raw) as { plan: string }).plan;
    }, SIM_KEY);
  await expect.poll(async () => (await stored())?.includes('"transit"')).toBe(true);
  const body = (await stored())!;
  const id = await seedPlanRow(page.request, {
    body,
    datasetVersion: (JSON.parse(body) as { datasetVersion: string }).datasetVersion,
    kind: 'sim'
  });
  await page.goto(`/s/${id}`);
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await expect(page.getByRole('region', { name: 'Shared policy' })).toBeVisible();
}

test('the shared view dock on Policy has no axe violations in dark', async ({ page }) => {
  await gotoSharedPolicy(page);
  await openDock(page);
  await expect(dock(page).getByRole('tab', { name: 'Policy', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    dock(page).getByRole('region', { name: 'Transit layers' }).getByRole('listitem')
  ).toHaveCount(1);
  await expectNoA11yViolations(page, { include: ['[data-testid=dock]'] });
});

test('the shared view dock on Results during a run has no axe violations in dark', async ({
  page
}) => {
  await gotoSharedPolicy(page);
  await startRun(page);
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

  // Cards open only in a run (in Set Policy a click selects a layer).
  await gotoSim(page, { run: true });
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
