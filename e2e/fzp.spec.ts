// /fzp e2e (fzp-mode spec §6). /fzp now redirects to /sim (plan 3, Call 14), so these
// tests open the timelapse there; e2e/sim.spec.ts covers the redirect itself. Runs against the
// VITE_E2E build, which exposes window.__sfhFzp (src/lib/fzp/debug.ts) and window.__sfhMap.
// Fixture-0 files are read from disk; counts, ids and labels are derived from them, never
// hard-coded. Playback starts paused, in Setup (spec §1): tests that scrub or play, or open a
// project card (cards open only in a run; in Set Policy a click selects a layer), start a run
// first (`gotoFzp(page, '', { run: true })`).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SOURCE_DATASETS } from '../src/lib/fzp/card';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { monthStart } from '../src/lib/fzp/time';
import { formatCount, formatPercent } from '../src/lib/scoreboard/format';
import { expectNoA11yViolations } from './helpers/a11y';
import { slider, startRun } from './helpers/run';
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

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

// ---- fixture-0 ----------------------------------------------------------------------------------

const DATA = new URL('./fixtures/data/fixture-0/', import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DATA), 'utf8')) as T;

interface FixtureProject {
  id: string;
  label: string | null;
  parcelIds: string[];
  sources: { dataset: string; id: string; key?: string }[];
  quality: string[];
  multiPhase: boolean;
}
interface ProjectsFixture {
  qualityRules: { id: string; label: string }[];
  projects: FixtureProject[];
}
interface CalibrationFixture {
  transitions: Record<string, Record<string, unknown>>;
  market?: {
    today: { observed: { all: number; private: number }; implied: number };
  };
  baselineFunding?: unknown;
}

const projectsFile = readJson<ProjectsFixture>('scenarios/fzp/projects.json');
const calibration = readJson<CalibrationFixture>('scenarios/fzp/calibration.json');
const projects = projectsFile.projects;

// Parcel label points (lng/lat), decoded from the chunk's 1e-7 degree integers.
const LABELS: Map<string, LngLat> = (() => {
  const chunk = readJson<{ id: string[]; label: number[] }>('parcels/50_25.json');
  return new Map(
    chunk.id.map((id, i) => [id, [chunk.label[2 * i] / 1e7, chunk.label[2 * i + 1] / 1e7]])
  );
})();

const projectById = (id: string): FixtureProject => {
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error(`fixture-0 has no project ${id}`);
  return p;
};

/** A parcel of `p` that no other project holds, so a pick there can only be `p`. */
function ownParcel(p: FixtureProject): string {
  const others = new Set(projects.filter((q) => q.id !== p.id).flatMap((q) => q.parcelIds));
  const own = p.parcelIds.find((id) => !others.has(id) && LABELS.has(id));
  if (!own) throw new Error(`${p.id} has no parcel of its own in the fixture chunk`);
  return own;
}

// The pipeline project the card tests open; it carries data-check marks (quality) in fixture-0.
const REAL = projectById('PRJ:2019-000001PRJ');
const REAL_LABEL = REAL.label ?? REAL.id;
const SHIPYARD = projectById('CASE:2007.0001PRX');

// ---- helpers ------------------------------------------------------------------------------------

const readout = (page: Page): Locator => page.getByTestId('fzp-readout-label');
/** The header score bar: "{n} homes added" at the scrubbed day. */
const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
/** "Another future", made visible first (below 1024 px it waits in the header Menu). */
const anotherFuture = (page: Page): Promise<Locator> => headerAction(page, 'Another future');
/** The dock's Results face (`data-testid="score-details"`), which the header score flips to. */
const scoreDetails = (page: Page): Locator => page.getByRole('region', { name: 'Results' });
/**
 * Flips the dock to Results from the header score (once), opens its Sources disclosure (the
 * future's controls and "Where these numbers come from" sit there) and returns it.
 */
async function openScore(page: Page): Promise<Locator> {
  if ((await scoreBar(page).getAttribute('aria-expanded')) !== 'true') await scoreBar(page).click();
  await expect(scoreDetails(page)).toBeVisible();
  const sources = scoreDetails(page).getByTestId('fzp-sources');
  if ((await sources.getAttribute('open')) === null) {
    await sources.locator(':scope > summary').click();
    await expect(sources).toHaveAttribute('open', '');
  }
  return scoreDetails(page);
}
const sourcesDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Where these numbers come from' });
/** A header mode link, made visible first (below 1024 px the links wait in the header Menu). */
async function headerLink(page: Page, name: string): Promise<Locator> {
  await openHeaderMenu(page);
  return page.getByRole('banner').getByRole('link', { name, exact: true });
}
const card = (page: Page, name: string): Locator => page.getByRole('region', { name, exact: true });

