// /lesscars e2e (Plan 2 Task 10). Runs against the VITE_E2E build, which exposes
// window.__sfhLessCars (src/lib/lesscars/debug.ts) and window.__sfhMap. Every count, label, day and
// id is read from fixture-0's files on disk (plan.json, sites.json, summary.json, timeline.bin,
// parcels.bin), never hard-coded. Map assertions query what MapLibre actually rendered
// (queryRenderedFeatures on the page's own layer ids), after the map has gone idle.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import {
  decodeTimelinePayload,
  parsePlanFile,
  parseSitesFile,
  parseSummary,
  type LessCarsPlanFile
} from '../src/lib/data/lesscars/codec';
import { LESSCARS_START } from '../src/lib/data/lesscars/schedule';
import { readScenarioParcels } from '../src/lib/data/scenario-codec';
import { formatMonthYear } from '../src/lib/fzp/format';
import { monthStart } from '../src/lib/fzp/time';
import type { SfhLessCarsDebug } from '../src/lib/lesscars/debug';
import { LC_LAYER, LC_STREET_LAYER } from '../src/lib/lesscars/map-layers';
import { headlineText } from '../src/lib/lesscars/summary-view';
import { formatCount } from '../src/lib/scoreboard/format';
import { SITES_CELL } from '../src/lib/sim/lesscars/builds';
import { expectNoA11yViolations } from './helpers/a11y';
import { slider } from './helpers/run';
import {
  FRAME,
  gotoHydrated,
  headerAction,
  jumpAndIdle,
  openHeaderMenu,
  projectToPage,
  type LngLat,
  type Win
} from './helpers/sharing';

type LcWin = Win & { __sfhLessCars?: SfhLessCarsDebug };
type Props = Record<string, unknown>;

// ---- fixture-0 ----------------------------------------------------------------------------------

const DATA = new URL('./fixtures/data/fixture-0/', import.meta.url);
const bytes = (path: string): Buffer => readFileSync(new URL(path, DATA));
const json = (path: string): unknown => JSON.parse(bytes(path).toString('utf8'));

const planFile = parsePlanFile(json('scenarios/lesscars/plan.json'));
const sitesFile = parseSitesFile(json('scenarios/lesscars/sites.json'));
const summary = parseSummary(json('scenarios/lesscars/summary.json'));
const parcels = await readScenarioParcels(new Uint8Array(bytes('scenarios/fzp/parcels.bin')));
const timeline = decodeTimelinePayload(
  inflateRawSync(bytes('scenarios/lesscars/timeline.bin')),
  parcels
);

/** A project's scheduled times in plan.json. */
function T(id: string): LessCarsPlanFile['times'][number] {
  const t = planFile.times.find((x) => x.id === id);
  if (!t) throw new Error(`fixture-0's plan has no project ${id}`);
  return t;
}

const siteIds = sitesFile.sites.map((s) => s.siteId).sort();

/** The parcel's label point, from the parcel chunks' 1e-7 degree integers. */
function parcelLabel(parcelId: string): LngLat {
  for (const name of ['parcels/50_25.json', 'parcels/51_25.json']) {
    const c = json(name) as { id: string[]; label: number[] };
    const i = c.id.indexOf(parcelId);
    if (i >= 0) return [c.label[2 * i] / 1e7, c.label[2 * i + 1] / 1e7];
  }
  throw new Error(`fixture-0 has no parcel ${parcelId}`);
}

/** A freed site's label point (inside the site, where its building stands). */
function siteCentre(siteId: string): LngLat {
  const s = sitesFile.sites.find((x) => x.siteId === siteId);
  if (!s) throw new Error(`fixture-0 has no site ${siteId}`);
  return s.rec.labelPoint;
}

/** The edge garage that stands on a parcel (a `{ parcel }` site), so a reservation decides it. */
function garageOnParcel(f: LessCarsPlanFile) {
  const g = f.plan.projects.find((p) => p.kind === 'edge-garage' && 'parcel' in p.site);
  if (!g || g.kind !== 'edge-garage' || !('parcel' in g.site))
    throw new Error("fixture-0's plan has no edge garage on a parcel");
  return { id: g.id, site: g.site };
}

