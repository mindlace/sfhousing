// /sim publishing e2e (plan 5, Task 7; schema 4 since timeline-ui rule 40): publish a policy and
// open its /s/<id> link, Remix, the autosave across a reload, a tampered and a gone-dataset policy
// seeded through the e2e-only route, the /p -> /s redirect, schema 2 documents (a link and an
// autosave record) opening with the "upgraded" notice, storage refused, and the accessibility and
// layout checks on the read-only view. Runs against the VITE_E2E build on fixture-0. Seeded
// documents are captured from the app's own autosave, never hand-written, so they follow the
// SimDoc4 shape.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, openKind, waitFilled } from './helpers/run';
import { SIM_KEY, SIM_KEY_V1, openPublish, seedPlanRow, type Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };
type Span = { from: number; to: number | null; what: Record<string, unknown> };
type Policy = { id: string; label: string; preset: string | null; spans: Span[] };
type Doc = {
  schema: number;
  datasetVersion: string;
  title?: string;
  policy: { schema: number; kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] } };
  [k: string]: unknown;
};

/** A whole stored schema-2 policy document (src/lib/sim-page/fixtures/schema2/painted.json). */
const SCHEMA2_TEXT = readFileSync(
  new URL('../src/lib/sim-page/fixtures/schema2/painted.json', import.meta.url),
  'utf8'
);
const PRESET = "Permits at San Diego's pace";
const TIMING_NOTICE = 'Some permitting timelines were re-fit to the data this simulation runs on.';
const UPGRADED = /Saved before policies had dates\. Each starts [A-Z][a-z]+ \d{4}\./;
const ID = '[1-9A-HJ-NP-Za-km-z]{8}';

// ---- helpers (as in e2e/sim.spec.ts, which keeps its own copies) ---------------------------------

/**
 * The session is ready and the forecast filled. Needs no map: the worker runs the session whether
 * or not the map has loaded.
 */
async function waitSession(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

/** The page is ready, the map is up and the forecast filled. */
async function waitReady(page: Page): Promise<void> {
  await waitSession(page);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
}

async function gotoSim(page: Page, path = '/sim', { map = true } = {}): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await (map ? waitReady(page) : waitSession(page));
}

const editor = (page: Page): Locator => page.getByTestId('inspector');

/** Closes the editor if it shows. */
async function closeEditor(page: Page): Promise<void> {
  const close = editor(page).getByRole('button', { name: 'Close editor' });
  if (await close.isVisible()) await close.click();
  await expect(editor(page)).toHaveCount(0);
}

/** Adds the San Diego preset as a permitting policy. */
async function choosePreset(page: Page): Promise<void> {
  await addPolicy(page, 'Permitting', PRESET);
  await expect(editor(page).getByTestId('timing-label')).toHaveText(PRESET);
}