function fzp<K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> {
  return page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;
}

const scoreJson = (page: Page, field?: 'shown' | 'band'): Promise<string> =>
  page.evaluate((f) => {
    const s = (window as FzpWin).__sfhFzp!.score;
    return JSON.stringify(f ? s?.[f] : s);
  }, field);

/** Waits for the page to reach `ready` with the map up. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await waitForMapOnly(page);
}

async function waitForMapOnly(page: Page): Promise<void> {
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
}

/** Where /fzp's redirect lands: the timelapse on /sim, with the FZP comparison. */
const FZP_PATH = '/sim';
/** The address bar on the timelapse's representative future. */
const FZP_URL = /\/sim$/;
/** The address bar on the timelapse after a reroll to `seed` (any seed when omitted). */
const seedUrl = (seed?: number): RegExp => new RegExp(`/sim\\?seed=${seed ?? '\\d+'}$`);

/**
 * The timelapse (`/sim`, plus `search`'s parameters) at a stable day, ready. With `run`, a run is
 * started and paused at or just past asOf, so the scrubber, Play and the markers work.
 */
async function gotoFzp(
  page: Page,
  search = '',
  { run = false }: { run?: boolean } = {}
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(search ? `${FZP_PATH}?${search.replace(/^\?/, '')}` : FZP_PATH);
  await waitReady(page);
  if (run) await startRun(page);
}

/** A mouse click on desktop, a one-finger tap on the mobile project. */
async function pick(page: Page, isMobile: boolean, [x, y]: [number, number]): Promise<void> {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Centres the map on `lngLat` at `zoom`, then returns the page point of `at` (default centre). */
async function frameOn(page: Page, lngLat: LngLat, zoom = FRAME.zoom): Promise<void> {
  await jumpAndIdle(page, { ...FRAME, center: lngLat, zoom });
}

/** Picks the part at `lngLat` until the card named `name` shows (the first picks can race the data). */
async function openCardAt(
  page: Page,
  isMobile: boolean,
  lngLat: LngLat,
  name: string
): Promise<Locator> {
  const c = card(page, name);
  await expect(async () => {
    await pick(page, isMobile, await projectToPage(page, lngLat));
    await expect(c).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  return c;
}

/** Opens the real project's card on the parcel only it holds. */
async function openRealCard(page: Page, isMobile: boolean): Promise<Locator> {
  const at = LABELS.get(ownParcel(REAL))!;
  await frameOn(page, at);
  return openCardAt(page, isMobile, at, REAL_LABEL);
}

/** A page point on the map with no part under it, north of the fixture's parcel row. */
async function emptyPoint(page: Page, near: LngLat): Promise<[number, number]> {
  return projectToPage(page, [near[0], near[1] + 0.00018]);
}

/** A page point where the map canvas itself is the topmost element (no card, panel or bar over it). */
async function bareMapPoint(page: Page): Promise<[number, number]> {
  const point = await page.evaluate(() => {
    const canvas = (window as Win).__sfhMap!.map!.getCanvas();
    const r = canvas.getBoundingClientRect();
    // A 5 % grid: on a phone the open card leaves only a band of canvas above it (the scrubber
    // sits at the bottom edge, so the card ends low and its top sits ~70 px under the header).
    for (let fy = 0.05; fy < 1; fy += 0.05) {
      for (let fx = 0.05; fx < 1; fx += 0.05) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y) === canvas) return [x, y] as [number, number];
      }
    }
    return null;
  });
  expect(point, 'no part of the map canvas is uncovered').not.toBeNull();
  return point!;
}

