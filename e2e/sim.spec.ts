// /sim e2e on the timeline (timeline-ui): the /fzp redirect, the header score and the phone Menu,
// Results and the editor in the inspector, a transit rule, a painted area and its undo, selecting
// on the map, a category protection, permitting presets and edits, the map overlays, the header
// layout and the live paint preview, with the accessibility checks. Runs against the VITE_E2E
// build, which exposes window.__sfhFzp (src/lib/fzp/debug.ts: the playhead day, the fill, the
// refills, the document), window.__sfhSim (the live preview, src/lib/sim-page/debug.ts) and
// window.__sfhMap. Every edit is checked against the real worker: the forecast refills and fills
// again.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import type { SfhSimDebug } from '../src/lib/sim-page/debug';
import { forecastFilled } from '../src/lib/timeline/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable, expectNoFooter } from './helpers/chrome';
import { addPolicy, openKind, slider, waitFilled } from './helpers/run';
import {
  FRAME,
  FROM,
  TO,
  TOUCH_FROM,
  TOUCH_TO,
  headerAction,
  jumpAndIdle,
  mouseDrag,
  openHeaderMenu,
  projectToPage,
  touchDrag,
  waitTimelineDrawn,
  type Win
} from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

// ---- helpers ------------------------------------------------------------------------------------

function fzp<K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> {
  return page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;
}
type SimWin = Win & { __sfhSim?: SfhSimDebug };
/** The live preview's state (`window.__sfhSim`, src/lib/sim-page/debug.ts). */
const simPreview = (page: Page) =>
  page.evaluate(() => (window as SimWin).__sfhSim?.preview ?? null);

/** The page is ready, the map is up and the forecast is filled. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
  await waitFilled(page);
}

/** /sim (or `path`), ready, the forecast filled. */
async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await waitReady(page);
}

/** The number of refills the page has seen. */
const refillCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.refills.length);

/** Waits for a refill after the `before`-th, and the forecast filled again. */
async function waitRefilled(page: Page, before: number): Promise<void> {
  await page.waitForFunction((n) => {
    const f = (window as FzpWin).__sfhFzp!;
    return f.refills.length > n && !f.stale && f.filledThrough === f.lastIndex;
  }, before);
}

/**
 * Turns the zoning height limits off in the saved view prefs (`sfhousing:view`) before the page
 * loads, for a Paint test that never looks at them: they are the costliest overlay, on startup
 * and again when Paint is chosen (#74, #75, #76). Their own tests leave them on.
 */
async function hideHeightLimits(page: Page): Promise<void> {
  await page.addInitScript(() =>
    localStorage.setItem('sfhousing:view', JSON.stringify({ heightLimits: false }))
  );
}

const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
/** Results: from md in the detail column when nothing else is open, below md in the sheet. */
const results = (page: Page): Locator => page.getByTestId('tl-results');
/** The editor (the selected policy, a fixed row or the "+" menu). */
const editor = (page: Page): Locator => page.getByTestId('inspector');
/** The inspector's box: the detail column beside the timeline from md, a sheet below. */
const inspectorBox = (page: Page): Locator => page.getByTestId('tl-inspector');
const menuButton = (page: Page): Locator =>
  page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true });

/**
 * Shows Results. From md the header score has no aria-expanded and shows Results in the detail
 * column; below md it opens the sheet.
 */
async function openScore(page: Page): Promise<Locator> {
  const expanded = await scoreBar(page).getAttribute('aria-expanded');
  if (expanded === null) {
    if (!(await results(page).isVisible())) await scoreBar(page).click();
  } else {
    if (expanded !== 'true') await scoreBar(page).click();
    await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(results(page)).toBeVisible();
  return results(page);
}

/** True when the element at `loc`'s centre is `loc` or inside it. */
const topmostAtCentre = (loc: Locator): Promise<boolean> =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && el.contains(top);
  });

/** Closes the editor if it shows. */
async function closeEditor(page: Page): Promise<void> {
  const close = editor(page).getByRole('button', { name: 'Close editor' });
  if (await close.isVisible()) await close.click();
  await expect(editor(page)).toHaveCount(0);
}

/** Below md the page scrolls inside the mode's box: back to its top, where the map is. */
async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('[data-testid="tl-mode"]')?.scrollTo(0, 0);
  });
}

/** The painted areas of the selected painted policy's span. */
const customList = (page: Page): Locator =>
  editor(page).getByRole('list', { name: 'Painted areas' }).getByRole('listitem');
/** A brush tool in the painted policy's editor. */
const tool = (page: Page, name: 'Move' | 'Paint' | 'Erase'): Locator =>
  editor(page).getByRole('radio', { name, exact: true });

/** One stroke across fixture-0's parcel row: a mouse drag on desktop, a finger on the phone. */
async function strokeOnce(page: Page, isMobile: boolean): Promise<void> {
  await jumpAndIdle(page);
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await touchDrag(
      cdp,
      await projectToPage(page, TOUCH_FROM),
      await projectToPage(page, TOUCH_TO)
    );
  } else {
    await mouseDrag(page, FROM, TO);
  }
}

/**
 * Paints the lots of fixture-0's parcel row with one keyboard stamp (Enter on the focused map, with
 * Paint chosen) at FRAME's centre: cheaper than a drag (#70), and it needs only the camera.
 */
async function stampOnce(page: Page, center: [number, number] = FRAME.center): Promise<void> {
  await page.evaluate((f) => (window as Win).__sfhMap!.map!.jumpTo(f), { ...FRAME, center });
  await page.locator('.maplibregl-canvas').focus();
  await page.keyboard.press('Enter');
}

/**
 * Adds a painted policy and chooses Paint in its editor. Below md the editor's sheet then closes
 * (the palette strip offers the tools), so the map is free for a stroke; the stroke goes into a new
 * painted policy of its own then.
 */
async function startPainting(page: Page, isMobile: boolean): Promise<void> {
  await addPolicy(page, 'Zoning', 'Painted area');
  await expect(tool(page, 'Paint')).toBeEnabled();
  await tool(page, 'Paint').click();
  if (isMobile) {
    await expect(page.getByTestId('palette-strip')).toBeVisible();
    await closeEditor(page);
    await scrollToTop(page);
  }
}

