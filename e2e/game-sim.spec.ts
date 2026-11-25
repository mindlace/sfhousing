// The game on the simulation (game-sim): where a page lands, a run from the tree to the tally and
// back, buying a node and its policy, the node's switch, Run while the forecast is held, the
// workshop and Back, a reload, a first run that fails, a double press of Run, and the published
// view outside the game. Runs against the VITE_E2E build on fixture-0 with the goal amount 1 and
// a 2,000 ms run; every wait is on the page's phase (`data-phase` on `tl-mode`), the saved game
// or `window.__sfhFzp`.
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import type { Policy } from '../src/lib/timeline/policy4';
import { PRICES } from '../src/lib/game/catalogue/tuning';
import { buyNode, savedGame, seedRuns, waitPhase, waitSaved } from './helpers/play';
import { addPolicy, holdPolicy, installPolicyHold, openKind, releasePolicy } from './helpers/run';
import {
  clientNavigate,
  gotoHydrated,
  headerAction,
  openPublish,
  type Win
} from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };
type LogWin = Window & { __phaseLog?: string[]; __treePaneSeen?: boolean };

/** The id of the one transit rule the game makes (`GAME_TRANSIT_ID`, src/lib/game/grant.ts). */
const GAME_TRANSIT = 'game-transit';
const BOND = 'A housing bond';

