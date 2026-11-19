// `/` and `/p/:id` layout (WCAG 2.4.11 Focus Not Obscured), on the dock (sim-ux plan 5): below
// 768 px the dock's sheet handle sits on #map-region's bottom (the score is in the header, so no bar
// sits under it); the full-height routes have no footer, and the header's About entry stays
// visible, unobscured and tappable; the map's inset follows the sheet, which the header score
// opens on Results; the brush status is a pill under the header; the palette strip leaves the map
// controls uncovered.
// From 768 px the dock is a panel on the left of the map.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { MSG } from '../src/lib/brush/messages';
import { COPY } from '../src/lib/sharing/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable, expectNoFooter, expectPhoneHeaderFits } from './helpers/chrome';
import {
  PLAN_KEY,
  TOUCH_FROM,
  TOUCH_TO,
  chooseTool,
  gotoEditor,
  headerScore,
  jumpAndIdle,
  openHeaderMenu,
  ops,
  projectToPage,
  resultsFace,
  smallText,
  touchDrag,
  waitForMap,
  type Win
} from './helpers/sharing';

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const fmt = (b: Box): string =>
  `[${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}]`;

const notice = (page: Page): Locator => page.getByTestId('notice');
const statusLine = (page: Page): Locator => page.getByTestId('brush-status');
const handle = (page: Page): Locator => page.getByTestId('dock-handle');
const dockSheet = (page: Page): Locator => page.locator('.sfh-dock-sheet');
const strip = (page: Page): Locator => page.getByTestId('palette-strip');

/** Paint at the default city zoom: the brush is too small to see, so the zoom hint shows. */
async function showZoomHint(page: Page): Promise<void> {
  await chooseTool(page, 'Paint');
  await expect(statusLine(page)).toHaveText(MSG.zoomIn);
}

/** The status pill (the status region itself is `display: contents`). */
const statusPill = (page: Page): Locator => statusLine(page).locator(':scope > span');

/**
 * Seeds an unparsable autosave before the first load, so restore shows N1 (as
 * e2e/share-notices.spec.ts seeds N3). A sessionStorage flag keeps a reload from re-seeding.
 */
async function seedCorruptAutosave(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('sfh-e2e-seeded')) return;
    sessionStorage.setItem('sfh-e2e-seeded', '1');
    localStorage.setItem(key, '{not json');
  }, PLAN_KEY);
}

/** `/` with N1 showing. */
async function gotoEditorWithN1(page: Page): Promise<void> {
  await seedCorruptAutosave(page);
  await gotoEditor(page);
  await expect(notice(page).filter({ hasText: COPY.n1 })).toBeVisible();
}

/** No box in `a` intersects any box in `b`. */
async function expectApart(a: [string, Locator][], b: [string, Locator][]): Promise<void> {
  const overlaps: string[] = [];
  for (const [an, al] of a) {
    for (let i = 0; i < (await al.count()); i++) {
      const ab = await box(al.nth(i));
      for (const [bn, bl] of b) {
        for (let j = 0; j < (await bl.count()); j++) {
          const bb = await box(bl.nth(j));
          if (intersects(ab, bb)) overlaps.push(`${an} ${fmt(ab)} overlaps ${bn} ${fmt(bb)}`);
        }
      }
    }
  }
  expect(overlaps, overlaps.join('\n')).toEqual([]);
}

/** Map-view's attribution control (compact below 640 px, a text strip from 640 px). */
const attribution = (page: Page): Locator => page.locator('.maplibregl-ctrl-attrib');

/** The footprint vars have caught up with the bottom-right control container's current box. */
async function expectFootprintSettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('[data-testid=map-root]')!.getBoundingClientRect();
        const c = document.querySelector('.maplibregl-ctrl-bottom-right')!.getBoundingClientRect();
        const v = getComputedStyle(document.documentElement);
        return (
          v.getPropertyValue('--map-controls-br-inline-size') ===
            `${Math.ceil(root.right - c.left)}px` &&
          v.getPropertyValue('--map-controls-br-block-size') ===
            `${Math.ceil(root.bottom - c.top)}px`
        );
      })
    )
    .toBe(true);
}

/**
 * Below 640 px: puts the compact attribution in the given state with its (i) toggle (MapLibre
 * starts it expanded), then waits for the footprint vars to follow.
 */