/** The zoning policies' painted areas in the document, counted. */
const paintedAreas = (page: Page): Promise<number> =>
  page.evaluate(() =>
    (window as FzpWin)
      .__sfhFzp!.policy.kinds.zoning.filter((p) => p.where.tag === 'painted')
      .flatMap((p) => p.spans)
      .reduce((n, s) => n + (s.what.tag === 'brushes' ? s.what.brushes.length : 0), 0)
  );

/**
 * From now on, records each animation frame's `stale` and live-preview state (`__sfhFzp`,
 * `__sfhSim`), so a state that shows only briefly is still seen.
 */
async function sampleFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as SimWin & {
      __sfhFzp?: SfhFzpDebug;
      __frames?: { stale: boolean; preview: string | null }[];
    };
    w.__frames = [];
    const tick = () => {
      w.__frames!.push({ stale: w.__sfhFzp!.stale, preview: w.__sfhSim?.preview ?? null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const frames = (page: Page) =>
  page.evaluate(
    () =>
      (window as Window & { __frames?: { stale: boolean; preview: string | null }[] }).__frames ??
      []
  );

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
}

// ---- the redirect and the shell -----------------------------------------------------------------

test('/fzp lands on /sim and the forecast fills', async ({ page }) => {
  await page.goto('/fzp');
  await expect(page).toHaveURL(/\/sim$/);
  await waitReady(page);
  expect(await fzp(page, 'phase')).toBe('ready');
  expect(await fzp(page, 'filledThrough')).toBe(await fzp(page, 'lastIndex'));
});

test('/sim opens on the Family Zoning Plan; the header score shows Results', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  const doc = await fzp(page, 'policy');
  expect(doc.kinds).toEqual({ zoning: [], permitting: [], money: [] });
  await expect(scoreBar(page)).toHaveText(/^[\d,]+ homes added by \d{4}$/);
  if (isMobile) {
    await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(scoreBar(page)).not.toHaveAttribute('aria-expanded');
    await expect(results(page)).toBeVisible();
  }
  const face = await openScore(page);
  await expect(face.getByText('What your policy added')).toBeVisible();
});

test('at 375 px the links wait in Menu; the score bar stays pinned', async ({ isMobile, page }) => {
  test.skip(!isMobile, 'the phone header');
  await gotoSim(page);
  await expect(scoreBar(page)).toBeVisible();
  const menu = menuButton(page);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  const menuPanel = page.locator(`[id="${await menu.getAttribute('aria-controls')}"]`);
  const items = [
    menuPanel.getByRole('link', { name: 'Paint', exact: true }),
    menuPanel.getByRole('link', { name: 'Simulate', exact: true })
  ];
  for (const item of items) await expect(item).toBeHidden();
  await openHeaderMenu(page);
  for (const item of items) await expect(item).toBeVisible();
  await expect(scoreBar(page)).toBeVisible();
});

test('below md the header score flips the sheet between Results and the editor', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone sheet; from md the score only shows Results');
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await expect(editor(page).getByRole('heading', { name: 'Transit rule' })).toBeVisible();
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');

  await scoreBar(page).click();
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(results(page)).toBeVisible();
  await expect(editor(page)).toHaveCount(0);

  await scoreBar(page).click();
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(results(page)).toHaveCount(0);
  await expect(editor(page).getByRole('heading', { name: 'Transit rule' })).toBeVisible();
});

test('from md Results show at rest; below md nothing opens', async ({ isMobile, page }) => {
  await gotoSim(page);
  if (isMobile) {
    await expect(inspectorBox(page)).toHaveCount(0);
  } else {
    await expect(results(page)).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
  }
});

test('from md the header score closes the editor and shows Results', async ({ isMobile, page }) => {
  test.skip(isMobile, 'below md the score toggles the sheet');
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await scoreBar(page).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(results(page)).toBeVisible();
  await expect
    .poll(() => results(page).evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);

  // Pressed again it still shows Results.
  await scoreBar(page).click();
  await expect(results(page)).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
});

test('from md the map keeps its box when a kind opens or a policy is selected', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the bottom pane is md+');
  await gotoSim(page);
  const m0 = await page.getByTestId('tl-map').boundingBox();
  await openKind(page, 'Zoning');
  await addPolicy(page, 'Zoning', 'Transit rule');
  expect(await page.getByTestId('tl-map').boundingBox()).toEqual(m0);
});

for (const width of [1280, 1024]) {
  test(`at ${width} px the detail column is at least 22rem and the pane 40% of the mode box`, async ({
    isMobile,
    page
  }) => {
    test.skip(isMobile, 'the bottom pane is md+');
    await page.setViewportSize({ width, height: 800 });
    await gotoSim(page);
    const insp = (await inspectorBox(page).boundingBox())!;
    expect(insp.width).toBeGreaterThanOrEqual(352 - 0.5);
    const dock = (await page.getByTestId('tl-dock').boundingBox())!;
    const mode = (await page.getByTestId('tl-mode').boundingBox())!;
    expect(Math.abs(dock.height - 0.4 * mode.height)).toBeLessThanOrEqual(2);
  });
}