/** Selects a policy's first bar (its kind opened first) and returns the editor. */
async function selectPolicy(
  page: Page,
  kind: 'Zoning' | 'Permitting' | 'Public money',
  label: string
): Promise<Locator> {
  await openKind(page, kind);
  await page
    .getByRole('button', {
      name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}, `)
    })
    .last()
    .click();
  await expect(editor(page).getByRole('heading', { name: label })).toBeVisible();
  return editor(page);
}

/** The autosaved document, or null. */
const storedDoc = (page: Page): Promise<Doc | null> =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : (JSON.parse((JSON.parse(raw) as { plan: string }).plan) as Doc);
  }, SIM_KEY);

/**
 * A fixture-0 policy with the San Diego preset, as the app autosaves it: added on /sim, then read
 * back from storage once written.
 */
async function capturePresetDoc(page: Page): Promise<Doc> {
  // The autosave needs no map (the tests that open the seeded policy wait for theirs).
  await gotoSim(page, '/sim', { map: false });
  await choosePreset(page);
  await expect
    .poll(async () => (await storedDoc(page))?.policy.kinds.permitting[0]?.preset)
    .toBe('benchmarkPermits');
  return (await storedDoc(page))!;
}

/** Seeds `doc` as a policy row and returns its id. */
async function seedPolicy(page: Page, doc: Doc): Promise<string> {
  return seedPlanRow(page.request, {
    body: JSON.stringify(doc),
    datasetVersion: doc.datasetVersion,
    kind: 'sim'
  });
}

/** The San Diego preset with every preset timer's scale tampered to 0.3 (Call 7's refit). */
function tampered(doc: Doc): Doc {
  const [timing] = doc.policy.kinds.permitting;
  const spans = timing.spans.map((s) => {
    const set = s.what.set as { presetTimers: { scale: number }[] };
    const presetTimers = set.presetTimers.map((t) => ({ ...t, scale: 0.3 }));
    return { ...s, what: { ...s.what, set: { ...set, presetTimers } } };
  });
  return {
    ...doc,
    policy: { ...doc.policy, kinds: { ...doc.policy.kinds, permitting: [{ ...timing, spans }] } }
  };
}

const sharedBanner = (page: Page): Locator => page.getByRole('region', { name: 'Shared policy' });
const notices = (page: Page): Locator => page.getByTestId('sim-notice');

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
}

/** Records uncaught page errors from now on. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Publishes the page's document under `title` (none: the dialog's own) and returns its link. */
async function publish(page: Page, title?: string): Promise<string> {
  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Publish this policy|Published/ });
  await expect(dialog.getByRole('heading', { name: 'Publish this policy' })).toBeVisible();
  if (title !== undefined) await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();
  return link;
}

// ---- publish, open, Remix -------------------------------------------------------------------------

test('publish round trip', async ({ page, browser }, testInfo) => {
  await gotoSim(page, '/sim', { map: false });
  await choosePreset(page);
  await closeEditor(page);
  const link = await publish(page, 'SD permits');
  expect(new URL(link).pathname).toMatch(new RegExp(`^/s/${ID}$`));
  // The author is done: closing the page ends its map load, which would compete with the visitor's.
  await page.close();

  // A visitor: a fresh context (empty localStorage, so a default local policy) on this device.
  const {
    viewport,
    isMobile: mobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  } = testInfo.project.use;
  const ctx = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  });
  try {
    const visitor = await ctx.newPage();
    const errors = pageErrors(visitor);
    await visitor.emulateMedia({ reducedMotion: 'reduce' });
    const res = await visitor.goto(link);
    expect(res?.status()).toBe(200);
    await expect(sharedBanner(visitor)).toContainText('SD permits · Shared policy');
    await expect(visitor.locator('html')).toHaveAttribute('data-hydrated', '');
    await waitSession(visitor);
    // The shared policy, read-only: its editor has no switch, no Remove and no "+".
    const view = await selectPolicy(visitor, 'Permitting', PRESET);
    await expect(view).toContainText(PRESET);
    await expect(view.getByRole('button', { name: 'Remove policy' })).toHaveCount(0);
    await expect(visitor.getByRole('button', { name: 'Add Permitting policy' })).toHaveCount(0);
    expect(await storedDoc(visitor), 'viewing never writes the autosave').toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Remix on /s/<id> opens /sim on a copy of the policy', async ({ page }) => {
  const id = await seedPolicy(page, { ...(await capturePresetDoc(page)), title: 'SD permits' });
  // An empty autosave, so a default local policy: Remix asks no confirm.
  await page.evaluate((k) => localStorage.removeItem(k), SIM_KEY);
  const errors = pageErrors(page);
  await page.goto(`/s/${id}`);
  // Hydrated, so the Remix click is not lost to SSR markup.
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await sharedBanner(page).getByRole('button', { name: 'Remix' }).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expect(
    page.getByText("Remixed from SD permits. You're editing your own copy.")
  ).toBeVisible();
  // The /sim header is whole after the client navigation from /s/<id>.
  await expect(page.getByTestId('score-bar')).toBeVisible();
  await waitSession(page);
  const view = await selectPolicy(page, 'Permitting', PRESET);
  await expect(view.getByTestId('timing-label')).toHaveText(PRESET);
  await expect(view.getByRole('button', { name: 'Remove policy' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a shared link opens with everything ahead unseen', async ({ page }) => {
  const id = await seedPolicy(page, { ...(await capturePresetDoc(page)), title: 'SD permits' });
  await gotoSim(page, `/s/${id}`, { map: false });
  const fzp = () =>
    page.evaluate(() => {
      const d = (window as FzpWin).__sfhFzp!;
      return { asOf: d.asOf, day: d.day, reached: d.reached, playFrom: d.playFrom };
    });
  const at = await fzp();
  expect(at.day).toBe(at.asOf);
  expect(at.reached).toBe(at.asOf);
  expect(at.playFrom).toBeNull();
  await expect(page.getByTestId('tl-flag')).toHaveText('Today');
  // The ruler's hatched part starts at today: nothing ahead has been seen.
  const left = (id: string) =>
    page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs((await left('tl-zone-unseen')) - (await left('tl-track')))).toBeLessThanOrEqual(
    1
  );
});

// ---- autosave ---------------------------------------------------------------------------------------

test('autosave survives a reload', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await expect(
    editor(page).getByRole('region', { name: 'What' }).getByRole('status').first()
  ).toHaveText(/^[\d,]+ lots?$/);
  await choosePreset(page);
  await expect
    .poll(async () => {
      const d = await storedDoc(page);
      return !!d && d.policy.kinds.zoning.length === 1 && d.policy.kinds.permitting.length === 1;
    })
    .toBe(true);

  await page.reload();
  await waitReady(page);
  // The restored rule resolves: its lots are counted and the forecast fills with it.
  const view = await selectPolicy(page, 'Zoning', 'Transit rule');
  await expect(view.getByRole('region', { name: 'What' }).getByRole('status').first()).toHaveText(
    /^[\d,]+ lots?$/
  );
  expect(
    (await page.evaluate(() => (window as FzpWin).__sfhFzp!.policy)).kinds.permitting
  ).toHaveLength(1);
  await expect(page.getByText(TIMING_NOTICE)).toHaveCount(0);
  await expect(notices(page)).toHaveCount(0);
});

// ---- seeded policies --------------------------------------------------------------------------------

test('a seeded tampered policy opens refit', async ({ page }) => {
  const id = await seedPolicy(page, tampered(await capturePresetDoc(page)));
  const errors = pageErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const res = await page.goto(`/s/${id}`);
  expect(res?.status()).toBe(200);
  await waitReady(page);
  const notice = notices(page).filter({ hasText: TIMING_NOTICE });
  await expect(notice).toHaveCount(1);
  await notice.getByRole('button', { name: 'Details' }).click();
  await expect(notice.getByRole('listitem')).toHaveText([
    `${PRESET} was re-computed for this data`
  ]);
  expect(errors).toEqual([]);
});

test('a policy on a gone dataset falls back', async ({ page }) => {
  const doc = await capturePresetDoc(page);
  const id = await seedPolicy(page, { ...doc, datasetVersion: 'fixture-0000' });
  const errors = pageErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const res = await page.goto(`/s/${id}`);
  expect(res?.status()).toBe(200);
  await expect(sharedBanner(page)).toContainText(
    'Made with map data fixture-0000, which is no longer available. Shown on the current data (fixture-0); numbers may differ from when it was published.'
  );
  await waitReady(page);
  expect(await page.evaluate(() => (window as FzpWin).__sfhFzp!.phase)).toBe('ready');
  expect(errors).toEqual([]);
});

test('kind redirects: /p/<policy id> lands on /s/<policy id>', async ({ page }) => {
  const id = await seedPolicy(page, await capturePresetDoc(page));
  await page.goto(`/p/${id}`);
  await expect(page).toHaveURL(new RegExp(`/s/${id}$`));
  await expect(sharedBanner(page)).toBeVisible();
});

// ---- schema-2 policies ------------------------------------------------------------------------------

/** The painted policy's painted areas on show in the editor's read-only summary or Paint rows. */
const paintedCount = (page: Page): Promise<number> =>
  page.evaluate(() =>
    (window as FzpWin)
      .__sfhFzp!.policy.kinds.zoning.filter((p) => p.where.tag === 'painted')
      .flatMap((p) => p.spans)
      .reduce((n, s) => n + (s.what.tag === 'brushes' ? s.what.brushes.length : 0), 0)
  );

test('a stored schema-2 policy opens with the upgraded notice and remixes as schema 4', async ({
  page
}) => {
  const id = await seedPlanRow(page.request, {
    body: SCHEMA2_TEXT,
    datasetVersion: 'fixture-0',
    kind: 'sim'
  });
  const errors = pageErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const res = await page.goto(`/s/${id}`);
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await waitSession(page);
  await expect(notices(page).filter({ hasText: UPGRADED })).toHaveCount(1);
  expect(await paintedCount(page)).toBe(1);
  await expectNoA11yViolations(page);

  // An empty autosave, so a default local policy: Remix asks no confirm.
  await sharedBanner(page).getByRole('button', { name: 'Remix' }).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expect(page.getByText(/^Remixed from .*\. You're editing your own copy\.$/)).toBeVisible();
  await waitSession(page);
  expect(await paintedCount(page)).toBe(1);
  await expect.poll(async () => (await storedDoc(page))?.schema).toBe(4);
  expect(errors).toEqual([]);
});

test('a schema-2 autosave record opens, is stored back as schema 4 and publishes as schema 4', async ({
  page
}) => {
  await page.addInitScript(
    ([k, plan]) => {
      if (localStorage.getItem(k) === null)
        localStorage.setItem(k, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), plan }));
    },
    [SIM_KEY_V1, SCHEMA2_TEXT] as const
  );
  await gotoSim(page, '/sim', { map: false });
  expect(await paintedCount(page)).toBe(1);
  await expect(notices(page).filter({ hasText: UPGRADED })).toHaveCount(1);
  await expect.poll(async () => (await storedDoc(page))?.schema).toBe(4);

  const link = await publish(page);
  const newId = new URL(link).pathname.split('/').pop();
  const res = await page.request.get(`/api/policies/${newId}`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('"schema":4');
});

// ---- storage ---------------------------------------------------------------------------------------

test('storage off: the header shows "Autosave off" and editing works', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('refused', 'QuotaExceededError');
    };
  });
  await gotoSim(page);
  await choosePreset(page);
  // The status slot sits beside the site name at every width (not in the phone Menu).
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Autosave off', exact: true })
  ).toBeVisible();
  await expect(editor(page).getByTestId('timing-label')).toHaveText(PRESET);
});

// ---- the read-only view: accessibility and layout -----------------------------------------------

test('axe on /s/<id>: 1280 px and 375 px with the policy open', async ({ page, isMobile }) => {
  const id = await seedPolicy(page, await capturePresetDoc(page));
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${id}`);
  await waitReady(page);
  await expect(sharedBanner(page)).toBeVisible();
  await selectPolicy(page, 'Permitting', PRESET);
  await expect(sharedBanner(page)).toBeVisible();
  await expectNoA11yViolations(page);
  if (isMobile) await expectNoHorizontalScroll(page);
});