const run = (page: Page): Locator => page.getByTestId('tree-run');
const node = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="tree-node"][data-node="${id}"]`);

/** The game's transit rule in the page's document, or null. */
const gameRule = (page: Page): Promise<Policy | null> =>
  page.evaluate(
    (id) => (window as FzpWin).__sfhFzp?.policy.kinds.zoning.find((p) => p.id === id) ?? null,
    GAME_TRANSIT
  );

/** Buys stop-rail from the tree (the seed holds its price) and waits for its rule in the page. */
async function buyRail(page: Page): Promise<void> {
  await expect(node(page, 'stop-rail')).toHaveAttribute('data-state', 'ready');
  const s = await buyNode(page, 'stop-rail', 'pointer');
  expect(s.state.units.home ?? 0).toBe(0);
  await expect.poll(async () => (await gameRule(page))?.on ?? null).toBe(true);
}

/**
 * Before the page loads: a log of each `data-phase` the page shows (`__phaseLog`, in order, no
 * repeats) and whether `game-tree-pane` was ever attached (`__treePaneSeen`), from a mutation
 * observer; a phase holds across many frames, so none is missed.
 */
async function logPhases(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as LogWin;
    w.__phaseLog = [];
    w.__treePaneSeen = false;
    const look = () => {
      const p = document.querySelector('[data-testid="tl-mode"]')?.getAttribute('data-phase');
      const log = w.__phaseLog!;
      if (p && log[log.length - 1] !== p) log.push(p);
      if (document.querySelector('[data-testid="game-tree-pane"]')) w.__treePaneSeen = true;
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase', 'data-testid']
    });
  });
}

const phaseLog = (page: Page): Promise<{ log: string[]; pane: boolean }> =>
  page.evaluate(() => {
    const w = window as LogWin;
    return { log: w.__phaseLog ?? [], pane: w.__treePaneSeen ?? false };
  });

// ---- the phases ---------------------------------------------------------------------------------

test('lands on the tree with Run focused over an inert map', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await expect(page.getByTestId('game-tree-pane')).toBeVisible();
  await expect(run(page)).toBeFocused();
  await expect(page.getByTestId('tl-map-box')).toHaveAttribute('inert', '');
});

test('a run goes tree, run, tally, tree', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await run(page).click();
  await waitPhase(page, 'run');
  await expect(page.getByTestId('run-clock')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Date in the simulation' })).toHaveCount(0);
  await waitPhase(page, 'tally');
  const next = page.getByTestId('tally-continue');
  await expect(next).toBeFocused();
  await next.click();
  await waitPhase(page, 'tree');
  expect((await savedGame(page)).state.runs).toBe(2);
});

// ---- buying and the switch ----------------------------------------------------------------------

test('buying stop-rail adds the game transit rule', async ({ page }) => {
  await seedRuns(page, { phase: 'runs', runs: 1, units: { home: PRICES['stop-rail'][0] } });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await buyRail(page);
  const rule = (await gameRule(page))!;
  const asOf = await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf);
  expect(rule.on).toBe(true);
  expect(rule.where.tag).toBe('transit');
  expect(rule.spans).toHaveLength(1);
  // Model month 1's first day (`monthFirstDay(asOf, 1)`), with no end.
  expect(rule.spans[0].from).toBe(asOf + 1);
  expect(rule.spans[0].to).toBeNull();
});

test('the node switch turns its policy off and on, units unchanged', async ({ page }) => {
  await seedRuns(page, { phase: 'runs', runs: 1, units: { home: PRICES['stop-rail'][0] } });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await buyRail(page);
  const before = (await savedGame(page)).state;
  const sw = node(page, 'stop-rail').getByTestId('tree-node-on');
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await gameRule(page))?.on).toBe(false);

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await gameRule(page))?.on).toBe(true);

  const after = (await savedGame(page)).state;
  expect(after.units).toEqual(before.units);
  expect(after.bought).toEqual(before.bought);
});

test('Run while the forecast is held waits, then runs', async ({ page }) => {
  await installPolicyHold(page);
  await seedRuns(page, { phase: 'runs', runs: 1, units: { home: PRICES['stop-rail'][0] } });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await expect(run(page)).not.toHaveAttribute('aria-busy', 'true');
  await holdPolicy(page);
  await buyRail(page);
  await expect(run(page)).toHaveAttribute('aria-busy', 'true');

  await run(page).click();
  await waitPhase(page, 'starting');
  await expect(page.getByTestId('run-waiting')).toHaveText('Getting the forecast ready');
  // Held: the numbers are still from before the buy, so the run cannot start.
  expect(await page.evaluate(() => (window as FzpWin).__sfhFzp!.stale)).toBe(true);
  await expect(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'starting');

  await releasePolicy(page);
  await waitPhase(page, 'run');
  await expect(page.getByTestId('run-waiting')).toHaveCount(0);
});

// ---- the workshop -------------------------------------------------------------------------------

test('the workshop offers no Public money until bought', async ({ page }) => {
  await seedRuns(page, { phase: 'runs', runs: 1, units: { home: PRICES['stop-rail'][0] } });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await buyRail(page);
  // Edit on a bought node is the only way into the workshop with nothing in the money branch.
  await node(page, 'stop-rail').getByTestId('tree-node-edit').click();
  await waitPhase(page, 'workshop');
  const money = page.getByTestId('tl-kind-money');
  await expect(money.getByTestId('tl-locked-lane')).toHaveText('Opens in the tree');
  await expect(money.locator('button.plus')).toHaveCount(0);
});

test('Back to the tree returns to the tree', async ({ page }) => {
  await seedRuns(page, { phase: 'runs', runs: 1, units: { home: PRICES['stop-rail'][0] } });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await buyRail(page);
  await node(page, 'stop-rail').getByTestId('tree-node-edit').click();
  await waitPhase(page, 'workshop');
  await expect(page.getByTestId('game-tree-pane')).toHaveCount(0);

  await (await headerAction(page, 'Back to the tree')).click();
  await waitPhase(page, 'tree');
  await expect(page.getByTestId('game-tree-pane')).toBeVisible();
  await expect(page.getByTestId('game-back')).toHaveCount(0);
});

// ---- reloads and failures -----------------------------------------------------------------------

test('a reload lands where the game is', async ({ page }) => {
  await logPhases(page);
  await seedRuns(page, { phase: 'runs' });
  await gotoHydrated(page, '/');
  // A new game's first run starts at load.
  await waitPhase(page, 'run');
  await page.reload();
  await waitPhase(page, 'run');
  expect((await phaseLog(page)).log[0]).toBe('starting');

  // After the run settles, before Continue: the reload lands on the tree, the balance kept.
  await waitPhase(page, 'tally');
  const settled = await waitSaved(page, (s) => s.state.runs === 1);
  await page.reload();
  await waitPhase(page, 'tree');
  expect((await phaseLog(page)).log[0]).toBe('tree');
  const after = await savedGame(page);
  expect(after.state.runs).toBe(1);
  expect(after.state.units.home).toBe(settled.state.units.home);
});

test('a first run that fails starts again', async ({ page }) => {
  await logPhases(page);
  await seedRuns(page, { phase: 'runs' });
  let failures = 0;
  await page.route('**/scenarios/fzp/calibration.json', async (route) => {
    if (failures++ === 0) await route.fulfill({ status: 500 });
    else await route.continue();
  });
  // The calibration is part of `/`'s load: from another page the load runs in the browser, where
  // the route answers it (a full load of `/` fetches it on the server).
  await gotoHydrated(page, '/about');
  await clientNavigate(page, '/');
  await expect(page).toHaveURL(/\/$/);

  await expect(page.getByTestId('fzp-status')).toHaveText("The simulation couldn't load.");
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await waitPhase(page, 'starting');
  await retry.click();
  await waitPhase(page, 'run');
  await waitPhase(page, 'tally');

  const { log, pane } = await phaseLog(page);
  // The failed load, then Retry's (the timeline worker fetches the file too).
  expect(failures).toBeGreaterThanOrEqual(2);
  expect(log).not.toContain('tree');
  expect(pane).toBe(false);
});

test('a bought node changes nothing on the map before the next run', async ({ page }) => {
  await seedRuns(page, { phase: 'runs', runs: 1, units: { home: PRICES['stop-rail'][0] } });
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await buyRail(page);
  await waitPhase(page, 'tree');
  await expect(page.getByTestId('game-tree-pane')).toBeVisible();
  const box = page.getByTestId('tl-map-box');
  await expect(box).toHaveAttribute('inert', '');
  await expect(box).toHaveAttribute('aria-hidden', 'true');
});

test('a double press of Run makes one run', async ({ page }) => {
  await seedRuns(page);
  await gotoHydrated(page, '/');
  await waitPhase(page, 'tree');
  await run(page).dblclick();
  await waitPhase(page, 'tally');
  await waitSaved(page, (s) => s.state.runs === 2);
  await page.getByTestId('tally-continue').click();
  await waitPhase(page, 'tree');
  expect((await savedGame(page)).state.runs).toBe(2);
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
  await expect(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'none');
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
