// W6b layout (WCAG 2.4.11 Focus Not Obscured): below 768 px the brush bar, the score bar and the
// scoreboard sheet are anchored to #map-region, not the viewport, so the site footer's links stay
// visible, unobscured and tappable on the full-height routes `/` and `/p/:id`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MSG } from '../src/lib/brush/messages';
import { COPY } from '../src/lib/sharing/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { PLAN_KEY, gotoEditor, smallText, waitForMap, type Win } from './helpers/sharing';

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const fmt = (b: Box): string =>
  `[${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}]`;

const notice = (page: Page): Locator => page.getByTestId('notice');
const statusLine = (page: Page): Locator => page.locator('.brush-toolbar').getByRole('status');
/** The narrow brush bar's popover openers (stories, then radius). */
const POP_OPENERS = [/stories per stroke/, /^Brush \d+ m$/];

/** Taps a narrow popover's opener and returns the open popover. */
async function openPopover(page: Page, name: RegExp): Promise<Locator> {
  const opener = page.getByTestId('brush-bar').getByRole('button', { name });
  await opener.tap();
  const pop = page.locator(`[id="${await opener.getAttribute('aria-controls')}"]`);
  await expect(pop).toBeVisible();
  return pop;
}

/** Paint at the default city zoom: the brush is too small to see, so the zoom hint shows. */
async function showZoomHint(page: Page): Promise<void> {
  await page.getByTestId('brush-bar').getByRole('radio', { name: 'Paint' }).tap();
  await expect(statusLine(page)).toHaveText(MSG.zoomIn);
  await expect(statusLine(page)).toBeVisible();
}

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

/**
 * The attribution is painted on top at its centre and no `floats` box overlaps it: a floating
 * popover or status line leaves the whole control uncovered, wrapping or narrowing instead.
 */
async function expectAttributionClear(page: Page, floats: [string, Locator][]): Promise<void> {
  await expect(attribution(page)).toBeVisible();
  await expectUnobscured(attribution(page));
  await expectApart(floats, [['attribution', attribution(page)]]);
}

const FOOTER_LINKS = ['About', 'Data & licences', 'Source code (GitHub)'];

const footerLink = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name, exact: true });
const brushBar = (page: Page): Locator => page.getByTestId('brush-bar');
const scoreRegion = (page: Page): Locator =>
  page.getByRole('region', { name: 'Housing scoreboard' });
const scoreBar = (page: Page): Locator =>
  scoreRegion(page).locator('button[aria-controls]', { has: page.getByTestId('scorebar-text') });
const sheet = (page: Page): Locator => page.getByRole('group', { name: 'Scoreboard details' });

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

