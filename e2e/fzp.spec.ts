// The timelapse e2e (fzp-mode spec §6), on the simulation's timeline (the open game at `/`, no
// game seeded): these tests open the timelapse there. Runs against the VITE_E2E build, which exposes window.__sfhFzp (src/lib/fzp/debug.ts)
// and window.__sfhMap. Fixture-0 files are read from disk; counts, ids and labels are derived
// from them, never hard-coded. Nothing plays on open; the playhead reaches as far as the forecast
// is filled, so a test that scrubs or plays waits for the fill first (`waitFilled`). With Move
// (the default tool) a tap on a project opens its card.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SOURCE_DATASETS } from '../src/lib/fzp/card';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { monthStart } from '../src/lib/fzp/time';
import { formatPercent } from '../src/lib/scoreboard/format';
import { expectNoA11yViolations } from './helpers/a11y';
import { expectAboutReachable, expectNoFooter } from './helpers/chrome';
import { slider, waitFilled } from './helpers/run';
import {
  FRAME,
  gotoHydrated,
  jumpAndIdle,
  openHeaderMenu,
  projectToPage,
  tapProject,
  waitProjectAt,
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

/** The ruler's date flag over the playhead: 'Today', else the playhead's short month. */
const readout = (page: Page): Locator => page.getByTestId('tl-flag');
/** The header score: "{n} homes by {Mon YYYY}" at the playhead, "0 homes by today" at today. */
const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
/** Details, which the header score shows in the inspector. */
const results = (page: Page): Locator => page.getByTestId('tl-details');
/** Shows Details from the header score (once) and returns it. */
async function openScore(page: Page): Promise<Locator> {
  if ((await scoreBar(page).getAttribute('aria-expanded')) !== 'true') await scoreBar(page).click();
  await expect(results(page)).toBeVisible();
  return results(page);
}
/** About this model, over the map: what Details' last link opens on the simulation. */
const aboutDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'About this model' });
/** The header's site-name link, made visible first (below sm it can wait in the header Menu). */
async function siteName(page: Page): Promise<Locator> {
  await openHeaderMenu(page);
  return page.getByRole('banner').getByRole('link', { name: 'SF Housing', exact: true });
}
const card = (page: Page, name: string): Locator => page.getByRole('region', { name, exact: true });
/** The notice stack's status pills (a crash, failed cells). */
const statusPills = (page: Page): Locator => page.getByTestId('tl-notices');

function fzp<K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> {
  return page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;
}

/** Waits for the page to reach `ready` with the map up. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitForMapOnly(page);
}

async function waitForMapOnly(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
}

/** Where the timelapse is: the simulation at `/` (the open game: no game seeded). */
const FZP_PATH = '/';

/** The timelapse on the simulation, ready, the forecast filled to the window's end. */
async function gotoFzp(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FZP_PATH);
  await waitReady(page);
  await waitFilled(page);
}

/** A mouse click on desktop, a one-finger tap on the mobile project. */
async function pick(page: Page, isMobile: boolean, [x, y]: [number, number]): Promise<void> {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Centres the map on `lngLat` at `zoom`. */
async function frameOn(page: Page, lngLat: LngLat, zoom = FRAME.zoom): Promise<void> {
  await jumpAndIdle(page, { ...FRAME, center: lngLat, zoom });
}

/**
 * Opens the real project's card by picking its part at `lngLat`, once the map would pick it there
 * (a miss selects the lot's plan, whose sheet on a phone moves the map away). Off the map's centre
 * a taller neighbour nearer the centre can lean outwards over the label point: the pick then goes
 * a few pixels further out, past its roof.
 */
async function openCardAt(page: Page, isMobile: boolean, lngLat: LngLat): Promise<Locator> {
  await tapProject(page, isMobile, REAL.id, lngLat, { nudge: true });
  const c = card(page, REAL_LABEL);
  await expect(c).toBeVisible();
  return c;
}

/** Opens the real project's card on the parcel only it holds. */
async function openRealCard(page: Page, isMobile: boolean): Promise<Locator> {
  const at = LABELS.get(ownParcel(REAL))!;
  await frameOn(page, at);
  return openCardAt(page, isMobile, at);
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
    // A 5 % grid: on a phone the open card leaves only a band of canvas above it.
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

/** Opens About over the map from Details' last link ("How this is worked out"). */
async function openSources(page: Page): Promise<Locator> {
  await (await openScore(page)).getByRole('link', { name: 'How this is worked out' }).click();
  const dialog = aboutDialog(page);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  return dialog;
}

/** Throws an uncaught error in the simulation worker: its `onerror` is a real crash. */
async function crashWorker(page: Page): Promise<void> {
  const sim = page.workers().find((w) => /\/_app\/.*worker/.test(w.url()));
  expect(sim, `no simulation worker among ${page.workers().map((w) => w.url())}`).toBeTruthy();
  await sim!.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: simulated worker crash');
    });
  });
}