/** Opens the sources dialog, through the dock's Results face. */
async function openSources(page: Page): Promise<Locator> {
  await (
    await openScore(page)
  )
    .getByRole('button', { name: 'Where these numbers come from' })
    .click();
  const dialog = sourcesDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
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

// ---- load and controls --------------------------------------------------------------------------

test('loads ready and the keyboard drives the scrubber to both ends', async ({ page }) => {
  await gotoFzp(page, '', { run: true });
  expect(await fzp(page, 'phase')).toBe('ready');
  // The paused run sits at asOf or a little past it (Pause lands a few frames in).
  expect(await fzp(page, 'day')).toBeGreaterThanOrEqual(await fzp(page, 'asOf'));
  expect(await fzp(page, 'runPhase')).toBe('run');

  const { baseline, shown, months } = JSON.parse(await scoreJson(page)) as {
    baseline: { completedNet: number };
    shown: { completedNet: number }[];
    months: number[];
  };

  await slider(page).focus();
  await page.keyboard.press('End');
  await expect(readout(page)).toHaveText('December 2066');
  expect(await fzp(page, 'day')).toBe(await fzp(page, 'horizon'));
  await expect(scoreBar(page)).toHaveText(
    `${formatCount(baseline.completedNet + shown[months.length - 1].completedNet)} homes added`
  );

  // Home is a scrub back to Today: the run ends and the page returns to Set Policy at asOf.
  await page.keyboard.press('Home');
  await expect.poll(() => fzp(page, 'runPhase')).toBe('setup');
  expect(await fzp(page, 'day')).toBe(await fzp(page, 'asOf'));
  await expect(readout(page)).toHaveText('October 2026');
  await expect(scoreBar(page)).toHaveText(
    `${formatCount(baseline.completedNet + shown[0].completedNet)} homes added`
  );
});

// ---- playback start -----------------------------------------------------------------------------

test('the day stays at asOf, in Setup with the scrubber disabled, until Run is pressed', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(FZP_PATH);
  await waitReady(page);
  await page.waitForTimeout(2_000);
  const asOf = await fzp(page, 'asOf');
  expect(await fzp(page, 'day')).toBe(asOf);
  expect(await fzp(page, 'playing')).toBe(false);
  expect(await fzp(page, 'runPhase')).toBe('setup');
  await expect(slider(page)).toBeDisabled();

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => fzp(page, 'day'), { timeout: 5_000 }).toBeGreaterThan(asOf);
});

// ---- reroll -------------------------------------------------------------------------------------

test('Another future writes ?seed=N, keeps the day, and the URL seed reproduces the future', async ({
  page
}) => {
  await gotoFzp(page, '', { run: true });
  const first = await fzp(page, 'seed');
  expect(await fzp(page, 'representative')).toBe(true);

  await slider(page).focus();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  const day = await fzp(page, 'day');
  expect(day).toBeGreaterThan(await fzp(page, 'asOf'));

  await (await anotherFuture(page)).click();
  await expect(page).toHaveURL(seedUrl());
  const seed = Number(new URL(page.url()).searchParams.get('seed'));
  await expect.poll(() => fzp(page, 'seed')).toBe(seed);
  expect(seed).not.toBe(first);
  expect(await fzp(page, 'representative')).toBe(false);
  expect(await fzp(page, 'day')).toBe(day);

  const shown = await scoreJson(page, 'shown');
  await page.reload();
  await waitReady(page);
  expect(await fzp(page, 'seed')).toBe(seed);
  expect(await scoreJson(page, 'shown')).toBe(shown);
});

/** The address bar's seed: a number, or null for the representative future. */
const addressSeed = (page: Page): number | null => {
  const raw = new URL(page.url()).searchParams.get('seed');
  return raw === null ? null : Number(raw);
};

/**
 * Waits until the page shows the future the address bar names: that seed and not representative,
 * or (with no seed) the representative future, `representative` when given.
 */
async function expectAddressFuture(page: Page, representative?: number | null): Promise<void> {
  const want = addressSeed(page);
  if (want === null) {
    await expect.poll(() => fzp(page, 'representative'), { timeout: 20_000 }).toBe(true);
    if (representative !== undefined) expect(await fzp(page, 'seed')).toBe(representative);
  } else {
    await expect.poll(() => fzp(page, 'seed'), { timeout: 20_000 }).toBe(want);
    expect(await fzp(page, 'representative')).toBe(false);
  }
  expect(await fzp(page, 'phase')).toBe('ready');
}

/** Another future: waits for the ?seed=N answer and returns N. */
async function reroll(page: Page): Promise<number> {
  await (await anotherFuture(page)).click();
  await expect(page).toHaveURL(seedUrl());
  const seed = addressSeed(page)!;
  await expect.poll(() => fzp(page, 'seed')).toBe(seed);
  return seed;
}

test('after Another future, the header Simulate link, Back and Forward each show the URL future', async ({
  page
}) => {
  await gotoFzp(page);
  expect(await fzp(page, 'representative')).toBe(true);
  const seed = await reroll(page);

  // The Simulate link is /sim (a new load): its representative future.
  await (await headerLink(page, 'Simulate')).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expectAddressFuture(page);
  await waitReady(page);

  // Back to the rerolled entry: SvelteKit navigates to the URL it stored before replaceState
  // (/sim?seed=N before the reroll), but the address bar reads the rerolled seed, and the page must show #N.
  await page.goBack();
  await expect(page).toHaveURL(seedUrl(seed));
  await expectAddressFuture(page);
  await page.goForward();
  await expect(page).toHaveURL(/\/sim$/);
  await expectAddressFuture(page);
});