async function setAttribution(page: Page, expanded: boolean): Promise<void> {
  const a = page.locator('.maplibregl-ctrl-attrib.maplibregl-compact');
  const shown = /maplibregl-compact-show/.test((await a.getAttribute('class')) ?? '');
  if (shown !== expanded) await a.locator('.maplibregl-ctrl-attrib-button').tap();
  if (expanded) await expect(a).toHaveClass(/maplibregl-compact-show/);
  else await expect(a).not.toHaveClass(/maplibregl-compact-show/);
  await expectFootprintSettled(page);
}

/** The element painted at the centre of `loc`'s box is `loc` itself or one of its descendants. */
async function expectUnobscured(loc: Locator): Promise<void> {
  const hit = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      ok: !!top && el.contains(top),
      top: top ? `${top.tagName}.${top.className}` : 'null'
    };
  });
  expect(hit.ok, `covered by ${hit.top}`).toBe(true);
}

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** `inner`'s box lies inside `outer`'s (half a pixel of rounding slack). */
async function expectInside(inner: Locator, outer: Locator): Promise<void> {
  const i = await box(inner);
  const o = await box(outer);
  expect(i.x).toBeGreaterThanOrEqual(o.x - 0.5);
  expect(i.y).toBeGreaterThanOrEqual(o.y - 0.5);
  expect(i.x + i.width).toBeLessThanOrEqual(o.x + o.width + 0.5);
  expect(i.y + i.height).toBeLessThanOrEqual(o.y + o.height + 0.5);
}

const paddingBottom = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Win).__sfhMap!.map!.getPadding().bottom ?? 0);

/**
 * The handle visible on the region's bottom, no footer; the map's inset follows the dock
 * sheet, opened by its handle and on Results by the header score; the sheet stays inside the region.
 * The header's About entry is reachable over the folded sheet (opening the Menu folds the sheet,
 * so the two never show together).
 */
async function checkMobile(page: Page): Promise<void> {
  const region = page.locator('#map-region');
  await expect(handle(page)).toBeVisible();
  await expectUnobscured(handle(page));
  await expectInside(dockSheet(page), region);
  await expect(page.locator('.sfh-scoreboard')).toHaveCount(0);
  // The closed sheet (its handle) sits on the region's bottom: nothing under it.
  const r = await box(region);
  const ds = await box(dockSheet(page));
  expect(Math.abs(ds.y + ds.height - (r.y + r.height))).toBeLessThanOrEqual(1);
  await expectNoFooter(page);
  await expectAboutReachable(page);
  // Containing blocks: the sheet resolves against the map box in BrushEditor's frame, which fills
  // the region; the map canvas ends at the region's bottom.
  const cb = await page.evaluate(() => {
    const rg = document.getElementById('map-region')!;
    const frame = rg.querySelector<HTMLElement>('.brush-editor')!;
    const sheet = rg.querySelector<HTMLElement>('.sfh-dock-sheet')!;
    const canvas = (window as Win).__sfhMap!.map!.getCanvas().getBoundingClientRect();
    const r = rg.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return {
      sheetInFrame: frame.contains(sheet.offsetParent),
      frameFills: Math.abs(f.top - r.top) < 1 && Math.abs(f.bottom - r.bottom) < 1,
      canvasBottom: Math.abs(canvas.bottom - r.bottom) < 1
    };
  });
  expect(cb).toEqual({ sheetInFrame: true, frameFills: true, canvasBottom: true });
  // setBottomInset: the handle, in map-container pixels.
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(ds.height));

  // The dock's sheet open: inside the region, the inset its height.
  await handle(page).tap();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
  await expectInside(dockSheet(page), region);
  await expectNoFooter(page);
  const openH = await dockSheet(page).evaluate((el) => el.getBoundingClientRect().height);
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(openH));
  await handle(page).tap();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(ds.height));

  // The header score opens the sheet on Results: inside the region, the inset its height;
  // pressing the score again flips to the editing face, the handle folds it.
  await headerScore(page).tap();
  await expect(resultsFace(page)).toBeVisible();
  await expectInside(dockSheet(page), region);
  await expectNoFooter(page);
  const resultsH = await dockSheet(page).evaluate((el) => el.getBoundingClientRect().height);
  // The peek height is 40dvh, so the inset may be fractional.
  await expect.poll(() => paddingBottom(page)).toBeCloseTo(resultsH, 0);
  await headerScore(page).tap();
  await expect(resultsFace(page)).toHaveCount(0);
  await handle(page).tap();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(ds.height));
}