// ---- load and controls --------------------------------------------------------------------------

test('loads ready and the keyboard drives the playhead to both ends', async ({ page }) => {
  await gotoFzp(page);
  expect(await fzp(page, 'phase')).toBe('ready');
  const asOf = await fzp(page, 'asOf');
  expect(await fzp(page, 'day')).toBe(asOf);

  // End: the computed edge, the last row's last day once the forecast is filled.
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(() => fzp(page, 'day')).toBeGreaterThan(asOf);
  const end = await fzp(page, 'day');
  await expect(readout(page)).toHaveText(formatShortMonthYear(monthStart(end)));
  await expect(slider(page)).toHaveAttribute('aria-valuenow', String(end));
  await expect(slider(page)).toHaveAttribute('aria-valuemax', String(end));
  await expect(scoreBar(page)).toHaveText(/^[\d,]+ homes by [A-Z][a-z]{2} \d{4}$/);

  // Home: back to today.
  await page.keyboard.press('Home');
  await expect.poll(() => fzp(page, 'day')).toBe(asOf);
  await expect(readout(page)).toHaveText('Today');
  // The header score follows the playhead: at today it counts nothing yet.
  await expect(scoreBar(page)).toHaveText(/^0 homes by today$/);
});

// ---- playback start -----------------------------------------------------------------------------

test('nothing plays on open: the day stays at asOf until Play is pressed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(FZP_PATH);
  await waitReady(page);
  await waitFilled(page);
  const asOf = await fzp(page, 'asOf');
  expect(await fzp(page, 'day')).toBe(asOf);
  expect(await fzp(page, 'playing')).toBe(false);
  await expect(slider(page)).toBeEnabled();

  await page.getByTestId('tl-play').click();
  await expect.poll(() => fzp(page, 'playing')).toBe(true);
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a, asOf);
});

// ---- the project card ---------------------------------------------------------------------------

test('tapping a real project opens its card with the DataSF source links', async ({
  isMobile,
  page
}) => {
  await gotoFzp(page);
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
  // A step out from FRAME's zoom: the neighbours' extrusions lean less off-centre.
  await frameOn(page, at, FRAME.zoom - 1);
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

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [where, fx] of [
  ['left of the map', 0.3],
  ['right of the map', 0.78]
] as const) {
  test(`from md the card opens beside the building (${where}), inside the map`, async ({
    isMobile,
    page
  }) => {
    test.skip(isMobile, 'below md the card is a bottom sheet');
    // A map tall enough that the neighbours' extrusions lean clear of the lot off-centre.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await gotoFzp(page);
    const at = LABELS.get(ownParcel(REAL))!;
    await placeLot(page, at, fx, 0.5);
    const [x, y] = await projectToPage(page, at);
    const c = await openCardAt(page, isMobile, at);
    const box = (await c.boundingBox())!;
    const map = (await page.getByTestId('tl-map').boundingBox())!;
    // Right of the click by about a gap, or left of it when the right side would overflow.
    if (box.x > x) expect(box.x - x).toBeGreaterThanOrEqual(8);
    else expect(x - (box.x + box.width)).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width, 'the card stays inside the page').toBeLessThanOrEqual(1280);
    // Vertically centred on the click (or clamped inside the map): the click is beside it.
    expect(y).toBeGreaterThanOrEqual(box.y);
    expect(y).toBeLessThanOrEqual(box.y + box.height);
    expect(box.x, 'the card is inside the map').toBeGreaterThanOrEqual(map.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width + 0.5);
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
    // A map tall enough that the neighbours' extrusions lean clear of the lot off-centre.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await gotoFzp(page);
    const at = LABELS.get(ownParcel(REAL))!;
    await placeLot(page, at, fx, fy);
    const c = await openCardAt(page, isMobile, at);
    const box = (await c.boundingBox())!;
    const attribution = page.locator('.maplibregl-ctrl-bottom-right').first();
    const zoom = page.locator('.maplibregl-ctrl-bottom-left').first();
    // The card is tall: the real project's card with its timeline, notes and sources.
    expect(box.height).toBeGreaterThan(200);
    await expect(attribution).toBeVisible();
    expect(overlaps(box, (await attribution.boundingBox())!), 'covers the attribution').toBe(false);
    expect(overlaps(box, (await zoom.boundingBox())!), 'covers the zoom controls').toBe(false);
    // And clear of the timeline under the map.
    expect(overlaps(box, (await page.getByTestId('tl-dock').boundingBox())!)).toBe(false);
  });
}

