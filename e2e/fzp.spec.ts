// /fzp e2e (fzp-mode spec §6). Runs against the VITE_E2E build, which exposes window.__sfhFzp
// (src/lib/fzp/debug.ts) and window.__sfhMap. Fixture-0 files are read from disk; counts, ids and
// labels are derived from them, never hard-coded. Autoplay is on by default, so every test that
// needs a stable day emulates reduced motion first.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SOURCE_DATASETS } from '../src/lib/fzp/card';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { monthStart } from '../src/lib/fzp/time';
import { formatCount } from '../src/lib/scoreboard/format';
import { expectNoA11yViolations } from './helpers/a11y';
import { FRAME, jumpAndIdle, projectToPage, type LngLat, type Win } from './helpers/sharing';

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

const slider = (page: Page): Locator =>
  page.getByRole('slider', { name: 'Date in the simulation' });
const readout = (page: Page): Locator => page.getByTestId('fzp-readout');
const headline = (page: Page): Locator => page.getByTestId('fzp-net').first();
const anotherFuture = (page: Page): Locator => page.getByRole('button', { name: 'Another future' });
const scoreRegion = (page: Page): Locator =>
  page.getByRole('region', { name: 'Simulation scoreboard' });
const sourcesDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Where these numbers come from' });
const headerLink = (page: Page, name: string): Locator =>
  page.getByRole('banner').getByRole('link', { name, exact: true });
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