test.describe('mobile', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  test('/: no footer; the About entry stays visible, unobscured and tappable over the handle and sheet', async ({
    page
  }) => {
    await gotoEditor(page);
    await checkMobile(page);

    await openHeaderMenu(page);
    await page.getByRole('banner').getByRole('link', { name: 'About', exact: true }).tap();
    await expect(page).toHaveURL(/\/about$/);
    await page.goBack();
    await waitForMap(page);
    await expectNoFooter(page);
  });

  test('/p/:id: no footer; the About entry stays visible, unobscured and tappable', async ({
    page,
    request
  }) => {
    const res = await request.post('/api/plans', {
      data: smallText,
      headers: { 'content-type': 'application/json' }
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/p/${id}`);
    await waitForMap(page);
    await checkMobile(page);
  });

  test('/p/:id at 375 px: the header fits in 48 px and the site name waits in the Menu', async ({
    page,
    request
  }) => {
    const res = await request.post('/api/plans', {
      data: smallText,
      headers: { 'content-type': 'application/json' }
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/p/${id}`);
    await waitForMap(page);
    await expect(headerScore(page)).toBeVisible();
    await expectPhoneHeaderFits(page);
  });

  test('/: a status message is a pill under the header, clear of the strip and the map controls', async ({
    page
  }) => {
    await gotoEditor(page);
    await setAttribution(page, false);
    await showZoomHint(page);
    const pill = statusPill(page);
    await expect(pill).toBeVisible();
    const header = await box(page.locator('header').first());
    expect((await box(pill)).y).toBeGreaterThanOrEqual(header.y + header.height);
    await expect(pill).toBeInViewport({ ratio: 1 });
    await expectApart(
      [['status pill', pill]],
      [
        ['palette strip', strip(page)],
        ['dock handle', handle(page)],
        ['attribution', attribution(page)]
      ]
    );
  });

  test("375 px: a stroke's chip overlays the map: the map region keeps its height, the strip stays clear", async ({
    page
  }) => {
    await gotoEditor(page);
    await setAttribution(page, false);
    await jumpAndIdle(page);
    await chooseTool(page, 'Paint');
    // The strip and the folded sheet are in place: project after the layout settles.
    await jumpAndIdle(page);
    await expect(statusLine(page)).toHaveText('');
    const mapRoot = page.getByTestId('map-root');
    const heightBefore = (await box(mapRoot)).height;
    const chip = page.getByTestId('stroke-chip');
    await expect(chip).toHaveCount(0);

    const cdp = await page.context().newCDPSession(page);
    await touchDrag(
      cdp,
      await projectToPage(page, TOUCH_FROM),
      await projectToPage(page, TOUCH_TO)
    );
    await expect.poll(() => ops(page)).toBe(1);
    await expect(chip).toHaveText(/^6 stories on \d+ lots/);
    expect((await box(mapRoot)).height).toBe(heightBefore);
    await expectInside(chip, mapRoot);
    await expectApart(
      [['stroke chip', chip]],
      [
        ['palette strip', strip(page)],
        ['dock handle', handle(page)],
        ['attribution', attribution(page)]
      ]
    );
    // The chip takes no presses: what is under its centre is the map's canvas, and a stroke that
    // starts there paints.
    const c = await chip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return { x, y, hit: document.elementFromPoint(x, y)?.className ?? '' };
    });
    expect(c.hit).toContain('maplibregl-canvas');
    await touchDrag(cdp, [c.x, c.y], [c.x + 40, c.y + 40]);
    await expect.poll(() => ops(page)).toBe(2);
  });

  test('/: the failed phase shows its Retry pill, unobscured', async ({ page }) => {
    // The sim worker never loads: the client reports a crash and the brush enters `failed`.
    await page.route('**/workers/worker-*.js', (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto('/');
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000
    });
    await expect(statusLine(page)).toHaveText(new RegExp(`^${MSG.cityFailed}`));
    const retry = statusLine(page).getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await expect(retry).toBeInViewport({ ratio: 1 });
    await expectUnobscured(retry);
    await retry.tap({ trial: true });
  });

  test('/: the palette strip and its pop-overs stay in the region, on top, clear of the attribution button', async ({
    page
  }) => {
    await gotoEditor(page);
    await setAttribution(page, false);
    await chooseTool(page, 'Paint');
    const region = page.locator('#map-region');
    await expectInside(strip(page), region);
    await expectUnobscured(strip(page).getByRole('button', { name: 'Done' }));
    await expectApart([['palette strip', strip(page)]], [['attribution', attribution(page)]]);
    await expectUnobscured(page.locator('.maplibregl-ctrl-attrib-button'));
    // Map-view's Reset view button (coarse pointers, the map's bottom left) is lifted above it.
    const reset = page.getByRole('button', { name: 'Reset view' });
    await expectApart([['palette strip', strip(page)]], [['Reset view', reset]]);
    await expectUnobscured(reset);
    // The strip sits above the folded sheet's handle.
    expect((await box(strip(page))).y + (await box(strip(page))).height).toBeLessThanOrEqual(
      (await box(handle(page))).y
    );
    for (const name of [/^Height: /, /^Brush \d+ m$/]) {
      const opener = strip(page).getByRole('button', { name });
      await opener.tap();
      const pop = page.locator(`[id="${await opener.getAttribute('aria-controls')}"]`);
      await expect(pop).toBeVisible();
      await expectInside(pop, region);
      await expectUnobscured(pop);
      expect(await pop.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
    }
  });
});