test('from md the card follows its building when the map pans', async ({ isMobile, page }) => {
  test.skip(isMobile, 'below md the card is a bottom sheet');
  await gotoFzp(page);
  const at = LABELS.get(ownParcel(REAL))!;
  await placeLot(page, at, 0.45, 0.4);
  const c = await openCardAt(page, isMobile, at);
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
  await expect.poll(async () => (await c.boundingBox())!.x - before.x).toBeGreaterThan(100);
  await expect(c).toBeVisible();
});

test('from md the card clears a showing notice pill', async ({ isMobile, page }) => {
  test.skip(isMobile, 'below md the stack is in flow above the map');
  await gotoFzp(page);
  const at = LABELS.get(ownParcel(REAL))!;
  // The building near the map's top centre, where the pill stack overlays the map.
  await placeLot(page, at, 0.5, 0.06);
  await openCardAt(page, isMobile, at);

  // A real crash shows the "Part of the simulation stopped" pill.
  await crashWorker(page);
  const pill = statusPills(page).getByText('Part of the simulation stopped.');
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

test('a phase of a multi-phase project reads "Phase n of m" once the playhead reaches it', async ({
  isMobile,
  page
}) => {
  expect(SHIPYARD.multiPhase).toBe(true);
  const label = SHIPYARD.label!;
  await gotoFzp(page);
  // Both phase lots in one view: centred between them, wide enough for a 375 px map.
  const points = SHIPYARD.parcelIds.map((id) => LABELS.get(id)!);
  await frameOn(page, [(points[0][0] + points[1][0]) / 2, points[0][1]], 17);

  const phase = new RegExp(`^Phase (\\d+) of (\\d+), ${label}$`);
  const shipyard = card(page, label);
  const phaseLine = shipyard.getByText(phase);
  // At the window's end every phase that will start has started: pick the first phase lot where
  // the map draws one (a pick on a lot with no part is a miss, which selects the lot's plan).
  await slider(page).focus();
  await page.keyboard.press('End');
  // The map's clock at the playhead's new day: until then the parts drawn are today's.
  await page.waitForFunction(() => {
    const f = (window as FzpWin).__sfhFzp!;
    return f.day > f.asOf && (window as Win).__sfhMap?.timelineSnapshot()?.day === f.day;
  });
  await pick(page, isMobile, await waitProjectAt(page, SHIPYARD.id, points));
  await expect(phaseLine).toBeVisible();

  // "Phase n of m" with 1 <= n <= m, and that phase has filed its building permit by the playhead's
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
  await gotoFzp(page);
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
  await gotoFzp(page);
  const at = LABELS.get(ownParcel(REAL))!;
  await frameOn(page, at);
  const c = await openCardAt(page, isMobile, at);

  if (!isMobile) {
    await page.mouse.move(...(await emptyPoint(page, at)), { steps: 5 });
    // The hover tooltip answers the move (or hides): the card is still there after it.
    await expect(page.getByTestId('map-root').getByRole('tooltip')).toHaveCount(0);
    await expect(c).toBeVisible();
  }
  // On a phone the card covers most of the map, so show a stretch with no parts and click a bare
  // point of it (the open card stays: moving the map does not close it).
  await frameOn(page, [at[0], at[1] + 0.003]);
  await expect(c).toBeVisible();
  await pick(page, isMobile, await bareMapPoint(page));
  await expect(c).toBeHidden();
});

// ---- About's assumptions ----------------------------------------------------------------------

test("About's assumptions list every parameter and every data check", async ({ page }) => {
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
  // editor's load keeps the response SvelteKit replays, so reach the simulation by a client
  // navigation from a page that loads no manifest: its load then fetches the manifest from the
  // browser.
  await page.route('**/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    delete manifest.scenarios;
    await route.fulfill({ response, json: manifest });
  });
  await gotoHydrated(page, '/about');
  await (await siteName(page)).click();
  await expect(page).toHaveURL(/\/$/);

  const status = page.getByTestId('fzp-status');
  await expect(status).toContainText("isn't available for dataset fixture-0");
  await expect(status.getByRole('link', { name: 'Go to the editor' })).toBeVisible();
  // The page has mounted (a session would have started by now): no worker.
  await waitForMapOnly(page);
  expect(workers).toEqual([]);
  await expectNoA11yViolations(page);
});

test('a calibration that fails to load shows the failure with Retry, and passes axe', async ({
  page
}) => {
  // As above: a client navigation, so the browser fetches the calibration and the route can fail it.
  await page.route('**/scenarios/fzp/calibration.json', (route) => route.fulfill({ status: 500 }));
  await gotoHydrated(page, '/about');
  await (await siteName(page)).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('fzp-status')).toHaveText("The simulation couldn't load.");
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(await fzp(page, 'phase')).toBe('failed');
  await expectNoA11yViolations(page);
});

// ---- header and attribution ---------------------------------------------------------------------