/** `/fzp` at a stable day (reduced motion stops autoplay), ready. */
async function gotoFzp(page: Page, search = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/fzp${search}`);
  await waitReady(page);
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
    for (let fy = 0.1; fy < 1; fy += 0.1) {
      for (let fx = 0.1; fx < 1; fx += 0.1) {
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

/** Opens the sources dialog (on the phone, through the scoreboard sheet). */
async function openSources(page: Page, isMobile: boolean): Promise<Locator> {
  if (isMobile) await scoreRegion(page).locator('button[aria-controls]').tap();
  await page.getByRole('button', { name: 'Where these numbers come from' }).click();
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
  await gotoFzp(page);
  expect(await fzp(page, 'phase')).toBe('ready');
  await expect(readout(page)).toContainText('October 2026');
  expect(await fzp(page, 'day')).toBe(await fzp(page, 'asOf'));

  const { baseline, shown, months } = JSON.parse(await scoreJson(page)) as {
    baseline: { completedNet: number };
    shown: { completedNet: number }[];
    months: number[];
  };

  await slider(page).focus();
  await page.keyboard.press('PageUp'); // away from the start, so Home has something to do
  await page.keyboard.press('Home');
  await expect(readout(page)).toContainText('October 2026');
  await expect(headline(page)).toHaveText(
    formatCount(baseline.completedNet + shown[0].completedNet)
  );

  await page.keyboard.press('End');
  await expect(readout(page)).toContainText('December 2050');
  expect(await fzp(page, 'day')).toBe(await fzp(page, 'horizon'));
  await expect(headline(page)).toHaveText(
    formatCount(baseline.completedNet + shown[months.length - 1].completedNet)
  );
});

// ---- reduced motion -----------------------------------------------------------------------------

test('reduced motion keeps the day at asOf; without it the day advances', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/fzp');
  await waitReady(page);
  await page.waitForTimeout(2_000);
  expect(await fzp(page, 'day')).toBe(await fzp(page, 'asOf'));
  expect(await fzp(page, 'playing')).toBe(false);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/fzp');
  await waitReady(page);
  const asOf = await fzp(page, 'asOf');
  await expect.poll(() => fzp(page, 'day'), { timeout: 5_000 }).toBeGreaterThan(asOf);
});

// ---- reroll -------------------------------------------------------------------------------------

test('Another future writes ?seed=N, keeps the day, and the URL seed reproduces the future', async ({
  page
}) => {
  await gotoFzp(page);
  const first = await fzp(page, 'seed');
  expect(await fzp(page, 'representative')).toBe(true);

  await slider(page).focus();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  const day = await fzp(page, 'day');
  expect(day).toBeGreaterThan(await fzp(page, 'asOf'));

  await anotherFuture(page).click();
  await expect(page).toHaveURL(/\/fzp\?seed=\d+$/);
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

test('after Another future, the header Timelapse link shows the representative future again', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'below 640 px the header shows only the Paint link on /fzp');
  await gotoFzp(page);
  const representative = await fzp(page, 'seed');
  expect(await fzp(page, 'representative')).toBe(true);

  await anotherFuture(page).click();
  await expect(page).toHaveURL(/\/fzp\?seed=\d+$/);
  const seed = Number(new URL(page.url()).searchParams.get('seed'));
  await expect.poll(() => fzp(page, 'seed')).toBe(seed);

  // The URL becomes /fzp, the URL of the last load, so SvelteKit does not rerun the load.
  await headerLink(page, 'Timelapse').click();
  await expect(page).toHaveURL(/\/fzp$/);
  await expect.poll(() => fzp(page, 'representative'), { timeout: 20_000 }).toBe(true);
  await waitReady(page);
  expect(await fzp(page, 'seed')).toBe(representative);
  expect(new URL(page.url()).searchParams.has('seed')).toBe(false);
});

test('/fzp twice shows the same representative future', async ({ page }) => {
  await gotoFzp(page);
  const seed = await fzp(page, 'seed');
  expect(seed).not.toBeNull();
  await page.goto('/fzp');
  await waitReady(page);
  expect(await fzp(page, 'seed')).toBe(seed);
  expect(await fzp(page, 'representative')).toBe(true);
});

// ---- the project card ---------------------------------------------------------------------------

test('tapping a real project opens its card with the DataSF source links', async ({
  isMobile,
  page
}) => {
  await gotoFzp(page);
  const c = await openRealCard(page, isMobile);
  await expect(c.getByTestId('card-badge')).toHaveText('Real project');
  expect(REAL.sources.length).toBeGreaterThan(0);
  for (const { dataset, id, key } of REAL.sources) {
    const known = SOURCE_DATASETS[dataset];
    const href = known
      ? `https://data.sf.gov/resource/${dataset}.json?${key ?? known.key}=${encodeURIComponent(id)}`
      : `https://data.sf.gov/d/${dataset}`;
    await expect(c.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

test('a phase of a multi-phase project reads "Phase n of m" once the scrubber reaches it', async ({
  isMobile,
  page
}) => {
  test.setTimeout(120_000);
  expect(SHIPYARD.multiPhase).toBe(true);
  const label = SHIPYARD.label!;
  await gotoFzp(page);
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
  for (let step = 0; step <= 26 && !found; step++) {
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

test('the sources dialog lists every parameter and every data check', async ({
  isMobile,
  page
}) => {
  await gotoFzp(page);
  const dialog = await openSources(page, isMobile);

  // One entry per calibration parameter: each present transition, the Local Program proxy, and the
  // six single-parameter models. The baseline, target and reference entries are not parameters.
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
    'src-phase-gap'
  ].sort();
  const ids = await dialog.locator('article[id]').evaluateAll((els) => els.map((el) => el.id));
  const parameters = ids.filter((id) => !/^src-(baseline|target-|reference-)/.test(id)).sort();
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
  // editor's load keeps the response SvelteKit replays, so reach /fzp by a client navigation from
  // a page that loads no manifest: its load then fetches the manifest from the browser.
  await page.route('**/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    delete manifest.scenarios;
    await route.fulfill({ response, json: manifest });
  });
  await page.goto('/about');
  await headerLink(page, 'Timelapse').click();
  await expect(page).toHaveURL(/\/fzp$/);

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
  await page.goto('/about');
  await headerLink(page, 'Timelapse').click();
  await expect(page).toHaveURL(/\/fzp$/);
  await expect(page.getByTestId('fzp-status')).toHaveText("The simulation couldn't load.");
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(await fzp(page, 'phase')).toBe('failed');
  await expectNoA11yViolations(page);
});

// ---- header and attribution ---------------------------------------------------------------------

test('the header links move between the editor and the timelapse', async ({ page }) => {
  await page.goto('/');
  await headerLink(page, 'Timelapse').click();
  await expect(page).toHaveURL(/\/fzp$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Family Zoning Plan timelapse/);
  await headerLink(page, 'Paint').click();
  await expect(page).toHaveURL(/\/$/);
});

test('/attribution carries the scenario notice', async ({ page }) => {
  await page.goto('/attribution');
  await expect(page.getByText(/^Housing project records \(building permits/)).toBeVisible();
});

// ---- accessibility and layout -------------------------------------------------------------------

test('axe: the card open', async ({ isMobile, page }) => {
  await gotoFzp(page);
  await openRealCard(page, isMobile);
  await expectNoA11yViolations(page);
});

test('axe: the sources dialog open', async ({ isMobile, page }) => {
  await gotoFzp(page);
  const dialog = await openSources(page, isMobile);
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

test('axe: a failed reroll, whose notice clears the card and the score panel', async ({
  isMobile,
  page
}) => {
  // A reroll makes no request, so no route can fail it. Instead the page's own reroll request is
  // given a seed the worker rejects (bad-request), and the real error path runs.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: never[]) {
      const m = msg as { type?: string };
      return post.call(this, m?.type === 'reroll' ? { ...m, seed: -1 } : msg, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  await gotoFzp(page);
  const c = await openRealCard(page, isMobile);
  await anotherFuture(page).click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText(/Couldn't make another future\. Try again\./);
  expect(await fzp(page, 'representative')).toBe(true);
  await expectNoA11yViolations(page);

  const overlap = async (): Promise<string[]> => {
    const a = (await alert.boundingBox())!;
    const panels = [c, scoreRegion(page).locator(':scope > div').filter({ visible: true }).first()];
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
  const widths = isMobile ? [375] : [1280, 1000, 768];
  for (const width of widths) {
    await page.setViewportSize({ width, height: isMobile ? 812 : 720 });
    await expect.poll(overlap, { message: `at ${width} px` }).toEqual([]);
  }
});

test('axe: the scoreboard sheet open (phone)', async ({ isMobile, page }) => {
  test.skip(!isMobile, 'the sheet exists below 768 px');
  await gotoFzp(page);
  await scoreRegion(page).locator('button[aria-controls]').tap();
  await expect(page.getByRole('group', { name: 'Simulation scoreboard details' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('footer links stay unobscured at 375 px: bars, card and sheet', async ({ isMobile, page }) => {
  test.skip(!isMobile, 'W6b is the phone layout');
  await gotoFzp(page);
  await expectFooterReachable(page);

  await openRealCard(page, isMobile);
  await expectFooterReachable(page);

  await scoreRegion(page).locator('button[aria-controls]').tap();
  const sheet = page.getByRole('group', { name: 'Simulation scoreboard details' });
  await expect(sheet).toBeVisible();
  await expectFooterReachable(page);
});