test.describe('desktop', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'chromium project only');

  test("/: Escape on the header score closes the goal's name and leaves the dock open", async ({
    page
  }) => {
    await gotoEditor(page);
    await expect(page.locator('.sfh-dock-panel')).toBeVisible();
    await headerScore(page).focus();
    const tip = page.getByRole('banner').getByRole('tooltip');
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(headerScore(page)).toBeFocused();
    await expect(page.locator('.sfh-dock-panel')).toBeVisible();
    await expect(page.getByTestId('dock-rail')).toHaveCount(0);
  });

  test('/: About entry in the header, nothing under the map, the dock on the left, the score in the header', async ({
    page
  }) => {
    await gotoEditor(page);
    await expectNoFooter(page);
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'About', exact: true })
    ).toBeVisible();
    await expectAboutReachable(page);
    const region = await box(page.locator('#map-region'));
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(Math.abs(region.y + region.height - innerHeight)).toBeLessThanOrEqual(1);
    const dock = await box(page.locator('.sfh-dock-panel'));
    expect(dock.x - region.x).toBeCloseTo(0, 0);
    expect(dock.y - region.y).toBeCloseTo(0, 0);
    expect(dock.width).toBeCloseTo(320, 0);
    expect(region.y + region.height - (dock.y + dock.height)).toBeCloseTo(0, 0);
    await expect(page.locator('.sfh-scoreboard')).toHaveCount(0);
    await expect(headerScore(page)).toBeVisible();
    await expect(handle(page)).toHaveCount(0);
    // The map's navigation control moves right of the dock.
    const nav = await box(page.locator('.maplibregl-ctrl-bottom-left'));
    expect(nav.x).toBeGreaterThanOrEqual(dock.x + dock.width - 0.5);
  });
});

