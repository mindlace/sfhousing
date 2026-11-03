// `/` and `/p/:id` layout (W6b, WCAG 2.4.11 Focus Not Obscured), on the dock (sim-ux plan 5): below
// 768 px the dock's sheet handle sits on the score bar, both anchored to #map-region, so the site
// footer's links stay visible, unobscured and tappable on the full-height routes; the map's inset
// follows the sheet; the brush status is a pill under the header; the palette strip leaves the map
// controls uncovered. From 768 px the dock is a panel on the left of the map.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MSG } from '../src/lib/brush/messages';
import { COPY } from '../src/lib/sharing/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import {
  PLAN_KEY,
  chooseTool,
  gotoEditor,
  smallText,
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

const FOOTER_LINKS = ['About', 'Data & licences', 'Source code (GitHub)'];

const footerLink = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name, exact: true });
const scoreRegion = (page: Page): Locator =>
  page.getByRole('region', { name: 'Housing scoreboard' });
const scoreBar = (page: Page): Locator =>
  scoreRegion(page).locator('button[aria-controls]', { has: page.getByTestId('scorebar-text') });
const scoreSheet = (page: Page): Locator => page.getByRole('group', { name: 'Scoreboard details' });

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

async function expectFooterReachable(page: Page): Promise<void> {
  for (const name of FOOTER_LINKS) {
    const link = footerLink(page, name);
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport({ ratio: 1 });
    await expectUnobscured(link);
    await link.tap({ trial: true });
  }
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
 * The handle and the score bar visible, stacked at the region's bottom, footer reachable; the
 * map's inset follows the dock sheet, then the scoreboard's sheet; both stay inside the region.
 */
async function checkMobile(page: Page): Promise<void> {
  const region = page.locator('#map-region');
  await expect(handle(page)).toBeVisible();
  await expect(scoreBar(page)).toBeVisible();
  await expectUnobscured(handle(page));
  await expectUnobscured(scoreBar(page));
  await expectInside(dockSheet(page), region);
  await expectInside(scoreBar(page), region);
  // Stacked: the closed sheet (its handle) sits directly on the score bar, at the region's bottom.
  const r = await box(region);
  const sb = await box(scoreBar(page));
  const ds = await box(dockSheet(page));
  expect(Math.abs(sb.y + sb.height - (r.y + r.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(ds.y + ds.height - sb.y)).toBeLessThanOrEqual(1);
  await expectFooterReachable(page);
  // Containing blocks: the score bar resolves against the map region, the sheet against the map
  // box in BrushEditor's frame, which fills it; the map canvas ends at the region's bottom.
  const cb = await page.evaluate(() => {
    const rg = document.getElementById('map-region')!;
    const frame = rg.querySelector<HTMLElement>('.brush-editor')!;
    const sheet = rg.querySelector<HTMLElement>('.sfh-dock-sheet')!;
    const bar = rg.querySelector<HTMLElement>('.sfh-scoreboard button[aria-controls]')!;
    const canvas = (window as Win).__sfhMap!.map!.getCanvas().getBoundingClientRect();
    const r = rg.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return {
      sheetInFrame: frame.contains(sheet.offsetParent),
      barParent: bar.parentElement!.offsetParent === rg,
      frameFills: Math.abs(f.top - r.top) < 1 && Math.abs(f.bottom - r.bottom) < 1,
      canvasBottom: Math.abs(canvas.bottom - r.bottom) < 1
    };
  });
  expect(cb).toEqual({ sheetInFrame: true, barParent: true, frameFills: true, canvasBottom: true });
  // setBottomInset: the handle + the score bar, in map-container pixels.
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(sb.height + ds.height));

  // The dock's sheet open: inside the region, the footer still reachable, the inset its height.
  await handle(page).tap();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
  await expectInside(dockSheet(page), region);
  await expectFooterReachable(page);
  const openH = await dockSheet(page).evaluate((el) => el.getBoundingClientRect().height);
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(openH + sb.height));
  await handle(page).tap();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(sb.height + ds.height));

  // The scoreboard's sheet: inside the region, the footer reachable, the inset its height.
  await scoreBar(page).tap();
  await expect(scoreSheet(page)).toBeVisible();
  await expectInside(scoreSheet(page), region);
  await expectFooterReachable(page);
  const sheetH = await scoreSheet(page).evaluate((el) => (el as HTMLElement).offsetHeight);
  await expect.poll(() => paddingBottom(page)).toBe(sheetH);
  await page.keyboard.press('Escape');
  await expect(scoreSheet(page)).toBeHidden();
  await expect.poll(() => paddingBottom(page)).toBe(Math.round(sb.height + ds.height));
}