/** Bars visible, footer reachable; then the sheet open, inside the map region, footer still so. */
async function checkMobile(page: Page): Promise<void> {
  const region = page.locator('#map-region');
  await expect(brushBar(page)).toBeVisible();
  await expect(scoreBar(page)).toBeVisible();
  await expectUnobscured(brushBar(page));
  await expectUnobscured(scoreBar(page));
  await expectInside(page.locator('.brush-toolbar'), region);
  await expectInside(scoreBar(page), region);
  // Stacked: the brush bar sits directly on top of the score bar, both at the region's bottom.
  const r = await box(region);
  const sb = await box(scoreBar(page));
  const bb = await box(brushBar(page));
  expect(Math.abs(sb.y + sb.height - (r.y + r.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(bb.y + bb.height - sb.y)).toBeLessThanOrEqual(1);
  await expectFooterReachable(page);
  // Containing blocks: the bars resolve against the map region (directly, or via BrushEditor's
  // frame, which fills it), and the map canvas ends where the bars do.
  const cb = await page.evaluate(() => {
    const rg = document.getElementById('map-region')!;
    const frame = rg.querySelector<HTMLElement>('.brush-editor')!;
    const toolbar = rg.querySelector<HTMLElement>('.brush-toolbar')!;
    const bar = rg.querySelector<HTMLElement>('.sfh-scoreboard button[aria-controls]')!;
    const canvas = (window as Win).__sfhMap!.map!.getCanvas().getBoundingClientRect();
    const r = rg.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return {
      toolbarParent: toolbar.offsetParent === frame,
      barParent: bar.parentElement!.offsetParent === rg,
      frameFills: Math.abs(f.top - r.top) < 1 && Math.abs(f.bottom - r.bottom) < 1,
      canvasBottom: Math.abs(canvas.bottom - r.bottom) < 1
    };
  });
  expect(cb).toEqual({
    toolbarParent: true,
    barParent: true,
    frameFills: true,
    canvasBottom: true
  });
  // setBottomInset: brush bar + score bar, in map-container pixels.
  await expect.poll(() => paddingBottom(page)).toBe(sb.height + bb.height);

  await scoreBar(page).tap();
  await expect(sheet(page)).toBeVisible();
  await expectInside(sheet(page), region);
  await expectFooterReachable(page);
  // With the sheet open, the inset is the sheet's height.
  const sheetH = await sheet(page).evaluate((el) => (el as HTMLElement).offsetHeight);
  await expect.poll(() => paddingBottom(page)).toBe(sheetH);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect.poll(() => paddingBottom(page)).toBe(sb.height + bb.height);
}

const paddingBottom = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Win).__sfhMap!.map!.getPadding().bottom ?? 0);