test('the play control stays in view with every kind open', async ({ isMobile, page }) => {
  await gotoSim(page);
  const play = page.getByTestId('tl-play');
  if (isMobile) {
    await page.getByTestId('tl-mode').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const status = (await page.getByTestId('tl-status-line').boundingBox())!;
    await expect
      .poll(async () => (await play.boundingBox())!.y)
      .toBeGreaterThanOrEqual(status.y + status.height - 0.5);
  } else {
    await openKind(page, 'Zoning');
    await openKind(page, 'Permitting');
    await openKind(page, 'Public money');
    await addPolicy(page, 'Zoning', 'Transit rule');
    await addPolicy(page, 'Permitting', PRESET);
    const lanes = page.getByTestId('tl-lanes');
    await lanes.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect
      .poll(() => lanes.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
      .toBe(true);
    const box = (await lanes.boundingBox())!;
    const p = (await play.boundingBox())!;
    expect(p.y).toBeGreaterThanOrEqual(box.y - 0.5);
    expect(p.y + p.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    expect(p.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(p.x + p.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  expect(await topmostAtCentre(play)).toBe(true);
});

// ---- brushes ------------------------------------------------------------------------------------

test('a transit rule resolves its lots and refills the forecast', async ({ page }) => {
  await gotoSim(page);
  const before = await refillCount(page);
  await sampleFrames(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  const what = editor(page).getByRole('region', { name: 'What' });
  await expect(what).toContainText('Near regional rail and Muni Metro');
  await expect(what.getByRole('status').first()).toHaveText(/^[\d,]+ lots?$/);

  // The forecast goes stale, then refills from the edit and fills again.
  await waitRefilled(page, before);
  const seen = await frames(page);
  const stale = seen.findIndex((f) => f.stale);
  expect(stale, 'the forecast never went stale').toBeGreaterThanOrEqual(0);
  expect(seen.slice(stale + 1).some((f) => !f.stale)).toBe(true);
  // No building flash on a transit edit (sim-ux spec, Goal 2).
  expect(seen.every((f) => f.preview === 'none')).toBe(true);
});

test('the Updating status never moves the timeline or the editor', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop rule; phones scroll the page');
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await waitRefilled(page, 0);
  const before = await refillCount(page);
  const boxes = async () => ({
    editor: await inspectorBox(page).boundingBox(),
    dock: await page.getByTestId('tl-dock').boundingBox(),
    map: await page.getByTestId('tl-map').boundingBox()
  });
  const at = await boxes();
  // Each frame while the forecast is stale, the editor's, the timeline's and the map's boxes.
  await page.evaluate(() => {
    type Box = { x: number; y: number; width: number; height: number };
    const w = window as unknown as {
      __sfhFzp: SfhFzpDebug;
      __staleBoxes?: { editor: Box; dock: Box; map: Box }[];
    };
    const box = (selector: string): Box => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    w.__staleBoxes = [];
    const tick = () => {
      if (w.__sfhFzp.stale)
        w.__staleBoxes!.push({
          editor: box('[data-testid="tl-inspector"]'),
          dock: box('[data-testid="tl-dock"]'),
          map: box('[data-testid="tl-map"]')
        });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // A chip edit sends a revision: the status reads "Updating" until the refill passes.
  await editor(page)
    .getByRole('group', { name: 'Stop types' })
    .getByRole('button', { name: /^Muni Rapid bus/ })
    .click();
  await waitRefilled(page, before);
  const seen = await page.evaluate(
    () => (window as unknown as { __staleBoxes?: unknown[] }).__staleBoxes ?? []
  );
  expect(seen.length, 'the forecast never went stale').toBeGreaterThan(0);
  for (const s of seen) expect(s).toEqual(at);
  expect(await boxes()).toEqual(at);
});

test('a Paint stroke adds a painted area and Ctrl+Z removes it', async ({ isMobile, page }) => {
  await hideHeightLimits(page);
  await gotoSim(page);
  await startPainting(page, isMobile);
  await strokeOnce(page, isMobile);
  await expect.poll(() => paintedAreas(page)).toBe(1);
  if (!isMobile) {
    await expect(customList(page)).toHaveCount(1);
    await expect(customList(page).first()).toContainText(/\d+ stor/);
  }

  await page.keyboard.press('Control+z');
  await expect.poll(() => paintedAreas(page)).toBe(0);
  await expect(
    page.getByRole('banner').getByRole('button', { name: /^Redo: /, includeHidden: true })
  ).toBeEnabled();
});

test('a painted area is selected, outlined and removed', async ({ isMobile, page }) => {
  test.skip(isMobile, 'the painted policy editor and the map side by side are md+');
  const OUTLINE_LAYER = 'sim-painted-outline';
  await hideHeightLimits(page);
  await gotoSim(page);
  await startPainting(page, isMobile);
  // A painted area, not a drag, is what the row needs (as in the eraser test, #70).
  await stampOnce(page);
  await expect(customList(page)).toHaveCount(1);
  await tool(page, 'Move').click();

  // Selecting the row outlines its lots (Move is chosen: nothing else would).
  const row = customList(page).first().getByRole('button', { pressed: false });
  await row.first().click();
  await expect(customList(page).first().getByRole('button', { pressed: true })).toBeVisible();
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);

  // Remove is one change: the row and its outline go, and Undo brings the row back unselected.
  await editor(page)
    .getByRole('button', { name: /^Remove: / })
    .click();
  await expect(customList(page)).toHaveCount(0);
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
  await page
    .getByRole('banner')
    .getByRole('button', { name: /^Undo: Removed: / })
    .click();
  await expect(customList(page)).toHaveCount(1);
  await expect(customList(page).first().getByRole('button', { pressed: false })).toBeVisible();
  expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);
});

// ---- selecting on the map (sim-ux plan 4, Task 4; timeline-ui rule 19) ------------------------

/**
 * 3513001: a fixture-0 lot near the fixture's metro and rail stops, with no project on it (a tap
 * on a project opens its card, rule 19), whose limit a 20-story transit rule sets.
 */
const LOT_X: [number, number] = [-122.42013, 37.7596398];
/** 3512018: a lot with no project that paint can raise (an eligible lot). */
const LOT_PAINTED: [number, number] = [-122.4180813, 37.7604051];
/** About 45 m south of the fixture's row of lots, in the frame: no lot there. */
const NO_LOT: [number, number] = [-122.4187, 37.7597];

/** Centres the map on `at` and clicks (taps on the phone) there. */
async function clickMapAt(page: Page, isMobile: boolean, at: [number, number]): Promise<void> {
  await scrollToTop(page);
  await jumpAndIdle(page, { ...FRAME, center: at });
  const [x, y] = await projectToPage(page, at);
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Adds a transit rule at 20 stories (taller than FZP on the fixture's lots, so it sets their
 * limit), closes the editor so a click is what selects it again, and waits for the refill.
 */
async function addTallRule(page: Page): Promise<void> {
  const before = await refillCount(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  const inner = editor(page).getByRole('group', { name: 'Band 1' });
  for (let k = 0; k < 14; k++)
    await inner.getByRole('button', { name: 'More stories, band 1', exact: true }).click();
  await expect(inner).toContainText('20 stories');
  await closeEditor(page);
  await waitRefilled(page, before);
}

test('clicking a lot selects the transit rule that sets its limit', async ({ isMobile, page }) => {
  await gotoSim(page);
  await addTallRule(page);

  await clickMapAt(page, isMobile, LOT_X);
  await expect(editor(page).getByRole('heading', { name: 'Transit rule' })).toBeVisible();
  await expect(editor(page).getByRole('group', { name: 'Stop types' })).toBeVisible();
  // From md the Zoning kind opens, its bar pressed.
  if (!isMobile)
    await expect(
      page.getByRole('button', { name: /^Transit rule, /, pressed: true })
    ).toBeInViewport();
  // Focus stays off the editor.
  expect(await editor(page).evaluate((d) => d.contains(document.activeElement))).toBe(false);

  // A click on no lot clears the selection.
  await clickMapAt(page, isMobile, NO_LOT);
  await expect(editor(page)).toHaveCount(0);
});

test('a tap on a built lot with no project selects the plan that sets its limit', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'a touch tap; the desktop click never opened a building card');
  await gotoSim(page);
  // 3512014: fixture-0's 60 m, 40-unit building (map.spec E4 taps its card on the editor). FZP
  // allows it 65 stories, so FZP sets its limit.
  const lot: [number, number] = [-122.4179679, 37.7601348];
  await jumpAndIdle(page, { center: lot, zoom: 17, pitch: 0, bearing: 0 });
  const [x, y] = await projectToPage(page, lot);
  await page.touchscreen.tap(x, y);
  await expect(editor(page).getByRole('heading', { name: 'Current law' })).toBeVisible();
  // No project card: the building is today's, not a project's. (Cards are always on, rule 19, so
  // SimMap's own card for the existing building may show beside the selection.)
  await expect(page.getByTestId('tl-card').getByRole('region')).toHaveCount(0);
  await expect(page.getByTestId('map-root').getByRole('tooltip')).toHaveCount(0);
});

/** 3512011, the parcel only "100 Fixture St" (a pipeline project) holds, in the fixture's row. */
const PROJECT_LOT: [number, number] = [-122.4183084, 37.7601349];

test('a project card names the rule that allowed its lot', async ({ isMobile, page }) => {
  await gotoSim(page);
  await addTallRule(page);
  await scrollToTop(page);
  await jumpAndIdle(page, { ...FRAME, center: PROJECT_LOT });
  // The part drawn first: a miss selects the lot's plan (on a phone its sheet moves the map away).
  // The frame shows one chunk, 50_25.
  await waitTimelineDrawn(page, 1);
  const card = page.getByRole('region', { name: '100 Fixture St', exact: true });
  const [x, y] = await projectToPage(page, PROJECT_LOT);
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(card).toBeVisible();
  const line = card.getByTestId('card-allowed-by');
  await expect(line).toHaveText(/^Allowed by: Transit rule/);
  // It follows the size line.
  const order = await card.evaluate((c) => {
    const nodes = [...c.querySelectorAll('p')];
    const at = (re: RegExp) => nodes.findIndex((p) => re.test(p.textContent ?? ''));
    return [at(/stor(y|ies)/), at(/^Allowed by:/)];
  });
  expect(order[1]).toBe(order[0] + 1);

  // The card with the line has no axe violations, light and dark.
  await expectNoA11yViolations(page, { include: ['section[aria-labelledby]'] });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('background-color', 'rgb(28, 29, 31)');
  await expectNoA11yViolations(page, { include: ['section[aria-labelledby]'] });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
});

test('clicking inside a painted stroke selects its painted policy', async ({ isMobile, page }) => {
  await hideHeightLimits(page);
  await gotoSim(page);
  await startPainting(page, isMobile);
  // A stamp is a one-point stroke: its circle covers LOT_PAINTED.
  await stampOnce(page, LOT_PAINTED);
  await expect.poll(() => paintedAreas(page)).toBe(1);
  const before = await refillCount(page);
  if (isMobile) {
    await page.getByTestId('palette-strip').getByRole('button', { name: 'Done' }).click();
  } else {
    await tool(page, 'Move').click();
    await closeEditor(page);
  }
  await closeEditor(page);
  await waitRefilled(page, before);

  await clickMapAt(page, isMobile, LOT_PAINTED);
  await expect(editor(page).getByRole('heading', { name: 'Painted zoning' })).toBeVisible();
});

test('a category protection shows the protections line in Results', async ({ page }) => {
  await gotoSim(page);
  const before = await refillCount(page);
  await addPolicy(page, 'Zoning', 'Protect rent-controlled buildings');
  await waitRefilled(page, before);
  const face = await openScore(page);
  await expect(face).toContainText(
    /\d[\d,]* lots? protected: [\d,]+ fewer homes?\s+of zoned capacity/
  );
});

// ---- accessibility and layout -------------------------------------------------------------------

for (const [kind, choice] of [
  ['Zoning', 'Transit rule'],
  ['Zoning', 'Painted area'],
  ['Zoning', 'Protect historic buildings'],
  ['Public money', 'City funding scale']
] as const) {
  test(`axe: the editor open on ${choice}`, async ({ page }) => {
    await gotoSim(page);
    await addPolicy(page, kind, choice);
    await expectNoA11yViolations(page);
  });
}

test('the window has homes by tier and, with the baseline funding, public money', async ({
  page
}) => {
  await gotoSim(page);
  const face = await openScore(page);
  await expect(face.getByRole('heading', { name: /Who the homes are for/ })).toBeVisible();
  await expect(face.getByRole('heading', { name: /Public money/ })).toBeVisible();
  await expect(face.getByTestId('fzp-money-city')).toBeVisible();
});

test('at 375 px with Results open the playhead and the About entry stay unobscured', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoSim(page);
  await openScore(page);
  // Every playhead control is the topmost element at its centre.
  for (const testId of ['tl-pause', 'tl-play', 'tl-faster', 'tl-today']) {
    const control = page.getByTestId(testId);
    const hit = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(hit, `${testId} is covered`).toBe(true);
  }
  await expectNoHorizontalScroll(page);
  await expectNoFooter(page);
  await expectAboutReachable(page);
});

test('End, Play at the window end reads Replay, and Today returns to the present', async ({
  page
}) => {
  await gotoSim(page);
  const asOf = await fzp(page, 'asOf');
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(() => fzp(page, 'day')).toBeGreaterThan(asOf);
  await expect(page.getByTestId('tl-play-label')).toHaveText('Replay');
  expect(await fzp(page, 'playing')).toBe(false);

  // Replay starts again from the present.
  await page.getByTestId('tl-play').click();
  await expect.poll(() => fzp(page, 'playing')).toBe(true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => fzp(page, 'playing')).toBe(false);
  await page.getByTestId('tl-today').click();
  await expect.poll(() => fzp(page, 'day')).toBe(asOf);
  await expect(page.getByTestId('tl-play-label')).toHaveText('Play');
});

test('axe: Results', async ({ page }) => {
  await gotoSim(page);
  await openScore(page);
  await expectNoA11yViolations(page);
});

test("a transit rule's editor passes axe at a bound and with the plan's row", async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  // A bound reached: More on the outer band is aria-disabled at the inner band's height.
  const outer = editor(page).getByRole('group', { name: 'Band 2' });
  for (let k = 0; k < 2; k++)
    await outer.getByRole('button', { name: 'More stories, band 2', exact: true }).click();
  await expect(
    outer.getByRole('button', { name: 'More stories, band 2', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
  await expectNoA11yViolations(page);
  // The plan's row selected instead: its read-only view. (A phone's editor sheet closes first, so
  // the kind's sheet is not under it.)
  await closeEditor(page);
  await openKind(page, 'Zoning');
  const plan = page.getByRole('button', { name: 'Current law, whole window' });
  await plan.last().click();
  await expect(editor(page).getByRole('heading', { name: 'Current law' })).toBeVisible();
  await expect(editor(page).getByRole('group', { name: 'Stop types' })).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('rule edits are one undo step per run; the policy stays selected', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  const inner = editor(page).getByRole('group', { name: 'Band 1' });
  for (let k = 0; k < 3; k++)
    await inner.getByRole('button', { name: 'More stories, band 1', exact: true }).click();
  await expect(inner).toContainText('9 stories');
  const undo = await headerAction(page, /^Undo/);
  await expect(undo).toHaveAccessibleName(
    'Undo: Edited: Allowed up to 9 stories near regional rail and Muni Metro'
  );
  await undo.click();
  await expect(inner).toContainText('6 stories');
  await expect(editor(page).getByRole('heading', { name: 'Transit rule' })).toBeVisible();
  // The next undo takes back the rule itself.
  await expect(await headerAction(page, /^Undo/)).toHaveAccessibleName('Undo: Added: Transit rule');
});

/**
 * WCAG 2.2 2.4.11 (Focus Not Obscured): each button of the map's bottom-left navigation control
 * (zoom in, zoom out, compass) stays clear of `cover`, and, focused, is the topmost element at its
 * centre.
 */
async function expectNavControlClear(page: Page, cover: Locator): Promise<void> {
  const buttons = page.locator('.maplibregl-ctrl-bottom-left button');
  await expect(buttons).toHaveCount(3);
  const c = (await cover.boundingBox())!;
  for (const button of await buttons.all()) {
    await button.focus();
    const b = (await button.boundingBox())!;
    const name = await button.getAttribute('aria-label');
    const overlaps =
      b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height;
    expect(overlaps, `${name} at ${JSON.stringify(b)} overlaps ${JSON.stringify(c)}`).toBe(false);
    const topmost = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(topmost, `${name} is covered`).toBe(true);
  }
}

test('from md the editor is in the bottom pane, right of the timeline', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the bottom pane is md+; a coarse pointer has no control');
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  const insp = (await inspectorBox(page).boundingBox())!;
  const lanes = (await page.getByTestId('tl-lanes').boundingBox())!;
  const dock = (await page.getByTestId('tl-dock').boundingBox())!;
  expect(insp.x).toBeGreaterThanOrEqual(lanes.x + lanes.width - 0.5);
  expect(insp.x).toBeGreaterThanOrEqual(dock.x - 0.5);
  expect(insp.y).toBeGreaterThanOrEqual(dock.y - 0.5);
  expect(insp.x + insp.width).toBeLessThanOrEqual(dock.x + dock.width + 0.5);
  expect(insp.y + insp.height).toBeLessThanOrEqual(dock.y + dock.height + 0.5);
  const map = (await page.getByTestId('tl-map').boundingBox())!;
  expect(Math.abs(map.width - 1280)).toBeLessThanOrEqual(0.5);
  await expectNavControlClear(page, inspectorBox(page));
});

test('below md on a fine pointer the palette strip leaves the zoom control uncovered', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'a coarse pointer gets no navigation control');
  await page.setViewportSize({ width: 700, height: 800 });
  await gotoSim(page);
  await startPainting(page, true);
  await expect(page.getByTestId('palette-strip')).toBeVisible();
  await expectNavControlClear(page, page.getByTestId('palette-strip'));
});

test('at 375 px: no horizontal scroll, no footer, and the About entry stays unobscured', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoSim(page);
  await expectNoHorizontalScroll(page);
  await expectNoFooter(page);
  // Nothing sits under the timeline.
  const tlBottom = await page
    .getByTestId('tl-mode')
    .evaluate((el) => el.getBoundingClientRect().bottom - window.innerHeight);
  expect(Math.abs(tlBottom)).toBeLessThanOrEqual(1);

  // With Results open (the header score).
  await openScore(page);
  await expectNoHorizontalScroll(page);
  await expectNoFooter(page);
  await expectAboutReachable(page);
  await scoreBar(page).click();
  await expect(results(page)).toHaveCount(0);

  // With the palette strip showing (a stroke tool chosen).
  await startPainting(page, true);
  await expectNoHorizontalScroll(page);
  await expectNoFooter(page);
  // The strip sits at the viewport's bottom, under the timeline, never over the map: the map's
  // Reset view button (a coarse pointer's bottom-left control) stays clear and on top.
  await scrollToTop(page);
  const reset = page.locator('.sim-map-reset');
  await expect(reset).toBeVisible();
  const r = (await reset.boundingBox())!;
  const strip = (await page.getByTestId('palette-strip').boundingBox())!;
  expect(r.y + r.height, 'the strip covers Reset view').toBeLessThanOrEqual(strip.y);
  const topmost = await reset.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!top && el.contains(top);
  });
  expect(topmost, 'Reset view is covered').toBe(true);
});

// ---- permitting (plan 4) ------------------------------------------------------------------------

const PRESET = "Permits at San Diego's pace";
const timingLabel = (page: Page): Locator => editor(page).getByTestId('timing-label');
const routeTimeline = (page: Page, route: string): Locator =>
  editor(page).getByRole('group', { name: `${route} timeline` });

test('adding a preset refills the forecast and names the policy', async ({ page }) => {
  await gotoSim(page);
  const before = await refillCount(page);
  await addPolicy(page, 'Permitting', PRESET);
  await waitRefilled(page, before);
  await expect(editor(page).getByRole('heading', { name: PRESET })).toBeVisible();
  await expect(timingLabel(page)).toHaveText(PRESET);
});

test('a keyboard edit makes the set custom and Revert undoes it', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Permitting', PRESET);
  await expect(timingLabel(page)).toHaveText(PRESET);
  const timeline = routeTimeline(page, 'Discretionary');
  await timeline.getByRole('button').first().focus();
  for (let i = 0; i < 8; i++) {
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    if (name?.startsWith('Permit review,')) break;
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.locator(':focus')).toHaveAccessibleName(/^Permit review,/);
  await page.keyboard.press('Enter');
  let before = await refillCount(page);
  const shorten = editor(page).getByRole('button', { name: 'Shorten by 0.5 month' });
  for (let i = 0; i < 3; i++) await shorten.click();
  await expect(timingLabel(page)).toHaveText(`Custom (from ${PRESET})`);
  await waitRefilled(page, before);

  before = await refillCount(page);
  await editor(page)
    .getByRole('button', { name: `Revert to ${PRESET}` })
    .click();
  await expect(timingLabel(page)).toHaveText(PRESET);
  await waitRefilled(page, before);
});

test('the minimum is visible', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Permitting', PRESET);
  const timeline = routeTimeline(page, 'Discretionary');
  await timeline.getByRole('button', { name: /^Permit review,/ }).click();
  const months = editor(page).getByLabel('Typical months');
  await months.fill('0');
  await months.press('Tab');
  await expect(editor(page).getByText('At the minimum')).toBeVisible();
  await expect(
    timeline.getByRole('button', { name: /^Permit review,.*at the minimum/ })
  ).toBeVisible();
  const shown = Number(await months.inputValue());
  expect(shown).toBeGreaterThan(0);
});