// 768–1023 px: the dock hangs from the top on the left and scrolls inside when its content is taller
// than the map.
test.describe('medium width', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'chromium project only');

  test('1280x720: Shortcuts is on screen with the Paint tab open at rest', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoEditor(page);
    const shortcuts = page.getByTestId('dock').getByRole('button', { name: 'Keyboard shortcuts' });
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts).toBeInViewport({ ratio: 1 });
  });

  for (const width of [800, 1023]) {
    test(`${width} px: opening Keyboard shortcuts leaves the dock as it was, and a short window scrolls the dock inside`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoEditor(page);
      const panel = page.locator('.sfh-dock-panel');
      const h = await panel.evaluate((el) => el.scrollHeight);
      // The button is the last control in the Paint tab.
      const shortcuts = panel.getByRole('button', { name: 'Keyboard shortcuts' });
      await expect(panel.locator('button, input').last()).toHaveAccessibleName(
        'Keyboard shortcuts'
      );
      await shortcuts.click();
      await expect(page.getByRole('table', { name: 'Keyboard shortcuts' })).toBeVisible();
      expect(await panel.evaluate((el) => el.scrollHeight)).toBe(h);
      await page.keyboard.press('Escape');
      await expect(shortcuts).toHaveAttribute('aria-expanded', 'false');

      // A window half the content's height: the content is taller than the region. The panel
      // fills the region, so its own height can exceed the content's: sum its children instead.
      const content = await panel.evaluate((el) =>
        [...el.children].reduce((s, c) => s + c.getBoundingClientRect().height, 0)
      );
      const top = (await box(panel)).y;
      await page.setViewportSize({ width, height: Math.floor(top + content / 2) });
      await expectInside(panel, page.locator('#map-region'));
      const scroll = await panel.evaluate((el) => ({
        overflows: el.scrollHeight > el.clientHeight,
        overflowY: getComputedStyle(el).overflowY
      }));
      expect(scroll).toEqual({ overflows: true, overflowY: 'auto' });

      // The last control scrolls into view inside the panel and is reachable.
      const controls = panel.locator('button, input');
      const last = controls.nth((await controls.count()) - 1);
      await last.scrollIntoViewIfNeeded();
      await expectInside(last, panel);
      await expect(last).toBeInViewport({ ratio: 1 });
      await expectUnobscured(last);
      await last.click({ trial: true });
    });
  }

  // From md to lg the dock is the desktop panel, but the header is the Menu layout: the Paint
  // button that folds the dock waits in the Menu with the other actions.
  const open: Record<'/' | '/p/:id', (page: Page, request: APIRequestContext) => Promise<void>> = {
    '/': (page) => gotoEditor(page),
    '/p/:id': async (page, request) => {
      const res = await request.post('/api/plans', {
        data: smallText,
        headers: { 'content-type': 'application/json' }
      });
      expect(res.ok()).toBe(true);
      const { id } = (await res.json()) as { id: string };
      await page.goto(`/p/${id}`);
      await waitForMap(page);
    }
  };
  for (const path of ['/', '/p/:id'] as const) {
    test(`768 px on ${path}: the header is the Menu layout; the dock folds by its own button`, async ({
      page,
      request
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await open[path](page, request);
      const banner = page.getByRole('banner');
      const menu = banner.getByRole('button', { name: 'Menu', exact: true });
      const paint = banner.getByRole('button', { name: 'Paint', exact: true });
      await expect(menu).toBeVisible();
      await expect(headerScore(page)).toBeVisible();
      await expect(paint).toHaveCount(0);
      await expect(banner.getByRole('link', { name: 'Fewer cars' })).toHaveCount(0);
      const fit = await banner.evaluate((b) => b.scrollWidth <= b.clientWidth);
      expect(fit, 'the header overflows').toBe(true);
      await expect(page.locator('.sfh-dock-panel')).toBeVisible();

      // The Menu holds the two step links and no Paint button.
      await openHeaderMenu(page);
      for (const name of ['Paint', 'Simulate'])
        await expect(banner.getByRole('link', { name, exact: true })).toBeVisible();
      await expect(paint).toHaveCount(0);
      await expect(banner.getByRole('link', { name: 'Fewer cars' })).toHaveCount(0);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Collapse Paint' }).click();
      await expect(page.locator('.sfh-dock-panel')).toHaveCount(0);
      await expect(page.getByTestId('dock-rail')).toBeVisible();
      await expect(paint).toHaveCount(0);
      await expect(banner.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
    });
  }
});