test('the timing notice on /s/<id> is announced by a polite live region', async ({ page }) => {
  const id = await seedPolicy(page, tampered(await capturePresetDoc(page)));
  // Whether the live region was ever in the document empty before the notice arrived: a screen
  // reader announces a change to a live region, not one that mounts already populated.
  await page.addInitScript(() => {
    const w = window as Window & { __region?: { sawEmpty: boolean; filledAfterEmpty: boolean } };
    w.__region = { sawEmpty: false, filledAfterEmpty: false };
    new MutationObserver(() => {
      const r = document.querySelector('[data-testid="sim-notices"]');
      if (!r) return;
      if (r.childElementCount === 0) w.__region!.sawEmpty = true;
      else if (w.__region!.sawEmpty) w.__region!.filledAfterEmpty = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${id}`);
  await waitReady(page);

  const region = page.getByTestId('sim-notices');
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region.getByTestId('sim-notice').filter({ hasText: TIMING_NOTICE })).toHaveCount(1);
  // In the accessibility tree: the status region names the notice.
  await expect(page.getByRole('status').filter({ hasText: TIMING_NOTICE })).toHaveCount(1);

  // The region was in the document empty first, then the notice was inserted (T5-M2).
  const seen = await page.evaluate(() => (window as Window & { __region?: object }).__region);
  expect(seen).toEqual({ sawEmpty: true, filledAfterEmpty: true });
});

/**
 * WCAG 2.2 2.4.11: each button of the map's bottom-left navigation control stays clear of every
 * `covers` box and, focused, is the topmost element at its centre (as e2e/sim.spec.ts).
 */
async function expectNavControlClear(page: Page, covers: Locator[]): Promise<void> {
  const buttons = page.locator('.maplibregl-ctrl-bottom-left button');
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    await button.focus();
    const b = (await button.boundingBox())!;
    const name = await button.getAttribute('aria-label');
    for (const cover of covers) {
      const c = (await cover.boundingBox())!;
      const overlaps =
        b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height;
      expect(overlaps, `${name} at ${JSON.stringify(b)} overlaps ${JSON.stringify(c)}`).toBe(false);
    }
    const topmost = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(topmost, `${name} is covered`).toBe(true);
  }
}

test('at 768 px on /s/<id> the banner, editor and notices leave the zoom control uncovered', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'a coarse pointer gets no navigation control');
  const id = await seedPolicy(page, tampered(await capturePresetDoc(page)));
  await page.setViewportSize({ width: 768, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${id}`);
  await waitReady(page);
  await selectPolicy(page, 'Permitting', PRESET);
  await expect(notices(page).filter({ hasText: TIMING_NOTICE })).toHaveCount(1);
  await expectNavControlClear(page, [
    sharedBanner(page),
    page.getByTestId('tl-inspector'),
    ...(await notices(page).all())
  ]);
});

test('from md /s/<id> shows Activity in the detail column, no starters; a selected policy replaces it read-only', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'the detail column is md+');
  const id = await seedPolicy(page, await capturePresetDoc(page));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${id}`);
  await waitReady(page);
  const column = page.getByTestId('tl-inspector');
  await expect(column.getByTestId('tl-activity')).toBeVisible();
  // Read-only: no starters, and the empty kinds carry no words.
  await expect(column.getByText('Press Play to see what gets built.')).toBeVisible();
  await expect(column.getByText('Try one:')).toHaveCount(0);
  await expect(page.getByTestId('tl-empty-lane')).toHaveCount(0);
  await selectPolicy(page, 'Permitting', PRESET);
  await expect(column.getByTestId('inspector')).toBeVisible();
  await expect(column.getByTestId('tl-activity')).toHaveCount(0);
  await expect(column.getByRole('button', { name: 'Remove policy' })).toHaveCount(0);
});