test.describe('mobile', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  test('/: footer links stay visible, unobscured and tappable over the handle, bar and sheets', async ({
    page
  }) => {
    await gotoEditor(page);
    await checkMobile(page);

    await footerLink(page, 'About').tap();
    await expect(page).toHaveURL(/\/about$/);
    await page.goBack();
    await waitForMap(page);
    await expectFooterReachable(page);
  });

  test('/p/:id: footer links stay visible, unobscured and tappable', async ({ page, request }) => {
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

  test('/: footer reachable, the dock on the left, scoreboard panel top-right', async ({
    page
  }) => {
    await gotoEditor(page);
    for (const name of FOOTER_LINKS) {
      const link = footerLink(page, name);
      await expect(link).toBeVisible();
      await expect(link).toBeInViewport({ ratio: 1 });
      await expectUnobscured(link);
    }
    const region = await box(page.locator('#map-region'));
    const dock = await box(page.locator('.sfh-dock-panel'));
    expect(dock.x - region.x).toBeCloseTo(0, 0);
    expect(dock.y - region.y).toBeCloseTo(0, 0);
    expect(dock.width).toBeCloseTo(320, 0);
    expect(region.y + region.height - (dock.y + dock.height)).toBeCloseTo(0, 0);
    const panel = await box(scoreRegion(page).locator('div.md\\:block').first());
    expect(region.x + region.width - (panel.x + panel.width)).toBeCloseTo(16, 0);
    expect(panel.y - region.y).toBeCloseTo(16, 0);
    await expect(scoreBar(page)).toBeHidden();
    await expect(handle(page)).toHaveCount(0);
    // The map's navigation control moves right of the dock.
    const nav = await box(page.locator('.maplibregl-ctrl-bottom-left'));
    expect(nav.x).toBeGreaterThanOrEqual(dock.x + dock.width - 0.5);
  });
});

// 768–1023 px: the dock (left) and the scoreboard panel (right) hang from the top; the dock scrolls
// inside when its content is taller than the map.
test.describe('medium width', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'chromium project only');

  for (const [width, height] of [
    [800, 600],
    [1023, 700]
  ] as const) {
    test(`${width}×${height}: the dock stays in the region, clear of the scoreboard, and scrolls inside`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await gotoEditor(page);
      const panel = page.locator('.sfh-dock-panel');
      await expectInside(panel, page.locator('#map-region'));
      await expectApart(
        [['dock', panel]],
        [['scoreboard panel', page.locator('.sfh-scoreboard > div.md\\:block')]]
      );

      // The keyboard shortcuts table grows the dock's content past the map's height.
      await panel.getByText('Keyboard shortcuts', { exact: true }).click();
      await expect(panel.locator('table')).toBeVisible();
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
});

// A landscape phone: below 768 px, so the narrow layout (score bar + sheet handle) on a short map
// region; from 640 px the attribution is a full-width text strip above them.
test.describe('landscape phone 667×375', () => {
  // By project name: this describe's own test.use sets isMobile in both projects.
  test.beforeEach(() => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(test.info().project.name !== 'mobile', 'mobile project only');
  });

  test.use({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });

  const bars = (page: Page): [string, Locator][] => [
    ['dock handle', handle(page)],
    ['score bar', scoreBar(page)]
  ];

  test('/: handle, bar, strip, status, sheets and a notice all fit, reachable and axe clean', async ({
    page
  }) => {
    await gotoEditorWithN1(page);
    await expectFootprintSettled(page);
    const region = page.locator('#map-region');
    const header = await box(page.locator('header').first());

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await expectFooterReachable(page);

    for (const c of [handle(page), scoreBar(page)]) {
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

    // The scoreboard's sheet: inside the map region, its Close button reachable.
    await scoreBar(page).tap();
    await expect(scoreSheet(page)).toBeVisible();
    await expectInside(scoreSheet(page), region);
    const close = scoreSheet(page).getByRole('button', { name: 'Close' });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expectUnobscured(close);
    await close.tap({ trial: true });
    await expectFooterReachable(page);
    await expectNoA11yViolations(page);
    await close.tap();
    await expect(scoreSheet(page)).toBeHidden();
  });

  test('/p/:id: read-only handle, bar and footer fit under the shared banner', async ({
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
    // Read-only: the sheet holds the rows, no tools.
    await handle(page).tap();
    await expect(page.locator('[data-paint-row]').first()).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Brush tool' })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
});