/** West, south, east, north over every street segment, plan line, stop and site. */
function planBBox(f: LessCarsPlanFile): [number, number, number, number] {
  const pts: [number, number][] = [];
  for (const lines of Object.values(f.segments)) for (const l of lines) pts.push(...l);
  for (const p of f.plan.projects) {
    if ('alignment' in p) pts.push(...p.alignment);
    if ('stops' in p) for (const s of p.stops) if (s.lngLat) pts.push(s.lngLat);
    if ('segments' in p) for (const s of p.segments) if ('line' in s) pts.push(...s.line);
  }
  for (const s of sitesFile.sites) for (const ring of s.outline) pts.push(...ring);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** "1,234" or "−56" (U+2212) back to a number. */
const parseCount = (s: string): number => Number(s.trim().replace(/,/g, '').replace('−', '-'));

// ---- helpers ------------------------------------------------------------------------------------

const readout = (page: Page): Locator => page.getByTestId('fzp-readout-label');

function lc<K extends keyof SfhLessCarsDebug>(page: Page, key: K): Promise<SfhLessCarsDebug[K]> {
  return page.evaluate((k) => (window as LcWin).__sfhLessCars![k], key) as Promise<
    SfhLessCarsDebug[K]
  >;
}

/** Repaints, waits for the map to go idle, and returns the properties MapLibre drew on `layer`. */
async function renderedProps(page: Page, layer: string): Promise<Props[]> {
  return page.evaluate(
    (id) =>
      new Promise<Props[]>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        if (!map.getLayer(id)) throw new Error(`no layer ${id}`);
        map.once('idle', () =>
          resolve(map.queryRenderedFeatures({ layers: [id] }).map((f) => ({ ...f.properties })))
        );
        map.triggerRepaint();
      }),
    layer
  );
}

const projectsOn = async (page: Page, layer: string): Promise<string[]> =>
  [...new Set((await renderedProps(page, layer)).map((p) => String(p.project)))].sort();

/** Fits the map to `bbox` without animation, then waits for idle. */
async function frameOn(page: Page, bbox: [number, number, number, number]): Promise<void> {
  await page.evaluate(
    (b) =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]]
          ],
          { padding: 20, duration: 0 }
        );
      }),
    bbox
  );
}

/**
 * Scrubs with the keyboard to the first month start on or after `d`: Home, PageUp by years, then
 * ArrowRight by months, until the readout and the hook's day show it (End past the horizon).
 */
async function setDay(page: Page, d: number): Promise<void> {
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect(readout(page)).toHaveText(formatMonthYear(LESSCARS_START));
  for (let i = 0; i < 600; i++) {
    const day = await lc(page, 'day');
    if (day >= d) break;
    const yearAhead = new Date(day * 86_400_000);
    yearAhead.setUTCFullYear(yearAhead.getUTCFullYear() + 1);
    const key = yearAhead.getTime() / 86_400_000 <= d ? 'PageUp' : 'ArrowRight';
    const before = day;
    await page.keyboard.press(key);
    await expect.poll(() => lc(page, 'day')).not.toBe(before);
  }
  const day = await lc(page, 'day');
  expect(day).toBeGreaterThanOrEqual(d);
  await expect(readout(page)).toHaveText(formatMonthYear(monthStart(day)));
}

async function toEnd(page: Page): Promise<void> {
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(() => lc(page, 'day')).toBe(summary.yearEnds.at(-1)!);
}