test('Back from another route onto a rerolled timelapse shows the rerolled future', async ({
  page
}) => {
  await gotoFzp(page);
  const seed = await reroll(page);
  await (await headerLink(page, 'Paint')).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(seedUrl(seed));
  await expectAddressFuture(page);
});

test('Back onto the timelapse after the way back from ?seed=N shows the representative future', async ({
  page
}) => {
  await gotoFzp(page, '?seed=5');
  await expectAddressFuture(page);
  await (
    await openScore(page)
  )
    .getByRole('button', { name: 'Back to the representative future' })
    .click();
  await expect(page).toHaveURL(FZP_URL);
  await expect.poll(() => fzp(page, 'representative')).toBe(true);
  const representative = await fzp(page, 'seed');

  // Leave by a client navigation, so Back is SvelteKit's popstate (it stored ?seed=5).
  await (await headerLink(page, 'Paint')).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(FZP_URL);
  await expectAddressFuture(page, representative);
});

test('the timelapse twice shows the same representative future', async ({ page }) => {
  await gotoFzp(page);
  const seed = await fzp(page, 'seed');
  expect(seed).not.toBeNull();
  await page.goto(FZP_PATH);
  await waitReady(page);
  expect(await fzp(page, 'seed')).toBe(seed);
  expect(await fzp(page, 'representative')).toBe(true);
});

// ---- the project card ---------------------------------------------------------------------------

test('tapping a real project opens its card with the DataSF source links', async ({
  isMobile,
  page
}) => {
  await gotoFzp(page, '', { run: true });
  const c = await openRealCard(page, isMobile);
  await expect(c.getByTestId('card-badge')).toHaveText('Real project');
  // Nothing but FZP sets this lot's limit here: no "Allowed by" line.
  await expect(c.getByTestId('card-allowed-by')).toHaveCount(0);
  expect(REAL.sources.length).toBeGreaterThan(0);
  for (const { dataset, id, key } of REAL.sources) {
    const known = SOURCE_DATASETS[dataset];
    const href = known
      ? `https://data.sf.gov/resource/${dataset}.json?${key ?? known.key}=${encodeURIComponent(id)}`
      : `https://data.sf.gov/d/${dataset}`;
    await expect(c.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

/**
 * Pans the map so `at` sits at (`fx`, `fy`) of the map canvas, as fractions of its width and
 * height, then waits for it to settle.
 */
async function placeLot(page: Page, at: LngLat, fx: number, fy: number): Promise<void> {
  await frameOn(page, at);
  await page.evaluate(
    ([ll, ax, ay]) =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        const p = map.project(ll as [number, number]);
        const r = map.getCanvas().getBoundingClientRect();
        map.once('idle', () => resolve());
        map.panBy([p.x - (ax as number) * r.width, p.y - (ay as number) * r.height], {
          animate: false
        });
      }),
    [at, fx, fy] as const
  );
}

/** The dock's box: the open panel or the rail. */
const dockBox = async (page: Page) =>
  (await page.locator('.sfh-dock-panel, .sfh-dock-rail').first().boundingBox())!;

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [where, fx] of [
  ['left of the map', 0.3],
  ['right of the map', 0.78]
] as const) {
  test(`from md the card opens beside the building (${where}), clear of the dock`, async ({
    isMobile,
    page
  }) => {
    test.skip(isMobile, 'below md the card is a bottom sheet');
    await gotoFzp(page, '', { run: true });
    const at = LABELS.get(ownParcel(REAL))!;
    await placeLot(page, at, fx, 0.5);
    const [x, y] = await projectToPage(page, at);
    const c = await openCardAt(page, isMobile, at, REAL_LABEL);
    const box = (await c.boundingBox())!;
    const dock = await dockBox(page);
    // Right of the click by about a gap, or left of it when the right side would overflow.
    if (box.x > x) expect(box.x - x).toBeGreaterThanOrEqual(8);
    else expect(x - (box.x + box.width)).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width, 'the card stays inside the page').toBeLessThanOrEqual(1280);
    // Vertically centred on the click (or clamped inside the map): the click is beside it.
    expect(y).toBeGreaterThanOrEqual(box.y);
    expect(y).toBeLessThanOrEqual(box.y + box.height);
    expect(box.x, 'the card is right of the dock').toBeGreaterThanOrEqual(
      dock.x + dock.width - 0.5
    );
    expect(overlaps(box, dock)).toBe(false);
    if (fx > 0.5) expect(box.x + box.width).toBeLessThan(x);
  });
}