test('route shares sum to 100', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Permitting', PRESET);
  const share = (name: string) => editor(page).getByLabel(`${name} share, %`);
  await share('Permit only').fill('100');
  await share('Permit only').press('Tab');
  await expect(share('Permit only')).toHaveValue('100');
  await expect(share('Discretionary')).toHaveValue('0');
  await expect(share('Streamlined')).toHaveValue('0');
});

test('axe: a permitting policy open, a stage open', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Permitting', PRESET);
  await routeTimeline(page, 'Discretionary').getByRole('button').nth(1).click();
  await expect(editor(page).getByLabel('Typical months')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('at 375 px with the timelines open: no horizontal scroll', async ({ isMobile, page }) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoSim(page);
  await addPolicy(page, 'Permitting', PRESET);
  await routeTimeline(page, 'Discretionary').getByRole('button').nth(1).click();
  await expect(editor(page).getByLabel('Typical months')).toBeVisible();
  await expectNoHorizontalScroll(page);
  const box = (await inspectorBox(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375);
});

// ---- map overlays (plan 2, Task 4; timeline-ui rule 18) -----------------------------------------

const LIMITS_LAYER = 'sim-height-limits';
const mapVisibility = (page: Page, id: string) =>
  page.evaluate(
    (l) => (window as Win).__sfhMap!.map!.getLayoutProperty(l, 'visibility') ?? 'visible',
    id
  );
const deckIds = (page: Page) =>
  page.evaluate(() => (window as Win).__sfhMap!.timelineSnapshot()?.layerIds ?? []);

test('the height limits show, transit capacity is off, and View is offered at any day', async ({
  page
}) => {
  await gotoSim(page);
  await expect.poll(() => deckIds(page)).toContain(LIMITS_LAYER);
  await expect.poll(() => mapVisibility(page, 'transit-access')).toBe('none');
  await expect(await headerAction(page, 'View')).toBeVisible();
  await page.keyboard.press('Escape'); // the Menu, below lg

  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(() => fzp(page, 'day')).toBeGreaterThan(await fzp(page, 'asOf'));
  await expect.poll(() => deckIds(page)).toContain(LIMITS_LAYER);
  await expect(await headerAction(page, 'View')).toBeVisible();
});

test('the Zoning height limits toggle removes the limits and survives a reload', async ({
  page
}) => {
  await gotoSim(page);
  await expect.poll(() => deckIds(page)).toContain(LIMITS_LAYER);
  await (await headerAction(page, 'View')).click();
  await page.getByRole('checkbox', { name: 'Zoning height limits' }).uncheck();
  await expect.poll(() => deckIds(page)).not.toContain(LIMITS_LAYER);
  await gotoSim(page);
  await (await headerAction(page, 'View')).click();
  await expect(page.getByRole('checkbox', { name: 'Zoning height limits' })).not.toBeChecked();
  expect(await deckIds(page)).not.toContain(LIMITS_LAYER);
});

/** The map canvas's pixels, as a PNG. */
const mapShot = (page: Page) => page.getByTestId('map-root').locator('canvas').first().screenshot();

test('zoomed in over the loaded lots, the glass lids draw: the toggle changes the map', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the desktop map is enough to see the lids');
  await gotoSim(page);
  await expect.poll(() => deckIds(page)).toContain(LIMITS_LAYER);
  // Past LIDS_FADE (contours gone), pitched over the fixture's lots.
  await jumpAndIdle(page, { ...FRAME, zoom: 17, pitch: 55 });
  // The lids answer comes after the moveend; wait until two frames agree.
  let on = await mapShot(page);
  await expect
    .poll(
      async () => {
        const next = await mapShot(page);
        const same = next.equals(on);
        on = next;
        return same;
      },
      { intervals: [500] }
    )
    .toBe(true);
  await (await headerAction(page, 'View')).click();
  await page.getByRole('checkbox', { name: 'Zoning height limits' }).uncheck();
  await expect.poll(() => deckIds(page)).not.toContain(LIMITS_LAYER);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await mapShot(page)).equals(on)).toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the open View menu on /sim has no axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoSim(page);
    await (await headerAction(page, 'View')).click();
    const group = page.getByRole('group', { name: 'Map layers' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('checkbox', { name: 'Zoning height limits' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['header'] });
  });
}