/** A mouse click on desktop, a one-finger tap on the mobile project. */
async function pick(page: Page, isMobile: boolean, [x, y]: [number, number]): Promise<void> {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * At the horizon, taps the label point of the freed-land build on the largest site until its card
 * shows. The largest site is the one whose building surely covers its label point: on fixture-0
 * that is lc:hwy:1, freeway-land lot 19 merged with the ROW piece it touches (1,800 m²), whose
 * label point falls in the stretch's full-width rectangle, not in the lot's narrow tab.
 */
async function openFreedCard(page: Page, isMobile: boolean) {
  const areaOf = (siteId: string) =>
    sitesFile.sites.find((s) => s.siteId === siteId)?.rec.areaM2 ?? 0;
  const b = timeline.builds
    .filter((x) => x.parcelRow === null)
    .sort((x, y) => areaOf(y.siteId) - areaOf(x.siteId))[0];
  expect(b, 'fixture-0 has a freed-land build').toBeDefined();
  await toEnd(page);
  await page.waitForFunction(
    (cell) => (window as LcWin).__sfhLessCars!.cells.includes(cell),
    SITES_CELL
  );
  const at = siteCentre(b!.siteId);
  await jumpAndIdle(page, { ...FRAME, center: at });
  const card = page.getByRole('region', { name: 'Building details' });
  await expect(async () => {
    await pick(page, isMobile, await projectToPage(page, at));
    await expect(card).toContainText('Built by the plan on freed land', { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  return { card, build: b! };
}

// W6b: the footer links stay visible, unobscured and tappable (as in e2e/layout.spec.ts).
const FOOTER_LINKS = ['About', 'Data & licences', 'Source code (GitHub)'];

async function expectFooterReachable(page: Page): Promise<void> {
  for (const name of FOOTER_LINKS) {
    const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', {
      name,
      exact: true
    });
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport({ ratio: 1 });
    const hit = await link.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        ok: !!top && el.contains(top),
        top: top ? `${top.tagName}.${top.className}` : 'null'
      };
    });
    expect(hit.ok, `${name} covered by ${hit.top}`).toBe(true);
    await link.tap({ trial: true });
  }
}

// ---- the page -----------------------------------------------------------------------------------