test.describe('mobile', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  test('/: footer links stay visible, unobscured and tappable over the bars and sheet', async ({
    page
  }) => {
    await gotoEditor(page);
    await checkMobile(page);

    // The brush bar's popovers float above it inside the map region, unclipped and on top.
    // Collapsed attribution here; the expanded case has its own test below.
    await setAttribution(page, false);
    const region = page.locator('#map-region');
    for (const name of [/stories per stroke/, /^Brush \d+ m$/]) {
      const opener = brushBar(page).getByRole('button', { name });
      await opener.tap();
      const pop = page.locator(`[id="${await opener.getAttribute('aria-controls')}"]`);
      await expect(pop).toBeVisible();
      await expectInside(pop, region);
      expect((await box(pop)).y + (await box(pop)).height).toBeLessThanOrEqual(
        (await box(brushBar(page))).y
      );
      await expectUnobscured(pop);
      expect(await pop.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      // ...and leave the map's attribution (i) button, just above the bars, uncovered.
      await expectUnobscured(page.locator('.maplibregl-ctrl-attrib-button'));
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
    }

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

  // The floating status line shares the band just above the bars with map-view's compact
  // attribution (i) button (< 640 px), so it must leave that button uncovered too. These cases
  // collapse the attribution first; the expanded case has its own test below.
  const attrib = (page: Page): Locator => page.locator('.maplibregl-ctrl-attrib-button');

  async function expectStatusClearOfAttrib(page: Page): Promise<void> {
    await setAttribution(page, false);
    await expect(attrib(page)).toBeVisible();
    await expectUnobscured(attrib(page));
    // The wrapper bounds any message (a long one wraps inside it), not just the current one.
    const s = await box(page.locator('.brush-status'));
    expect(s.x + s.width).toBeLessThanOrEqual((await box(attrib(page))).x);
    expect(s.y + s.height).toBeLessThanOrEqual((await box(brushBar(page))).y);
  }

  test('/: a status message leaves the attribution button unobscured', async ({ page }) => {
    await gotoEditor(page);
    // Paint at the default city zoom: the brush is too small to see, so the zoom hint shows.
    await brushBar(page).getByRole('radio', { name: 'Paint' }).tap();
    await expect(statusLine(page)).toHaveText(MSG.zoomIn);
    await expect(statusLine(page)).toBeVisible();
    // (The status line is pointer-events: none, so elementFromPoint looks through it; no
    // unobscured check on the line itself.)
    await expectStatusClearOfAttrib(page);
  });

  test('/: the failed phase with Retry leaves the attribution button unobscured', async ({
    page
  }) => {
    // The sim worker never loads: the client reports a crash and the brush enters `failed`.
    await page.route('**/workers/worker-*.js', (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto('/');
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000
    });
    await expect(statusLine(page)).toHaveText(MSG.cityFailed);
    const retry = page.locator('.brush-toolbar').getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await expectUnobscured(retry);
    await expectStatusClearOfAttrib(page);
    expect((await box(retry)).x + (await box(retry)).width).toBeLessThanOrEqual(
      (await box(attrib(page))).x
    );
  });

  /** Each popover, then the status line, leaves the attribution uncovered and stays in bounds. */
  async function expectFloatsClearOfAttribution(page: Page): Promise<void> {
    const region = page.locator('#map-region');
    for (const name of POP_OPENERS) {
      const pop = await openPopover(page, name);
      await expectInside(pop, region);
      await expectUnobscured(pop);
      expect(await pop.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expectAttributionClear(page, [['popover', pop]]);
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
    }
    await showZoomHint(page);
    await expectInside(page.locator('.brush-status'), region);
    await expectAttributionClear(page, [['status line', page.locator('.brush-status')]]);
  }

  test('/: with the attribution expanded, the popovers and status line leave it uncovered', async ({
    page
  }) => {
    await gotoEditor(page);
    // Expanded from the (i) toggle (collapse first: MapLibre starts it expanded).
    await setAttribution(page, false);
    await setAttribution(page, true);
    await expect(attribution(page)).toHaveClass(/maplibregl-compact-show/);
    await expectFloatsClearOfAttribution(page);
  });

  test('700×800: the popovers and status line leave the attribution strip uncovered', async ({
    page
  }) => {
    // 640–767 px: the attribution is a full-width text strip (not compact) above the bars.
    await page.setViewportSize({ width: 700, height: 800 });
    await gotoEditor(page);
    await expect(attribution(page)).not.toHaveClass(/maplibregl-compact/);
    await expectFootprintSettled(page);
    await expectFloatsClearOfAttribution(page);
  });
});

test.describe('desktop', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'chromium project only');

  test('/: footer reachable, toolbar top-left, scoreboard panel top-right', async ({ page }) => {
    await gotoEditor(page);
    for (const name of FOOTER_LINKS) {
      const link = footerLink(page, name);
      await expect(link).toBeVisible();
      await expect(link).toBeInViewport({ ratio: 1 });
      await expectUnobscured(link);
    }
    const region = await box(page.locator('#map-region'));
    const toolbar = await box(page.locator('.brush-toolbar'));
    expect(toolbar.x - region.x).toBeCloseTo(16, 0);
    expect(toolbar.y - region.y).toBeCloseTo(16, 0);
    const panel = await box(scoreRegion(page).locator('div.md\\:block').first());
    expect(region.x + region.width - (panel.x + panel.width)).toBeCloseTo(16, 0);
    expect(panel.y - region.y).toBeCloseTo(16, 0);
    await expect(scoreBar(page)).toBeHidden();
  });
});

// 768–1023 px: the floating toolbar (top-left) and the scoreboard panel (top-right) leave no room
// beside the toolbar, so plan-sharing's NoticeStack sits under it. The toolbar caps its height
// above the stack and scrolls inside.
test.describe('medium width', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ isMobile }) => isMobile, 'chromium project only');

  async function expectToolbarClear(page: Page): Promise<void> {
    const toolbar = page.locator('.brush-toolbar');
    await expectInside(toolbar, page.locator('#map-region'));
    await expectApart(
      [['toolbar', toolbar]],
      [
        ['notice', notice(page)],
        ['scoreboard panel', page.locator('.sfh-scoreboard > div.md\\:block')]
      ]
    );
  }

  for (const [width, height] of [
    [800, 600],
    [1023, 700]
  ] as const) {
    test(`${width}×${height}: the toolbar stays clear of a notice and scrolls inside`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await gotoEditorWithN1(page);
      await expectToolbarClear(page);

      // The keyboard shortcuts table grows the toolbar's content past the room above the notice.
      const panel = page.getByTestId('brush-bar');
      const toggle = panel.getByRole('button', { name: 'Keyboard shortcuts' });
      await toggle.click();
      await expect(panel.locator('table')).toBeVisible();
      await expectToolbarClear(page);

      const scroll = await panel.evaluate((el) => ({
        overflows: el.scrollHeight > el.clientHeight,
        overflowY: getComputedStyle(el).overflowY
      }));
      expect(scroll).toEqual({ overflows: true, overflowY: 'auto' });

      // The last control scrolls into view inside the panel and is reachable; so does the end
      // of the content.
      const controls = panel.locator('button, input');
      const last = controls.nth((await controls.count()) - 1);
      await last.scrollIntoViewIfNeeded();
      await expectInside(last, panel);
      await expect(last).toBeInViewport({ ratio: 1 });
      await expectUnobscured(last);
      await last.click({ trial: true });
      await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const lastRow = panel.locator('tbody tr').last();
      await expectInside(lastRow, panel);
      await expect(lastRow).toBeInViewport({ ratio: 1 });
    });
  }
});

