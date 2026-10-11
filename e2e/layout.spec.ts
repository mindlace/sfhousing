// W6b layout (WCAG 2.4.11 Focus Not Obscured): below 768 px the brush bar, the score bar and the
// scoreboard sheet are anchored to #map-region, not the viewport, so the site footer's links stay
// visible, unobscured and tappable on the full-height routes `/` and `/p/:id`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MSG } from '../src/lib/brush/messages';
import { gotoEditor, smallText, waitForMap, type Win } from './helpers/sharing';

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

async function box(loc: Locator) {
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
  // attribution (i) button (< 640 px), so it must leave that button uncovered too.
  const attrib = (page: Page): Locator => page.locator('.maplibregl-ctrl-attrib-button');
  const statusLine = (page: Page): Locator => page.locator('.brush-toolbar').getByRole('status');

  async function expectStatusClearOfAttrib(page: Page): Promise<void> {
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