test('the site name reaches the simulation by a client navigation', async ({ page }) => {
  await gotoHydrated(page, '/about');
  // A full page load would drop this mark; a client navigation keeps the window.
  await page.evaluate(() => {
    (window as Window & { __sfhMark?: string }).__sfhMark = 'kept';
  });
  await (await siteName(page)).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => (window as Window & { __sfhMark?: string }).__sfhMark)).toBe(
    'kept'
  );
  await expect(page).toHaveTitle('SF Housing');
  await expect(page.locator('h1')).toHaveCount(1);
});

test('/about carries the scenario notice', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByText(/^Housing project records \(building permits/)).toBeVisible();
});

// ---- accessibility and layout -------------------------------------------------------------------

test('axe: the card open', async ({ isMobile, page }) => {
  await gotoFzp(page);
  await openRealCard(page, isMobile);
  await expectNoA11yViolations(page);
});

test('axe: About open over the map', async ({ page }) => {
  await gotoFzp(page);
  const dialog = await openSources(page);
  await expect(dialog.locator('[id="src-quality"] tbody tr').first()).toBeVisible();
  await expectNoA11yViolations(page, { include: 'dialog[open]', structure: true });
});

test('axe: the crash chip', async ({ page }) => {
  await gotoFzp(page);
  // A real crash: an uncaught error in the simulation worker reaches its `onerror`. (No request
  // can do this: after ready the worker fetches only chunks, whose failures are chunk statuses.)
  await crashWorker(page);
  const chip = statusPills(page);
  await expect(chip).toContainText('Part of the simulation stopped.');
  await expect(chip.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a notice is a pill at the top: it moves nothing on desktop and pushes the map down on a phone', async ({
  isMobile,
  page
}) => {
  await gotoFzp(page);
  const mapRoot = page.getByTestId('map-root');
  const dock = page.getByTestId('tl-dock');
  const dockBefore = (await dock.boundingBox())!;
  const mapBefore = (await mapRoot.boundingBox())!;
  // The stack comes right after the header bar.
  const header = (await page.getByRole('banner').boundingBox())!;

  // A crash's pill shows and stays.
  await crashWorker(page);
  const stack = page.getByTestId('fzp-notices');
  await expect(stack).toContainText('Part of the simulation stopped.');
  const box = (await stack.boundingBox())!;

  if (isMobile) {
    // In flow, right under the header; the map starts below it.
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    await expect
      .poll(async () => (await mapRoot.boundingBox())!.y)
      .toBeGreaterThanOrEqual(box.y + box.height - 1);
  } else {
    // An overlay on the map's top: the map and the timeline keep their boxes.
    expect(box.y).toBeGreaterThanOrEqual(mapBefore.y);
    expect(box.y).toBeLessThan(mapBefore.y + 16);
    expect(await mapRoot.boundingBox()).toEqual(mapBefore);
    expect(await dock.boundingBox()).toEqual(dockBefore);
  }
});

test('axe: the Details face open', async ({ page }) => {
  await gotoFzp(page);
  await openScore(page);
  await expectNoA11yViolations(page);
});

test("About's Today's market states the market, from Details' link", async ({ page }) => {
  const market = calibration.market;
  expect(market, 'fixture-0 gains calibration.market at the Release 1 regeneration').toBeDefined();
  const { observed, implied } = market!.today;
  await gotoFzp(page);
  const face = await openScore(page);
  // Details holds no market paragraph now: it is About's (rule 5).
  await expect(face.getByTestId('fzp-market')).toHaveCount(0);
  await expectNoA11yViolations(page);

  const dialog = await openSources(page);
  const section = dialog.locator('[id="src-market"]');
  await expect(section).toContainText(String(observed.private));
  await expect(section).toContainText(String(Math.round(implied)));
  await expect(section).toContainText(formatPercent(observed.private / implied));
  await expect(dialog.getByText("Today's market", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('Assumption, not data').first()).toBeVisible();
  await expectNoA11yViolations(page, { include: 'dialog[open]', structure: true });
});

test('at 375 px a project card stays below the header, and the header score stays pressable', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoFzp(page);
  const c = await openRealCard(page, isMobile);
  const box = (await c.boundingBox())!;
  const header = (await page.getByRole('banner').boundingBox())!;
  expect(box.y, 'the card rises over the header').toBeGreaterThanOrEqual(
    header.y + header.height - 0.5
  );
  // The header score stays the topmost element at its centre, so it can be pressed.
  await scoreBar(page).click({ trial: true });
  const covered = await scoreBar(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(top && el.contains(top));
  });
  expect(covered, 'the header score is covered').toBe(false);
});

test('no footer; the About entry stays unobscured at 375 px: playhead, card and Details', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoFzp(page);
  await expectNoFooter(page);

  await openRealCard(page, isMobile);
  await expectNoFooter(page);

  await openScore(page);
  await expectNoFooter(page);
  await expectAboutReachable(page);
});