for (const [where, fx, fy] of [
  ['low on the right', 0.6, 0.65],
  ['low beside the zoom controls', 0.3, 0.65]
] as const) {
  test(`from md a tall card (${where}) stays off the attribution and the zoom controls`, async ({
    isMobile,
    page
  }) => {
    test.skip(isMobile, 'below md the card is a bottom sheet');
    await gotoFzp(page, '', { run: true });
    const at = LABELS.get(ownParcel(REAL))!;
    await placeLot(page, at, fx, fy);
    const c = await openCardAt(page, isMobile, at, REAL_LABEL);
    const box = (await c.boundingBox())!;
    const attribution = page.locator('.maplibregl-ctrl-bottom-right').first();
    const zoom = page.locator('.maplibregl-ctrl-bottom-left').first();
    // The card is tall: the real project's card with its timeline, notes and sources.
    expect(box.height).toBeGreaterThan(300);
    await expect(attribution).toBeVisible();
    expect(overlaps(box, (await attribution.boundingBox())!), 'covers the attribution').toBe(false);
    expect(overlaps(box, (await zoom.boundingBox())!), 'covers the zoom controls').toBe(false);
    // And still clear of the time bar.
    expect(overlaps(box, (await page.getByTestId('fzp-scrubber').boundingBox())!)).toBe(false);
  });
}

test('from md the card follows its building when the map pans', async ({ isMobile, page }) => {
  test.skip(isMobile, 'below md the card is a bottom sheet');
  await gotoFzp(page, '', { run: true });
  const at = LABELS.get(ownParcel(REAL))!;
  await placeLot(page, at, 0.45, 0.4);
  const c = await openCardAt(page, isMobile, at, REAL_LABEL);
  const before = (await c.boundingBox())!;
  const [x0] = await projectToPage(page, at);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.panBy([-120, 0], { animate: false }); // the view moves west: the building moves east
      })
  );
  const [x1] = await projectToPage(page, at);
  expect(x1 - x0).toBeGreaterThan(100);
  await expect
    .poll(async () => (await c.boundingBox())!.x - before.x, { timeout: 5_000 })
    .toBeGreaterThan(100);
  await expect(c).toBeVisible();
});

test('from md the card clears a showing notice pill', async ({ isMobile, page }) => {
  test.skip(isMobile, 'below md the stack is in flow above the map');
  await gotoFzp(page, '', { run: true });
  const at = LABELS.get(ownParcel(REAL))!;
  // The building near the map's top centre, where the pill stack overlays the map.
  await placeLot(page, at, 0.5, 0.06);
  await openCardAt(page, isMobile, at, REAL_LABEL);

  // A real crash shows the "Part of the simulation stopped" pill.
  const sim = page.workers().find((w) => /\/_app\/.*worker/.test(w.url()));
  expect(sim, 'no simulation worker').toBeTruthy();
  await sim!.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: simulated worker crash');
    });
  });
  const pill = page.getByTestId('fzp-notices').getByText('Part of the simulation stopped.');
  await expect(pill).toBeVisible();
  // The card asks again for the day and finds the worker gone: it stays, saying so.
  const c = card(page, 'Project details');
  await expect(c).toBeVisible();
  await expect
    .poll(
      async () => {
        const a = (await pill.boundingBox())!;
        const b = (await c.boundingBox())!;
        return overlaps(a, b);
      },
      { message: 'the card overlaps the pill' }
    )
    .toBe(false);
  // Pushed down, not sideways: it sits under the pill.
  const a = (await page.getByTestId('fzp-notices').boundingBox())!;
  expect((await c.boundingBox())!.y).toBeGreaterThanOrEqual(a.y + a.height);
});