test('without transit: no transit.json request, no transit layers, View has only the height limits', async ({
  page
}) => {
  const transitAsked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/transit.json')) transitAsked.push(r.url());
  });
  // SSR reads the manifest server-side, so strip it where the intercept applies: the /sim load
  // re-runs in the browser on client navigation (as e2e/transit.spec.ts does for /).
  await page.route('**/data/fixture-0/manifest.json', async (route) => {
    const res = await route.fetch();
    const manifest = (await res.json()) as Record<string, unknown>;
    delete manifest.transit;
    await route.fulfill({ response: res, json: manifest });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(async () => {
    // A try that fell back to a full /sim load (the link clicked before hydration) asked for
    // transit.json through SSR's manifest: only the try that passes counts.
    transitAsked.length = 0;
    await page.goto('/attribution');
    await page.evaluate(() => ((window as Window & { __spa?: boolean }).__spa = true));
    await openHeaderMenu(page);
    await page.getByRole('banner').getByRole('link', { name: 'Simulate', exact: true }).click();
    await waitReady(page);
    expect(await page.evaluate(() => (window as Window & { __spa?: boolean }).__spa)).toBe(true);
  }).toPass();
  await expect.poll(() => deckIds(page)).toContain(LIMITS_LAYER);
  const transitLayers = await page.evaluate(() =>
    (window as Win)
      .__sfhMap!.map!.getStyle()
      .layers.map((l) => l.id)
      .filter((id) => id.startsWith('transit'))
  );
  expect(transitLayers).toEqual([]);
  expect(transitAsked).toEqual([]);
  await (await headerAction(page, 'View')).click();
  const group = page.getByRole('group', { name: 'Map layers' });
  await expect(group.getByRole('checkbox')).toHaveCount(1);
  await expect(group.getByRole('checkbox', { name: 'Zoning height limits' })).toBeChecked();
});

