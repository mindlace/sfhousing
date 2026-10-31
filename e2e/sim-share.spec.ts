// /sim publishing e2e (plan 5, Task 7): publish a policy and open its /s/<id> link, Remix, the
// autosave across a reload, a tampered and a gone-dataset policy seeded through the e2e-only
// route, the /p -> /s redirect, `start=fzp` keeping the saved policy, storage refused, and the
// accessibility and layout checks on the read-only view. Runs against the VITE_E2E build on
// fixture-0. Seeded documents are captured from the app's own autosave, never hand-written, so
// they follow the SimDoc shape.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { SIM_KEY, headerAction, openPublish, seedPlanRow, type Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };
type Doc = {
  datasetVersion: string;
  title?: string;
  policy: {
    timing: { current: { preset: string; presetTimers: { scale: number }[] } };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

const PRESET = "Permits at San Diego's pace";
const TIMING_NOTICE = 'Some permitting timelines were re-fit to the data this simulation runs on.';
const FZP_KEPT =
  'Showing the Family Zoning Plan comparison. Your saved policy is kept until you change something here.';
const ID = '[1-9A-HJ-NP-Za-km-z]{8}';

// ---- helpers (as in e2e/sim.spec.ts, which keeps its own copies) ---------------------------------

const leverStatus = (page: Page) =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.levers) as Promise<SfhFzpDebug['levers']>;

/** The page is ready, the map is up and the levers sent with the session are in force. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
  await expect
    .poll(async () => (await leverStatus(page)).status, { timeout: 20_000 })
    .toBe('current');
}

async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await waitReady(page);
}

/** Waits for a lever revision above `before` to be in force. */
async function expectNewRevision(page: Page, before: number | null): Promise<void> {
  await expect
    .poll(
      async () => {
        const l = await leverStatus(page);
        return l.status === 'current' && (l.sentRev ?? -1) > (before ?? -1);
      },
      { timeout: 20_000 }
    )
    .toBe(true);
}

const panel = (page: Page): Locator => page.getByTestId('policy-panel');

async function openPolicy(page: Page): Promise<Locator> {
  if (!(await panel(page).isVisible())) await (await headerAction(page, 'Policy')).click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

/** Closes the phone sheet, which is modal: the rest of the page is inert while it shows. */
async function closeSheet(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile || !(await panel(page).isVisible())) return;
  await panel(page).getByRole('button', { name: 'Close policy' }).click();
  await expect(panel(page)).toBeHidden();
}

async function expandSection(page: Page, title: string): Promise<void> {
  const button = panel(page).getByRole('button', { name: title, exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

const timingToggle = (page: Page): Locator =>
  panel(page).getByRole('button', { name: /^Permitting timelines/ });

async function openTiming(page: Page): Promise<void> {
  await openPolicy(page);
  const toggle = timingToggle(page);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** Chooses the San Diego preset in the open timelines section and waits for it to be in force. */
async function choosePreset(page: Page): Promise<void> {
  await openTiming(page);
  const before = (await leverStatus(page)).sentRev;
  await panel(page).getByLabel('Preset').selectOption({ label: PRESET });
  await expectNewRevision(page, before);
  await expect(panel(page).getByTestId('timing-label')).toHaveText(PRESET);
}

const brushList = (page: Page): Locator =>
  panel(page).getByRole('list', { name: 'Your brushes' }).getByRole('listitem');

/** The autosaved document, or null. */
const storedDoc = (page: Page): Promise<Doc | null> =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : (JSON.parse((JSON.parse(raw) as { plan: string }).plan) as Doc);
  }, SIM_KEY);

/**
 * A fixture-0 policy on the San Diego preset, as the app autosaves it: chosen on /sim, then read
 * back from storage once written.
 */
async function capturePresetDoc(page: Page): Promise<Doc> {
  await gotoSim(page);
  await choosePreset(page);
  await expect
    .poll(async () => (await storedDoc(page))?.policy.timing.current.preset)
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
  const current = doc.policy.timing.current;
  const presetTimers = current.presetTimers.map((t) => ({ ...t, scale: 0.3 }));
  return {
    ...doc,
    policy: {
      ...doc.policy,
      timing: { ...doc.policy.timing, current: { ...current, presetTimers } }
    }
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

// ---- publish, open, Remix -------------------------------------------------------------------------

test('publish round trip', async ({ page, browser, isMobile }, testInfo) => {
  await gotoSim(page);
  await choosePreset(page);
  await closeSheet(page, isMobile);

  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Publish this policy|Published/ });
  await expect(dialog.getByRole('heading', { name: 'Publish this policy' })).toBeVisible();
  await dialog.getByLabel('Title').fill('SD permits');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  expect(new URL(link).pathname).toMatch(new RegExp(`^/s/${ID}$`));
  await dialog.getByRole('button', { name: 'Done' }).click();

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
    await waitReady(visitor);
    const summary = await openPolicy(visitor);
    await expect(summary).toContainText('Policy (read-only)');
    await expect(summary).toContainText(PRESET);
    expect(await storedDoc(visitor), 'viewing never writes the autosave').toBeNull();
    await closeSheet(visitor, isMobile);

    // No confirm: the visitor's local policy is the default one.
    await sharedBanner(visitor).getByRole('button', { name: 'Remix' }).click();
    await expect(visitor).toHaveURL(new URL('/sim', link).toString());
    await expect(
      visitor.getByText("Remixed from SD permits. You're editing your own copy.")
    ).toBeVisible();
    await waitReady(visitor);
    // The /sim header is whole after the client navigation from /s/<id>.
    await expect(visitor.getByTestId('score-bar')).toBeVisible();
    await openTiming(visitor);
    await expect(panel(visitor).getByTestId('timing-label')).toHaveText(PRESET);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

// ---- autosave ---------------------------------------------------------------------------------------

test('autosave survives a reload', async ({ page }) => {
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  await panel(page).getByRole('button', { name: 'Add a brush' }).click();
  const transit = panel(page).getByRole('button', { name: 'Transit', exact: true });
  await expect(transit).toBeEnabled({ timeout: 20_000 });
  await transit.click();
  const form = panel(page).getByRole('form', { name: 'Add a transit brush', exact: true });
  await form.getByRole('checkbox', { name: /^Muni Metro/ }).check();
  await form.getByRole('button', { name: 'Save brush' }).click();
  await expect(brushList(page)).toHaveCount(1);
  await expect(brushList(page).first()).toContainText('Near');

  await choosePreset(page);
  await panel(page).getByRole('button', { name: 'Save timelines' }).click();
  await expect(panel(page).getByRole('button', { name: 'Revert to saved' })).toBeVisible();
  await expect
    .poll(async () => {
      const d = await storedDoc(page);
      const p = d?.policy as { brushes?: unknown[]; timing?: { saved?: unknown } } | undefined;
      return !!p && p.brushes?.length === 1 && !!p.timing?.saved;
    })
    .toBe(true);

  await page.reload();
  await waitReady(page);
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  await expect(brushList(page)).toHaveCount(1);
  await expect(brushList(page).first()).toContainText('Near');
  // The restored brush resolves (C1): the card counts its lots, and the full levers are in force.
  await expect(brushList(page).first()).toContainText(/ · [\d,]+ lots? · /, { timeout: 20_000 });
  await expect(brushList(page).first()).not.toContainText('Finding lots…');
  await expect
    .poll(async () => (await leverStatus(page)).status, { timeout: 20_000 })
    .toBe('current');
  await openTiming(page);
  await expect(panel(page).getByRole('button', { name: 'Revert to saved' })).toBeVisible();
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

// ---- /fzp and storage ------------------------------------------------------------------------------

test('/fzp keeps the saved policy', async ({ page }) => {
  await capturePresetDoc(page);
  const raw = await page.evaluate((k) => localStorage.getItem(k), SIM_KEY);
  expect(raw).not.toBeNull();

  await page.goto('/fzp');
  await expect(page).toHaveURL(/\/sim\?start=fzp$/);
  await waitReady(page);
  const kept = notices(page).filter({ hasText: FZP_KEPT });
  await expect(kept).toHaveCount(1);
  await expect(kept.getByRole('link', { name: 'Open your policy' })).toHaveAttribute(
    'href',
    '/sim'
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), SIM_KEY)).toBe(raw);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('sfhousing:sim:corrupt:'))
    )
  ).toEqual([]);
});

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
  await expect(timingToggle(page)).toContainText(PRESET);
});

// ---- the read-only view: accessibility and layout -----------------------------------------------

test('axe on /s/<id>: 1280 px with the summary open; 375 px with the sheet open', async ({
  page,
  isMobile
}) => {
  const id = await seedPolicy(page, await capturePresetDoc(page));
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${id}`);
  await waitReady(page);
  await expect(sharedBanner(page)).toBeVisible();
  const summary = await openPolicy(page);
  await expect(summary).toContainText('Policy (read-only)');
  if (isMobile) await expect(page.locator('dialog[open]')).toHaveCount(1);
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

test('at 768 px on /s/<id> the banner, summary and notices leave the zoom control uncovered', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'a coarse pointer gets no navigation control');
  const id = await seedPolicy(page, tampered(await capturePresetDoc(page)));
  await page.setViewportSize({ width: 768, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/s/${id}`);
  await waitReady(page);
  await expect(panel(page)).toBeVisible();
  await expect(notices(page).filter({ hasText: TIMING_NOTICE })).toHaveCount(1);
  await expectNavControlClear(page, [
    sharedBanner(page),
    panel(page),
    ...(await notices(page).all())
  ]);
});