test('a phase of a multi-phase project reads "Phase n of m" once the scrubber reaches it', async ({
  isMobile,
  page
}) => {
  test.setTimeout(120_000);
  expect(SHIPYARD.multiPhase).toBe(true);
  const label = SHIPYARD.label!;
  await gotoFzp(page, '', { run: true });
  // Both phase lots in one view: centred between them, wide enough for a 375 px map.
  const points = SHIPYARD.parcelIds.map((id) => LABELS.get(id)!);
  await frameOn(page, [(points[0][0] + points[1][0]) / 2, points[0][1]], 17);

  const phase = new RegExp(`^Phase (\\d+) of (\\d+), ${label}$`);
  const horizon = await fzp(page, 'horizon');
  const shipyard = card(page, label);
  const phaseLine = shipyard.getByText(phase);
  // `isVisible` does not wait; this does, and says whether the line appeared.
  const appears = (loc: Locator): Promise<boolean> =>
    expect(loc)
      .toBeVisible({ timeout: 1_000 })
      .then(
        () => true,
        () => false
      );
  let found = false;
  // PageUp is one year; the horizon bounds the loop.
  for (let step = 0; step <= 42 && !found; step++) {
    for (const at of points) {
      await pick(page, isMobile, await projectToPage(page, at));
      found = await appears(phaseLine);
      if (found) break;
    }
    if (found || (await fzp(page, 'day')) >= horizon) break;
    await slider(page).press('PageUp');
  }
  expect(found, `no phase of ${label} was pickable before the horizon`).toBe(true);

  // "Phase n of m" with 1 <= n <= m, and that phase has filed its building permit by the scrubbed
  // day: the "This phase" timeline carries a "Building permit filed" row dated on or before it.
  const [, n, m] = phase.exec((await phaseLine.textContent())!.trim())!;
  expect(Number(n)).toBeGreaterThanOrEqual(1);
  expect(Number(n)).toBeLessThanOrEqual(Number(m));
  const filedRow = shipyard
    .locator('h4:has-text("This phase") + ol li')
    .filter({ hasText: 'Building permit filed' });
  await expect(filedRow).toHaveCount(1);
  // "Building permit filed · Mar 2027 · Simulated" or, for a recorded date, "Mar 4, 2027".
  const date = /· ([A-Z][a-z]{2}) (?:\d{1,2}, )?(\d{4}) ·/.exec((await filedRow.textContent())!);
  expect(date, 'the filed row has a date').not.toBeNull();
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  const filedMonth = Date.UTC(Number(date![2]), month.indexOf(date![1]), 1) / 86_400_000;
  expect(filedMonth).toBeLessThanOrEqual(monthStart(await fzp(page, 'day')));
});

test('a record the data checks changed lists them under "About this record\'s data"', async ({
  isMobile,
  page
}) => {
  expect(REAL.quality.length).toBeGreaterThan(0);
  await gotoFzp(page, '', { run: true });
  const c = await openRealCard(page, isMobile);
  await expect(c.getByRole('heading', { name: "* About this record's data" })).toBeVisible();
  for (const id of REAL.quality) {
    const rule = projectsFile.qualityRules.find((r) => r.id === id)!;
    await expect(c.getByText(rule.label)).toBeVisible();
  }
});

test('clicking empty map closes the card; moving the pointer off the part does not', async ({
  isMobile,
  page
}) => {
  await gotoFzp(page, '', { run: true });
  const at = LABELS.get(ownParcel(REAL))!;
  await frameOn(page, at);
  const c = await openCardAt(page, isMobile, at, REAL_LABEL);

  if (!isMobile) {
    await page.mouse.move(...(await emptyPoint(page, at)), { steps: 5 });
    await page.waitForTimeout(300);
    await expect(c).toBeVisible();
  }
  // On a phone the card covers most of the map, so show a stretch with no parts and click a bare
  // point of it (the open card stays: moving the map does not close it).
  await frameOn(page, [at[0], at[1] + 0.003]);
  await expect(c).toBeVisible();
  await pick(page, isMobile, await bareMapPoint(page));
  await expect(c).toBeHidden();
});

// ---- the sources dialog -------------------------------------------------------------------------

test('the sources dialog lists every parameter and every data check', async ({ page }) => {
  await gotoFzp(page);
  const dialog = await openSources(page);

  // One entry per calibration parameter: each present transition, the Local Program proxy, and the
  // six single-parameter models, today's market level (fixture-0 carries calibration.market) and,
  // when the market level is 'private' (market and baseline funding both present), the market slope.
  // The baseline, target and reference entries and the public-money entries (finance constants and
  // baseline funding provenance) are not calibration parameters.
  const expected = [
    ...Object.entries(calibration.transitions).flatMap(([pathway, stages]) =>
      Object.keys(stages)
        .filter((stage) => stage !== 'complete')
        .map((stage) => `src-transition-${pathway}-${stage}`)
    ),
    'src-local-program',
    'src-initiation-model',
    'src-size-model',
    'src-revision-model',
    'src-pathway-for-new',
    'src-ppa-share',
    'src-phase-gap',
    'src-market-today',
    ...(calibration.market && calibration.baselineFunding ? ['src-market-slope'] : [])
  ].sort();
  const ids = await dialog.locator('article[id]').evaluateAll((els) => els.map((el) => el.id));
  const parameters = ids
    .filter((id) => !/^src-(baseline|target-|reference-|money-)/.test(id))
    .sort();
  expect(parameters).toEqual(expected);

  // Section 10: one row per rule in projects.json, in file order, once the file has loaded.
  const rows = dialog.locator('[id="src-quality"] tbody tr');
  await expect(rows).toHaveCount(projectsFile.qualityRules.length);
  await expect(rows.locator('td:first-child')).toHaveText(
    projectsFile.qualityRules.map((r) => r.label)
  );
});