// A landscape phone: below 768 px, so the narrow layout (score bar + brush bar, 112 px) on a
// 291 px map region; from 640 px the attribution is a full-width text strip above the bars.
test.describe('landscape phone 667×375', () => {
  // By project name: this describe's own test.use sets isMobile in both projects.
  test.beforeEach(() => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(test.info().project.name !== 'mobile', 'mobile project only');
  });

  test.use({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });

  const bars = (page: Page): [string, Locator][] => [
    ['brush toolbar', page.locator('.brush-toolbar')],
    ['score bar', scoreBar(page)]
  ];

  test('/: bars, popovers, status, sheet and a notice all fit, reachable and axe clean', async ({
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

    // Every brush control and the score bar: visible and painted on top.
    const bar = brushBar(page);
    const controls = [
      ...['Move', 'Paint', 'Erase'].map((name) => bar.getByRole('radio', { name })),
      ...POP_OPENERS.map((name) => bar.getByRole('button', { name })),
      bar.getByRole('button', { name: /^Undo/ }),
      bar.getByRole('button', { name: /^Redo/ }),
      scoreBar(page)
    ];
    for (const c of controls) {
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

    // Popovers: inside the viewport and the map region (so below the header), on top, clear of
    // the bars and the attribution strip.
    for (const name of POP_OPENERS) {
      const pop = await openPopover(page, name);
      await expect(pop).toBeInViewport({ ratio: 1 });
      await expectInside(pop, region);
      expect((await box(pop)).y).toBeGreaterThanOrEqual(header.y + header.height);
      await expectUnobscured(pop);
      await expectApart([['popover', pop]], bars(page));
      await expectAttributionClear(page, [['popover', pop]]);
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
    }

    // The status line: inside the region, clear of the bars, the attribution and the notice.
    await showZoomHint(page);
    const status = page.locator('.brush-status');
    await expectInside(status, region);
    await expectApart([['status line', status]], [...bars(page), ['notice', notice(page)]]);
    await expectAttributionClear(page, [['status line', status]]);

    // The sheet: inside the map region, its Close button reachable, the footer still reachable.
    await scoreBar(page).tap();
    await expect(sheet(page)).toBeVisible();
    await expectInside(sheet(page), region);
    const close = sheet(page).getByRole('button', { name: 'Close' });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expectUnobscured(close);
    await close.tap({ trial: true });
    await expectFooterReachable(page);
    await expectNoA11yViolations(page);
    await close.tap();
    await expect(sheet(page)).toBeHidden();
  });

  test('/p/:id: read-only bars and footer fit under the shared banner', async ({
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
    await expectUnobscured(brushBar(page).getByRole('radio', { name: 'Move' }));
    await expectNoA11yViolations(page);
  });
});