/** The visible header items, left to right, with their boxes. */
async function headerRow(page: Page): Promise<{ name: string; left: number; right: number }[]> {
  return page.evaluate(() => {
    const banner = document.querySelector('header')!;
    const items = [
      ...banner.querySelectorAll<HTMLElement>('a, button, [data-header-status] > *')
    ].filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0);
    // Only the outermost of nested items (the save state's wrapper, not its chip as well).
    return items
      .filter((el) => !items.some((o) => o !== el && o.contains(el)))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: (el.textContent ?? '').trim(), left: r.left, right: r.right };
      })
      .sort((a, b) => a.left - b.left);
  });
}

async function expectHeaderFits(page: Page): Promise<number> {
  await expectNoHorizontalScroll(page);
  const banner = page.getByRole('banner');
  const fit = await banner.evaluate((b) => ({ scroll: b.scrollWidth, client: b.clientWidth }));
  expect(fit.scroll, 'the header overflows').toBeLessThanOrEqual(fit.client);
  const row = await headerRow(page);
  for (let i = 1; i < row.length; i++)
    expect(row[i].left, `"${row[i].name}" overlaps "${row[i - 1].name}"`).toBeGreaterThanOrEqual(
      row[i - 1].right - 0.5
    );
  const score = (await scoreBar(page).boundingBox())!;
  return score.x + score.width / 2;
}