// ---- no scenario --------------------------------------------------------------------------------

test('a dataset without scenarios shows the message and starts no worker', async ({ page }) => {
  const workers: string[] = [];
  // MapLibre's own tile worker is not the simulation worker.
  page.on('worker', (w) => {
    if (!/maplibre/i.test(w.url())) workers.push(w.url());
  });
  // The manifest is stripped on the way in. SSR and hydration read the server's copy, and the
  // editor's load keeps the response SvelteKit replays, so reach /sim by a client navigation from
  // a page that loads no manifest: its load then fetches the manifest from the browser.
  await page.route('**/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    delete manifest.scenarios;
    await route.fulfill({ response, json: manifest });
  });
  await gotoHydrated(page, '/about');
  await (await headerLink(page, 'Simulate')).click();
  await expect(page).toHaveURL(/\/sim$/);

  const status = page.getByTestId('fzp-status');
  await expect(status).toContainText("isn't available for dataset fixture-0");
  await expect(status.getByRole('link', { name: 'Go to the editor' })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(workers).toEqual([]);
  await expectNoA11yViolations(page);
});

test('a calibration that fails to load shows the failure with Retry, and passes axe', async ({
  page
}) => {
  // As above: a client navigation, so the browser fetches the calibration and the route can fail it.
  await page.route('**/scenarios/fzp/calibration.json', (route) => route.fulfill({ status: 500 }));
  await gotoHydrated(page, '/about');
  await (await headerLink(page, 'Simulate')).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expect(page.getByTestId('fzp-status')).toHaveText("The simulation couldn't load.");
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(await fzp(page, 'phase')).toBe('failed');
  await expectNoA11yViolations(page);
});

// ---- header and attribution ---------------------------------------------------------------------

test('the header links move between the editor and the simulation', async ({ page }) => {
  await page.goto('/');
  await (await headerLink(page, 'Simulate')).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expect(page).toHaveTitle('Policy simulation · SF Housing Simulator');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Housing policy simulation');
  await (await headerLink(page, 'Paint')).click();
  await expect(page).toHaveURL(/\/$/);
});