test.describe('the page on fixture-0', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoHydrated(page, '/lesscars');
    await page.waitForFunction(
      () => (window as LcWin).__sfhLessCars?.phase === 'ready',
      undefined,
      {
        timeout: 20_000
      }
    );
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000
    });
    await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
    // The garages arrive with the worker's load (playbackLoaded), before the first revision.
    expect(await lc(page, 'seed')).toBe(timeline.seed);
  });

  test('opens paused on the plan start with the headline from summary.json', async ({ page }) => {
    await expect(page.getByTestId('lc-headline')).toHaveText(headlineText(summary));
    await expect(readout(page)).toHaveText(formatMonthYear(LESSCARS_START));
    expect(await lc(page, 'day')).toBe(LESSCARS_START);
    expect(await lc(page, 'playing')).toBe(false);
  });

  test('the details show a breakdown that adds to the headline', async ({ page }) => {
    await page.getByTestId('lc-headline').click();
    const table = page.getByRole('table', { name: /Where the extra homes come from/ });
    await expect(table).toBeVisible();
    const sources = (await table.locator('tbody td').allTextContents()).map(parseCount);
    const total = parseCount(await table.locator('tfoot td').innerText());
    const shown = Math.round(summary.extra.mean.at(-1)!);
    expect(sources).toHaveLength(4);
    expect(total).toBe(shown);
    expect(sources.reduce((a, b) => a + b, 0)).toBe(shown);
  });

  test('street states are rendered by day, and revert when scrubbing back', async ({ page }) => {
    const hwy = planFile.plan.projects.find((p) => p.kind === 'highway-truncation')!;
    await frameOn(page, planBBox(planFile));
    await setDay(page, T(hwy.id).openDay);
    expect(await projectsOn(page, LC_STREET_LAYER.removed)).toContain(hwy.id);
    expect(await projectsOn(page, LC_STREET_LAYER.works)).not.toContain(hwy.id);

    await slider(page).focus();
    await page.keyboard.press('ArrowLeft'); // the month before the open: works under way
    expect(await projectsOn(page, LC_STREET_LAYER.removed)).not.toContain(hwy.id);
    expect(await projectsOn(page, LC_STREET_LAYER.works)).toContain(hwy.id);

    await page.keyboard.press('Home');
    await expect(readout(page)).toHaveText(formatMonthYear(LESSCARS_START));
    expect(await renderedProps(page, LC_STREET_LAYER.removed)).toEqual([]);
    expect(await projectsOn(page, LC_STREET_LAYER.works)).not.toContain(hwy.id);
  });

  test('plan lines and stops appear on opening; freed land appears when available', async ({
    page
  }) => {
    const subway = planFile.plan.projects.find((p) => p.kind === 'transit-line')!;
    const freedBy = sitesFile.sites[0].projectId;
    await frameOn(page, planBBox(planFile));
    expect(await projectsOn(page, LC_LAYER.stopsCircle)).not.toContain(subway.id);
    expect(await renderedProps(page, LC_LAYER.sitesFill)).toEqual([]);

    await setDay(page, T(subway.id).openDay);
    expect(await projectsOn(page, LC_LAYER.stopsCircle)).toContain(subway.id);
    const built = (await renderedProps(page, LC_LAYER.lines)).filter(
      (p) => p.project === subway.id
    );
    expect(built.map((p) => p.building)).toContain(0);
    expect(await renderedProps(page, LC_LAYER.sitesFill)).toEqual([]);

    await setDay(page, T(freedBy).availableDay!);
    const sites = (await renderedProps(page, LC_LAYER.sitesFill)).map((p) => String(p.siteId));
    expect([...new Set(sites)].sort()).toEqual(siteIds);
  });

  test('a freed-land building rises and its card matches timeline.bin', async ({
    page,
    isMobile
  }) => {
    const { card, build } = await openFreedCard(page, isMobile);
    await expect(card).toContainText(`${formatCount(build.units)} homes`);
  });

  test('the garage marker follows the reservation verdict', async ({ page }) => {
    const garage = garageOnParcel(planFile);
    const row = parcels.id.indexOf(garage.site.parcel);
    const r = timeline.reservations.find((x) => x.row === row);
    expect(r, 'the garage parcel has a reservation in timeline.bin').toBeDefined();
    // The page holds the same verdict the stored timeline does.
    expect(await lc(page, 'reservations')).toContainEqual({
      parcelId: garage.site.parcel,
      kept: r!.kept
    });

    const shuttle = planFile.plan.projects.find(
      (p) => p.kind === 'car-shuttle' && p.garages.includes(garage.id)
    );
    expect(shuttle, "fixture-0's garage has a car shuttle").toBeDefined();
    await jumpAndIdle(page, { ...FRAME, center: parcelLabel(garage.site.parcel), zoom: 16 });
    await setDay(page, T(garage.id).openDay);
    expect(await projectsOn(page, LC_LAYER.garagesCircle)).toEqual(r!.kept ? [garage.id] : []);

    // Not a blank frame: the garage's shuttle line draws here once open; the marker still follows.
    await setDay(page, T(shuttle!.id).openDay);
    expect(await projectsOn(page, LC_LAYER.lines)).toContain(shuttle!.id);
    expect(await projectsOn(page, LC_LAYER.garagesCircle)).toEqual(r!.kept ? [garage.id] : []);
  });

  test('Timeline and Evidence open from the header (Menu on phones), axe clean', async ({
    page
  }) => {
    await (await headerAction(page, 'Timeline')).click();
    const timelineDlg = page.getByRole('dialog', { name: 'Project timeline' });
    await expect(timelineDlg).toBeVisible();
    for (const p of planFile.plan.projects)
      await expect(
        timelineDlg.getByRole('button', { name: `Evidence for ${p.label}`, exact: true })
      ).toBeAttached();
    await expectNoA11yViolations(page, { include: ['[data-testid=lc-timeline]'], structure: true });

    await timelineDlg
      .getByRole('button', { name: /^Evidence for / })
      .first()
      .click();
    const evidence = page.getByRole('dialog', { name: 'Evidence for every number' });
    await expect(evidence).toBeVisible();
    await expect(evidence.getByText('Assumption, not data').first()).toBeVisible();
    await expectNoA11yViolations(page, { include: ['[data-testid=lc-evidence]'], structure: true });
    await evidence.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(evidence).toBeHidden();

    await (await headerAction(page, 'Evidence')).click();
    await expect(evidence).toBeVisible();
  });

  test('axe on the page, with the details open and with a card open', async ({
    page,
    isMobile
  }) => {
    await expectNoA11yViolations(page);

    await page.getByTestId('lc-headline').click();
    await expect(page.getByRole('region', { name: 'Fewer-cars details' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByTestId('lc-headline').click();
    await expect(page.getByRole('region', { name: 'Fewer-cars details' })).toBeHidden();

    await openFreedCard(page, isMobile);
    await expectNoA11yViolations(page);
  });

  test('dark mode: axe on the page, the details and the timeline', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expectNoA11yViolations(page);

    await page.getByTestId('lc-headline').click();
    await expect(page.getByRole('region', { name: 'Fewer-cars details' })).toBeVisible();
    await page.getByText('Map key').click();
    await expectNoA11yViolations(page);
    await page.getByTestId('lc-headline').click();
    await expect(page.getByRole('region', { name: 'Fewer-cars details' })).toBeHidden();

    await (await headerAction(page, 'Timeline')).click();
    await expect(page.getByRole('dialog', { name: 'Project timeline' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['[data-testid=lc-timeline]'], structure: true });
  });

  test('375 px: no horizontal scroll, footer reachable with the details and a card open', async ({
    page,
    isMobile
  }) => {
    test.skip(!isMobile, 'mobile project only');
    const noScroll = async () => {
      const w = await page.evaluate(() => ({
        scroll: document.scrollingElement!.scrollWidth,
        inner: window.innerWidth
      }));
      expect(w.scroll).toBeLessThanOrEqual(w.inner);
    };
    await noScroll();
    await expectFooterReachable(page);
    await page.getByTestId('lc-headline').click();
    await expect(page.getByRole('region', { name: 'Fewer-cars details' })).toBeVisible();
    await noScroll();
    await page.getByTestId('lc-headline').click();
    await openFreedCard(page, true);
    await noScroll();
    await expectFooterReachable(page);
  });
});

// ---- a dataset without the plan -----------------------------------------------------------------

test('a dataset without scenarios.lesscars shows the not-in-dataset page and starts no worker', async ({
  page
}) => {
  // A first load takes the manifest from the server render, so strip it where the intercept
  // applies: the /lesscars load re-runs in the browser on a client navigation from /about.
  await page.route('**/data/fixture-0/manifest.json', async (route) => {
    const res = await route.fetch();
    const manifest = (await res.json()) as { scenarios?: Record<string, unknown> };
    delete manifest.scenarios?.lesscars;
    await route.fulfill({ response: res, json: manifest });
  });
  const lesscarsRequests: string[] = [];
  const workers: string[] = [];
  await gotoHydrated(page, '/about');
  page.on('request', (r) => {
    if (r.url().includes('/scenarios/lesscars/') || r.url().includes('/scenarios/fzp/'))
      lesscarsRequests.push(r.url());
  });
  page.on('worker', (w) => workers.push(w.url()));
  await page.evaluate(() => ((window as Window & { __spa?: boolean }).__spa = true));
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'Fewer cars', exact: true }).click();
  await expect(page).toHaveURL(/\/lesscars$/);
  await expect(page.getByText('This dataset has no fewer-cars plan yet.')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __spa?: boolean }).__spa)).toBe(true);
  await expect(page.getByTestId('map-root')).toHaveCount(0);
  expect(await page.evaluate(() => (window as LcWin).__sfhLessCars === undefined)).toBe(true);
  expect(lesscarsRequests).toEqual([]);
  expect(workers).toEqual([]);
});