/**
 * The widest header strings the page can show: the "Autosave off" chip, a five-digit score and
 * its widest delta.
 * The score's count is the button's first text; its "added" span (visually hidden below lg) and
 * "by {year}" stay.
 */
async function widestHeaderText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const chip = document.querySelector('[data-header-status]');
    if (chip) {
      const w = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode())
        if (n.textContent?.trim() === 'Saved') {
          n.textContent = 'Autosave off';
          break;
        }
    }
    // The delta's visible text; its sr-only " by {year}" stays.
    const delta = document.querySelector('[data-testid="score-delta"]');
    for (const n of delta?.childNodes ?? [])
      if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        n.textContent = '\u221212,345 from your policy';
        break;
      }
    const score = document.querySelector('[data-testid="score-bar"]');
    if (!score) return;
    for (const n of score.childNodes)
      if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        n.textContent = '12,345 homes ';
        break;
      }
  });
}

/**
 * Where the status shows (rule 32): from 2xl (1536 px) in the header's slot, beside the save
 * state; below it on a line just under the header bar. Either way one live region speaks it, and
 * it is never among the buttons.
 */
async function expectStatusPlace(page: Page, width: number): Promise<void> {
  const inHeader = width >= 1536;
  const slot = page.getByTestId('tl-status');
  const line = page.getByTestId('tl-status-line');
  await expect(inHeader ? slot : line).toBeVisible();
  await expect(inHeader ? line : slot).toBeHidden();
  await expect(page.getByTestId('tl-status-live')).toHaveCount(1);
  await expect(page.getByTestId('tl-status-live')).toHaveAttribute('role', 'status');
  if (!inHeader) {
    const header = (await page.getByRole('banner').boundingBox())!;
    const box = (await line.boundingBox())!;
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(24);
    await expect(line.getByRole('button')).toHaveCount(0);
  }
}

/** The shown status copy at its widest ("Forecast filled to 2088"), in both places. */
async function widestStatusText(page: Page): Promise<void> {
  await page.evaluate((text) => {
    for (const id of ['tl-status', 'tl-status-line']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const shown = el?.querySelector(':scope > span[aria-hidden="true"]:last-child');
      if (shown) shown.textContent = text;
    }
  }, forecastFilled(2088));
}

for (const width of [1024, 1280, 1536]) {
  test(`at ${width} px the header fits with the widest strings, before and after an edit, the score stays put and the status shows in its place`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1024 });
    await gotoSim(page);
    await expect(page.getByRole('banner').getByRole('button', { name: 'View' })).toBeVisible();
    await widestHeaderText(page);
    await widestStatusText(page);
    await expect(scoreBar(page)).toHaveAccessibleName(/^12,345 homes added by \d{4}$/);
    await expectStatusPlace(page, width);
    const before = await expectHeaderFits(page);
    await expectNoA11yViolations(page, {
      include: ['header', '[data-testid=tl-status-line]', '[data-testid=tl-status-live]']
    });
    const n = await refillCount(page);
    await addPolicy(page, 'Zoning', 'Transit rule');
    await waitRefilled(page, n);
    await widestHeaderText(page);
    await widestStatusText(page);
    await expectStatusPlace(page, width);
    const after = await expectHeaderFits(page);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });
}