test('/attribution carries the scenario notice', async ({ page }) => {
  await page.goto('/attribution');
  await expect(page.getByText(/^Housing project records \(building permits/)).toBeVisible();
});

// ---- accessibility and layout -------------------------------------------------------------------

test('axe: the card open', async ({ isMobile, page }) => {
  await gotoFzp(page, '', { run: true });
  await openRealCard(page, isMobile);
  await expectNoA11yViolations(page);
});

test('axe: the sources dialog open', async ({ page }) => {
  await gotoFzp(page);
  const dialog = await openSources(page);
  await expect(dialog.locator('[id="src-quality"] tbody tr').first()).toBeVisible();
  await expectNoA11yViolations(page, { include: 'dialog[open]', structure: true });
});

test('axe: the crash chip', async ({ page }) => {
  await gotoFzp(page);
  // A real crash: an uncaught error in the simulation worker reaches its `onerror`. (No request
  // can do this: after ready the worker fetches only chunks, whose failures are chunk statuses.)
  const sim = page.workers().find((w) => /\/_app\/.*worker/.test(w.url()));
  expect(sim, `no simulation worker among ${page.workers().map((w) => w.url())}`).toBeTruthy();
  await sim!.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: simulated worker crash');
    });
  });
  const chip = page.getByTestId('fzp-status');
  await expect(chip).toContainText('Part of the simulation stopped.');
  await expect(chip.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('axe: a failed reroll, whose notice clears the card', async ({ isMobile, page }) => {
  // A reroll makes no request, so no route can fail it. Instead the page's own reroll request is
  // given a seed the worker rejects (bad-request), and the real error path runs.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: never[]) {
      const m = msg as { type?: string };
      return post.call(this, m?.type === 'reroll' ? { ...m, seed: -1 } : msg, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  await gotoFzp(page, '', { run: true });
  const c = await openRealCard(page, isMobile);
  await (await anotherFuture(page)).click();
  const alert = page.getByRole('alert').filter({ hasText: "Couldn't make another future" });
  await expect(alert).toHaveText(/Couldn't make another future\. Try again\./);
  // A refused reroll leaves the policy in force: no lever failure alert.
  await expect(page.getByTestId('fzp-lever-failed')).toHaveText('');
  expect(await fzp(page, 'representative')).toBe(true);
  await expectNoA11yViolations(page);

  const overlap = async (): Promise<string[]> => {
    const a = (await alert.boundingBox())!;
    // The open score details (z-50) deliberately overlay the pill stack; the card is in the map.
    const panels = [c];
    const hits: string[] = [];
    for (const p of panels) {
      const b = (await p.boundingBox())!;
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        hits.push(JSON.stringify({ alert: a, panel: b }));
    }
    return hits;
  };
  // On a phone the pill stack is in flow above the map, so it never meets the card. From md it
  // is an overlay (z-30) at the map's top centre and may cross the card's top; it takes no space.
  if (!isMobile) return;
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(overlap, { message: 'at 375 px' }).toEqual([]);
});

test('a notice is a pill at the top: it moves nothing on desktop and pushes the map down on a phone', async ({
  isMobile,
  page
}) => {
  // The page's own reroll request is given a seed the worker rejects, so the failed-reroll notice
  // shows and stays (the same route as the axe test above).
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: never[]) {
      const m = msg as { type?: string };
      return post.call(this, m?.type === 'reroll' ? { ...m, seed: -1 } : msg, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  await gotoFzp(page);
  const mapRoot = page.getByTestId('map-root');
  const bar = page.getByTestId('fzp-scrubber');
  const barBefore = (await bar.boundingBox())!;
  const mapBefore = (await mapRoot.boundingBox())!;
  const header = (await page.getByRole('banner').boundingBox())!;

  await (await anotherFuture(page)).click();
  const alert = page.getByRole('alert').filter({ hasText: "Couldn't make another future" });
  await expect(alert).toBeVisible();
  const stack = page.getByTestId('fzp-notices');
  await expect(stack).toContainText("Couldn't make another future");
  const box = (await stack.boundingBox())!;

  if (isMobile) {
    // In flow, right under the header; the map starts below it and is shorter by the stack.
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    await expect
      .poll(async () => (await mapRoot.boundingBox())!.y)
      .toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect((await mapRoot.boundingBox())!.height).toBeLessThan(mapBefore.height);
  } else {
    // An overlay on the map's top: the map and the time bar keep their boxes.
    expect(box.y).toBeGreaterThanOrEqual(mapBefore.y);
    expect(box.y).toBeLessThan(mapBefore.y + 16);
    expect(await mapRoot.boundingBox()).toEqual(mapBefore);
    expect(await bar.boundingBox()).toEqual(barBefore);
  }
});

test('axe: the Results face open', async ({ page }) => {
  await gotoFzp(page);
  await openScore(page);
  await expectNoA11yViolations(page);
});

test("Results' Sources state today's market", async ({ page }) => {
  const market = calibration.market;
  expect(market, 'fixture-0 gains calibration.market at the Release 1 regeneration').toBeDefined();
  const { observed, implied } = market!.today;
  await gotoFzp(page);
  const results = await openScore(page);
  const paragraph = results.getByTestId('fzp-market');
  await expect(paragraph).toContainText(String(observed.private));
  await expect(paragraph).toContainText(String(Math.round(implied)));
  await expect(paragraph).toContainText(formatPercent(observed.private / implied));
  await expectNoA11yViolations(page);

  await results.getByRole('button', { name: 'Where these numbers come from' }).click();
  const dialog = sourcesDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Today's market", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('Assumption, not data').first()).toBeVisible();
  await expectNoA11yViolations(page, { include: 'dialog[open]', structure: true });
});

test('at 375 px in a run, a project card stays below the header while Results peeks', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoFzp(page, '', { run: true });
  // The run peeks Results above the time bar, which lifts the map's bottom inset.
  await expect(page.getByTestId('dock-handle')).toHaveText('Results');
  const c = await openRealCard(page, isMobile);
  const box = (await c.boundingBox())!;
  const region = (await page.getByTestId('map-root').boundingBox())!;
  expect(box.y, 'the card rises above the map').toBeGreaterThanOrEqual(region.y - 0.5);
  // The header score stays the topmost element at its centre, so it can be pressed.
  await scoreBar(page).click({ trial: true, timeout: 2_000 });
  const covered = await scoreBar(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(top && el.contains(top));
  });
  expect(covered, 'the header score is covered').toBe(false);
});

test('footer links stay unobscured at 375 px: scrubber, card and score details', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'W6b is the phone layout');
  await gotoFzp(page, '', { run: true });
  await expectFooterReachable(page);

  await openRealCard(page, isMobile);
  await expectFooterReachable(page);

  await openScore(page);
  await expectFooterReachable(page);
});