// A landscape phone: below 768 px, so the narrow layout (the sheet handle, the score in the header)
// on a short map region; from 640 px the attribution is a full-width text strip above the handle.
test.describe('landscape phone 667×375', () => {
  // By project name: this describe's own test.use sets isMobile in both projects.
  test.beforeEach(() => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(test.info().project.name !== 'mobile', 'mobile project only');
  });

  test.use({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });

  const bars = (page: Page): [string, Locator][] => [['dock handle', handle(page)]];

  test('/: handle, strip, status, sheet, Results and a notice all fit, reachable and axe clean', async ({
    page
  }) => {
    await gotoEditorWithN1(page);
    await expectFootprintSettled(page);
    const region = page.locator('#map-region');
    const header = await box(page.locator('header').first());

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await expectNoFooter(page);
    // Before the sheet and Results open: opening the Menu folds the sheet.
    await expectAboutReachable(page);

    for (const c of [handle(page), headerScore(page)]) {
      await expect(c).toBeVisible();
      await expect(c).toBeInViewport({ ratio: 1 });
      await expectUnobscured(c);
    }

    // The notice: inside the region, clear of the bars and the attribution, below the header.
    await expectInside(notice(page), region);
    await expectApart(
      [['notice', notice(page)]],
      [...bars(page), ['attribution', attribution(page)]]
    );
    expect((await box(notice(page))).y).toBeGreaterThanOrEqual(header.y + header.height);
    await expectNoA11yViolations(page);

    // The palette strip: every control visible, on top, clear of the bars.
    await chooseTool(page, 'Paint');
    for (const name of [/^Tool: /, /^Height: /, /^Brush \d+ m$/, /^Done$/]) {
      const c = strip(page).getByRole('button', { name });
      await expect(c).toBeInViewport({ ratio: 1 });
      await expectUnobscured(c);
    }
    await expectApart([['palette strip', strip(page)]], bars(page));

    // The status pill: under the header, in the viewport.
    await expect(statusLine(page)).toHaveText(MSG.zoomIn);
    expect((await box(statusPill(page))).y).toBeGreaterThanOrEqual(header.y + header.height);
    await expect(statusPill(page)).toBeInViewport({ ratio: 1 });

    // The dock's sheet: inside the region, its collapse button reachable.
    await chooseTool(page, 'Move');
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
    await expectInside(dockSheet(page), region);
    const collapse = dockSheet(page).getByRole('button', { name: 'Collapse Paint' });
    await expect(collapse).toBeInViewport({ ratio: 1 });
    await expectUnobscured(collapse);
    await expectNoA11yViolations(page);
    await collapse.tap();
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
    // Folding by the button leaves focus on the handle, not on the page.
    await expect(handle(page)).toBeFocused();

    // Results (the header score) in the sheet: inside the map region, its flip button reachable.
    await headerScore(page).tap();
    await expect(resultsFace(page)).toBeVisible();
    await expectInside(dockSheet(page), region);
    const flip = dockSheet(page).getByRole('button', { name: 'Back to painting' });
    await expect(flip).toBeInViewport({ ratio: 1 });
    await expectUnobscured(flip);
    await expectNoFooter(page);
    await expectNoA11yViolations(page);
    await flip.tap();
    await expect(resultsFace(page)).toHaveCount(0);
  });

  test('/p/:id: read-only handle, score and About entry fit under the shared banner', async ({
    page,
    request
  }) => {
    const res = await request.post('/api/plans', {
      data: smallText,
      headers: { 'content-type': 'application/json' }
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/p/${id}`);
    await waitForMap(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await checkMobile(page);
    // Read-only: the sheet holds the read-only line and one summary line; no rows, no tools.
    await handle(page).tap();
    const tab = dockSheet(page).getByRole('tabpanel');
    await expect(tab.getByText(MSG.readOnly, { exact: true })).toBeVisible();
    await expect(tab.getByText(/stories · [\d,]+ lots? rebuilt$/)).toBeVisible();
    await expect(page.locator('[data-paint-row]')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Brush tool' })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
});

// The account entry (Sign in) follows the actions in the header's right group from lg and waits in
// the Menu below it, so it never crowds the page's pinned score, status or actions.
test.describe('account entry', () => {
  const account = (page: Page): Locator =>
    page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true });

  test.describe('desktop', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');
    test.use({ viewport: { width: 1024, height: 768 } });

    for (const path of ['/', '/sim']) {
      test(`${path} at 1024×768: visible, clear of the header score and the actions, axe clean`, async ({
        page
      }) => {
        await page.goto(path);
        await expect(headerScore(page)).toBeVisible();
        await expect(account(page)).toBeVisible();
        await expect(account(page)).toHaveAttribute('href', '/signin');
        const entry = await box(account(page));
        const others = page
          .getByRole('banner')
          .locator('a, button, [data-testid="score-bar"], [data-header-status]')
          .filter({ visible: true });
        const count = await others.count();
        for (let i = 0; i < count; i++) {
          const other = others.nth(i);
          if (await other.evaluate((el) => el.hasAttribute('data-header-account'))) continue;
          const b = await other.boundingBox();
          if (!b || b.width === 0) continue;
          expect(intersects(entry, b), `account entry overlaps ${fmt(b)}`).toBe(false);
        }
        await expectNoA11yViolations(page);
      });
    }
  });

  test.describe('mobile', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => !isMobile, 'mobile project only');

    for (const path of ['/', '/sim']) {
      test(`${path}: waits in the Menu and is reachable from it, axe clean`, async ({ page }) => {
        await page.goto(path);
        // the Menu toggle does nothing before hydration, so a loaded machine flaked here
        await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
        await expect(page.getByRole('banner')).toBeVisible();
        // The map and its controls settle after hydration: the scan below covers the whole page,
        // so it waits for the map and the bottom-right footprint the dock and Reset view follow.
        // waitForFunction has no raised expect timeout: it runs until the test's own.
        await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
        await expectFootprintSettled(page);
        await expect(account(page)).toBeHidden();
        await openHeaderMenu(page);
        await expect(account(page)).toBeVisible();
        await expect(account(page)).toBeInViewport({ ratio: 1 });
        await expectNoA11yViolations(page);
      });
    }
  });
});