test('at 1280 px Keyboard shortcuts opens under its button, moves nothing in the header and closes on Escape', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'chromium project only');
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoSim(page);
  const banner = page.getByRole('banner');
  const button = banner.getByRole('button', { name: 'Keyboard shortcuts' });
  const undo = banner.getByRole('button', { name: /^Undo/ });
  await expect(button).toBeVisible();
  const before = await headerRow(page);
  const scoreY = (await scoreBar(page).boundingBox())!.y;
  const undoY = (await undo.boundingBox())!.y;
  await button.click();
  const table = page.getByRole('table', { name: 'Keyboard shortcuts' });
  await expect(table).toBeVisible();
  const buttonBox = (await button.boundingBox())!;
  const listBox = (await page.getByTestId('shortcuts').boundingBox())!;
  expect(listBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
  const after = await headerRow(page);
  expect(after.map((i) => i.left)).toEqual(before.map((i) => expect.closeTo(i.left, 0)));
  expect((await scoreBar(page).boundingBox())!.y).toBeCloseTo(scoreY, 0);
  expect((await undo.boundingBox())!.y).toBeCloseTo(undoY, 0);
  expect((await banner.boundingBox())!.height).toBe(48);
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(table).toBeHidden();
});

for (const width of [768]) {
  test(`at ${width} px the header is the Menu layout: it fits, and every action and mode link is in the Menu`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1024 });
    await gotoSim(page);
    const banner = page.getByRole('banner');
    const menu = banner.getByRole('button', { name: 'Menu', exact: true });
    await expect(menu).toBeVisible();
    // Closed: the site name, status, score and Menu button only; no action or mode link shows.
    await expect(banner.getByRole('button', { name: 'View', exact: true })).toHaveCount(0);
    await expect(banner.getByRole('link', { name: 'Fewer cars' })).toHaveCount(0);
    await expectHeaderFits(page);
    await openHeaderMenu(page);
    for (const name of ['View', /^(Publish|Share link)/])
      await expect(
        banner.getByRole('button', { name, exact: typeof name === 'string' })
      ).toBeVisible();
    for (const name of ['Paint', 'Simulate'])
      await expect(banner.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Fewer cars' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await menu.click();
    await expectHeaderFits(page);
  });
}

// ---- outlines of painted lots while erasing (plan 2, Task 5) ---------------------------------------

test('the eraser outlines painted lots, only while chosen', async ({ isMobile, page }) => {
  test.skip(isMobile, 'the painted policy editor and the map side by side are md+');
  const OUTLINE_LAYER = 'sim-painted-outline';
  await gotoSim(page);
  await startPainting(page, isMobile);
  await stampOnce(page);
  await expect(customList(page)).toHaveCount(1);
  expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);

  await tool(page, 'Erase').click();
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);

  await tool(page, 'Move').click();
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
});

// ---- live preview while painting (sim-ux plan 3, Task 4) ---------------------------------------

const isPreviewLayer = (ids: string[]) => ids.some((id) => id.startsWith('sim-feedback-'));

/**
 * Starts a drag across fixture-0's parcel row and holds it mid-stroke (a mouse on desktop, one
 * finger on the phone): down, then two moves. Returns the release.
 */
async function holdDrag(page: Page, isMobile: boolean): Promise<() => Promise<void>> {
  const [x0, y0] = await projectToPage(page, isMobile ? TOUCH_FROM : FROM);
  const [x1, y1] = await projectToPage(page, isMobile ? TOUCH_TO : TO);
  const mid: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove', [x, y]: [number, number]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x, y, id: 1 }] });
    await touch('touchStart', [x0, y0]);
    await touch('touchMove', mid);
    await touch('touchMove', [x1, y1]);
    return async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
  }
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(...mid);
  await page.mouse.move(x1, y1);
  return () => page.mouse.up();
}

test('a Paint drag shows live buildings under the brush, fading on release', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  // gotoSim emulates reduced motion, under which a release clears at once: the fade needs it off.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await startPainting(page, isMobile);
  await jumpAndIdle(page);
  expect(await simPreview(page)).toBe('none');

  const release = await holdDrag(page, isMobile);
  await expect.poll(() => simPreview(page)).toBe('live');
  expect(isPreviewLayer(await deckIds(page))).toBe(true);
  await release();

  await expect.poll(() => simPreview(page)).toBe('fading');
  await expect.poll(() => simPreview(page)).toBe('none');
  expect(isPreviewLayer(await deckIds(page))).toBe(false);
  await expect.poll(() => paintedAreas(page)).toBe(1);
});

test('an Erase drag shows no buildings', async ({ isMobile, page }) => {
  await gotoSim(page);
  await startPainting(page, isMobile);
  await strokeOnce(page, isMobile);
  await expect.poll(() => paintedAreas(page)).toBe(1);
  await expect.poll(() => simPreview(page)).toBe('none');
  // Sample the preview each frame through an Erase stroke and after it.
  if (isMobile)
    await page.getByTestId('palette-strip').getByRole('button', { name: 'Tool: Paint' }).click();
  else await tool(page, 'Erase').click();
  await sampleFrames(page);
  await strokeOnce(page, isMobile);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const seen = await frames(page);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((s) => s.preview === 'none')).toBe(true);
  expect(isPreviewLayer(await deckIds(page))).toBe(false);
});

test('hovering a building shows its allowed and buildable stories', async ({ isMobile, page }) => {
  // Hover tooltips need a mouse; the phone's tap card carries the same text.
  test.skip(isMobile, 'chromium project only');
  await gotoSim(page);
  // 3512014: fixture-0's 60 m, 40-unit building (map.spec E3 hovers it on the editor)
  const lot: [number, number] = [-122.4179679, 37.7601348];
  await jumpAndIdle(page, { center: lot, zoom: 16, pitch: 0, bearing: 0 });
  const [x, y] = await projectToPage(page, lot);
  await page.mouse.move(x, y, { steps: 5 });
  const tip = page.getByTestId('map-root').getByRole('tooltip');
  await expect(tip).toContainText('Parcel 3512014');
  await expect(tip).toContainText(/Allowed: \d+( · (Buildable here: \d+|Protected))?/);
});
