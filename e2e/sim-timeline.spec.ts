// /sim's timeline end to end (timeline-ui): the headline settles once the forecast fills, a transit
// rule from the model month starting in January 2031 refills the forecast from 2031 and leaves the
// months before it alone (the
// real worker's compiled -> refill -> filled order), a published policy opens on /s with the same
// timeline, a stored schema 3 link opens with the "upgraded" notice, axe in light and dark with a
// kind and the editor open, and the bars by keyboard (reached by Tab, selected by Enter, moved by
// the arrows, focus back on the bar when the editor closes). Runs against the VITE_E2E build on
// fixture-0 (window.__sfhFzp, src/lib/fzp/debug.ts).
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { DEFAULT_POLICY } from '../src/lib/sim-page/policy';
import { serializeSimDoc } from '../src/lib/sim-page/sim-doc';
import { expectNoA11yViolations } from './helpers/a11y';
import { COPY } from '../src/lib/sharing/copy';
import {
  addPolicy,
  holdPolicy,
  installPolicyHold,
  openKind,
  releasePolicy,
  slider,
  waitFilled
} from './helpers/run';
import { openPublish, seedPlanRow, type Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

const PRESET = "Permits at San Diego's pace";
/** A schema 3 policy on fixture-0 with one painted brush (as `paintedText` in server/test/sim-docs). */
const SCHEMA3_TEXT = serializeSimDoc({
  schema: 3,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy: {
    ...DEFAULT_POLICY,
    custom: [
      {
        id: 'a',
        kind: 'paint',
        stories: 6,
        strokes: [
          {
            path: [
              [-122.4, 37.7],
              [-122.39999, 37.7],
              [-122.39998, 37.7]
            ],
            radiusM: 50
          }
        ]
      }
    ]
  }
});
const UPGRADED = /Saved before policies had dates\. Each starts [A-Z][a-z]+ \d{4}\./;

// ---- helpers ------------------------------------------------------------------------------------

function fzp<K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> {
  return page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;
}
const completedOf = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.completedNet());

/** The session is ready and the forecast filled (no map needed: the worker runs without it). */
async function waitSession(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await waitSession(page);
}

const scoreBar = (page: Page): Locator => page.getByRole('banner').getByTestId('score-bar');
const editor = (page: Page): Locator => page.getByTestId('inspector');
const bars = (page: Page): Locator => page.getByTestId('tl-bar');
const notices = (page: Page): Locator => page.getByTestId('sim-notice');
const sharedBanner = (page: Page): Locator => page.getByRole('region', { name: 'Shared policy' });

/** The calendar-month index (from the dataset date's month) of `y`-`m` (m 1-12). */
const indexOf = (asOf: number, y: number, m: number): number => {
  const d = new Date(asOf * 86_400_000);
  return (y - d.getUTCFullYear()) * 12 + (m - 1 - d.getUTCMonth());
};

/** The playhead's UTC year and month (1-12). */
async function playheadYm(page: Page): Promise<[number, number]> {
  const d = new Date((await fzp(page, 'day')) * 86_400_000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}

/**
 * Moves the playhead by keyboard to the first of `month` (1-12) in `year` (the forecast filled past
 * it): Home, a PageUp per year, an ArrowRight per month.
 */
async function playheadTo(page: Page, year: number, month: number): Promise<void> {
  const k = indexOf(await fzp(page, 'asOf'), year, month);
  await slider(page).focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < Math.floor(k / 12); i++) await page.keyboard.press('PageUp');
  for (let i = 0; i < k % 12; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => playheadYm(page)).toEqual([year, month]);
}

/** Closes the editor by keyboard (Escape inside it), if it shows. */
async function closeEditor(page: Page): Promise<void> {
  const close = editor(page).getByRole('button', { name: 'Close editor' });
  if (await close.isVisible()) {
    await close.focus();
    await page.keyboard.press('Escape');
  }
  await expect(editor(page)).toHaveCount(0);
}

/** Publishes the page's document under `title` and returns its link. */
async function publish(page: Page, title: string): Promise<string> {
  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Publish this policy|Published/ });
  await expect(dialog.getByRole('heading', { name: 'Publish this policy' })).toBeVisible();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();
  return link;
}

/** Records uncaught page errors from now on. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// ---- the headline -------------------------------------------------------------------------------

test('open /sim and see the headline settle', async ({ page }) => {
  await gotoSim(page);
  expect(await fzp(page, 'filledThrough')).toBe(await fzp(page, 'lastIndex'));
  await expect(scoreBar(page)).toHaveText(/^0 homes by today$/);
  await expect(scoreBar(page)).not.toHaveAttribute('aria-busy', 'true');
  // Settled: the filled forecast's headline stays put.
  const text = await scoreBar(page).textContent();
  await waitFilled(page);
  await expect(scoreBar(page)).toHaveText(text!);
});

// ---- the status cell ----------------------------------------------------------------------------

const statusShown = (page: Page): Locator => page.getByTestId('tl-status-shown');

test("a held edit: Updating shows at once and the key's mark row with it", async ({ page }) => {
  await installPolicyHold(page);
  await gotoSim(page);
  // A first policy, held at the worker boundary: the numbers stay the nothing-in-force ones.
  await holdPolicy(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await expect(statusShown(page)).toHaveText('Updating');
  expect(await fzp(page, 'stale')).toBe(true);
  await closeEditor(page);
  const keyPanel = page.getByRole('group', { name: 'Map key' });
  if (!(await keyPanel.isVisible())) await page.getByTestId('map-key-toggle').click();
  await expect(keyPanel.getByText('Under your policy', { exact: true })).toBeVisible();
  expect(await fzp(page, 'stale')).toBe(true);
  await releasePolicy(page);
  await waitFilled(page);
  await expect(statusShown(page)).toHaveText('');
  await expect(keyPanel.getByText('Under your policy', { exact: true })).toBeVisible();
});

test('blocked storage: Autosave off and Updating both show during an edit; the chip opens its popover', async ({
  page
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('refused', 'QuotaExceededError');
    };
  });
  await installPolicyHold(page);
  await gotoSim(page);
  await holdPolicy(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  const banner = page.getByRole('banner');
  const chip = banner.getByRole('button', { name: 'Autosave off', exact: true });
  await expect(chip).toBeVisible();
  await expect(statusShown(page)).toHaveText('Updating');
  const updating = banner.getByTestId('tl-status').getByRole('button', { name: 'Updating' });
  await expect(updating).toBeVisible();
  const a = (await chip.boundingBox())!;
  const b = (await updating.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  await closeEditor(page);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(COPY.n4, { exact: true })).toBeVisible();
  await expect(statusShown(page)).toHaveText('Updating');
  await releasePolicy(page);
  await waitFilled(page);
  await expect(statusShown(page)).toHaveText('');
  await expect(chip).toBeVisible();
});

// ---- the refill ---------------------------------------------------------------------------------

test('a transit rule from 2031 refills from 2031, months before unchanged', async ({ page }) => {
  await gotoSim(page);
  // A policy in force from today first: the first one switches what the forecast is compared
  // with (the plan, not the zoning before it), which withdraws every month (rule 22).
  await addPolicy(page, 'Permitting', PRESET);
  await closeEditor(page);
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp!.refills.length > 0);
  await waitFilled(page);

  const before = await completedOf(page);
  const n = (await fzp(page, 'refills')).length;
  const k = indexOf(await fzp(page, 'asOf'), 2031, 1);
  // A new policy starts on the model month the playhead is in (rule 12), and its edge reads that
  // model month's start date. Model months start near the dataset date's day of the month
  // (fixture-0: the 10th), so the playhead on February 2031 is in the model month that starts in
  // January 2031.
  await playheadTo(page, 2031, 2);

  await addPolicy(page, 'Zoning', 'Transit rule');
  const [rule] = (await fzp(page, 'policy')).kinds.zoning;
  const from = new Date(rule.spans[0].from * 86_400_000);
  expect([from.getUTCFullYear(), from.getUTCMonth() + 1]).toEqual([2031, 1]);

  await page.waitForFunction((c) => (window as FzpWin).__sfhFzp!.refills.length > c, n);
  await waitFilled(page);
  const refills = await fzp(page, 'refills');
  // Every refill since the edit starts at 2031 or later.
  expect(refills.length).toBeGreaterThan(n);
  for (const r of refills.slice(n)) expect(r).toBeGreaterThanOrEqual(k);
  const after = await completedOf(page);
  expect(after).toHaveLength(before.length);
  expect(after.slice(0, k)).toEqual(before.slice(0, k));
});

test('after an edit Play reads Play from the first changed year, and plays from there', async ({
  page
}) => {
  await gotoSim(page);
  // In force from today first, as the case above: then the transit rule changes only its months.
  await addPolicy(page, 'Permitting', PRESET);
  await closeEditor(page);
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp!.refills.length > 0);
  await waitFilled(page);

  // The whole window reached, then back to February 2031, where the rule starts.
  await slider(page).focus();
  await page.keyboard.press('End');
  const end = await fzp(page, 'day');
  await expect.poll(() => fzp(page, 'reached')).toBe(end);
  await playheadTo(page, 2031, 2);
  await addPolicy(page, 'Zoning', 'Transit rule');
  const [rule] = (await fzp(page, 'policy')).kinds.zoning;
  const start = rule.spans[0].from;

  // Final: the add's one send is answered (not stale) and filled to the end; both read at once.
  await waitFilled(page);
  const { playFrom, reached } = await page.evaluate(() => {
    const f = (window as FzpWin).__sfhFzp!;
    return { playFrom: f.playFrom, reached: f.reached };
  });
  expect(playFrom).not.toBeNull();
  const from = playFrom!;
  expect(from).toBeGreaterThanOrEqual(start);
  expect(reached).toBeLessThan(end);
  const year = new Date(from * 86_400_000).getUTCFullYear();
  await expect(page.getByTestId('tl-play-label')).toHaveText(`Play from ${year}`);

  // Read in the press's own task, so no frame of playback comes between.
  const pressed = await page.getByTestId('tl-play').evaluate((b) => {
    (b as HTMLElement).click();
    const f = (window as FzpWin).__sfhFzp!;
    return { day: f.day, playing: f.playing };
  });
  expect(pressed).toEqual({ day: from, playing: true });
});

// ---- sharing ------------------------------------------------------------------------------------

test('publish, open the /s link, see the same timeline', async ({ page, browser }, testInfo) => {
  await gotoSim(page);
  await addPolicy(page, 'Permitting', PRESET);
  await closeEditor(page);
  await waitFilled(page);
  const doc = await fzp(page, 'policy');
  const series = await completedOf(page);
  const headline = await scoreBar(page).textContent();
  await openKind(page, 'Permitting');
  const labels = await bars(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label'))
  );
  expect(labels).toContainEqual(expect.stringMatching(new RegExp(`^${PRESET}, `)));
  const link = await publish(page, 'Same timeline');
  await page.close();

  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const ctx = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  });
  try {
    const visitor = await ctx.newPage();
    const errors = pageErrors(visitor);
    await gotoSim(visitor, new URL(link).pathname);
    await expect(sharedBanner(visitor)).toContainText('Same timeline · Shared policy');
    expect(await fzp(visitor, 'policy')).toEqual(doc);
    expect(await completedOf(visitor)).toEqual(series);
    await expect(scoreBar(visitor)).toHaveText(headline!);
    await openKind(visitor, 'Permitting');
    expect(
      await bars(visitor).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    ).toEqual(labels);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('a stored schema 3 link opens with the upgraded notice', async ({ page }) => {
  const body = SCHEMA3_TEXT;
  expect(JSON.parse(body).schema).toBe(3);
  const id = await seedPlanRow(page.request, { body, datasetVersion: 'fixture-0', kind: 'sim' });
  const errors = pageErrors(page);
  await gotoSim(page, `/s/${id}`);
  await expect(sharedBanner(page)).toBeVisible();
  await expect(notices(page).filter({ hasText: UPGRADED })).toHaveCount(1);
  const doc = await fzp(page, 'policy');
  expect(doc.schema).toBe(4);
  const painted = doc.kinds.zoning.filter((p) => p.where.tag === 'painted');
  expect(painted).toHaveLength(1);
  expect(painted[0].spans).toHaveLength(1);
  expect(errors).toEqual([]);
});

// ---- accessibility ------------------------------------------------------------------------------

test('no axe violations with a kind open and the editor open, light and dark', async ({ page }) => {
  await gotoSim(page);
  await openKind(page, 'Zoning');
  await addPolicy(page, 'Zoning', 'Transit rule');
  await expect(editor(page).getByRole('heading', { name: 'Transit rule' })).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
      colorScheme === 'dark'
    );
    await expectNoA11yViolations(page);
  }
});

test('every bar is reachable and operable by keyboard; focus returns to the bar when the editor closes', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await closeEditor(page);
  await addPolicy(page, 'Permitting', PRESET);
  await closeEditor(page);

  for (const [kind, key] of [
    ['Zoning', 'zoning'],
    ['Permitting', 'permitting']
  ] as const) {
    await openKind(page, kind);
    // The kind's bars on show: the fixed row's and each policy's (below md, the sheet's copy).
    const BARS = `[data-testid="tl-kind-${key}"] :is([data-testid="tl-bar"], [data-testid="tl-fixed"] button)`;
    const names = await page
      .locator(BARS)
      .evaluateAll((els) =>
        els.filter((e) => e.checkVisibility()).map((e) => e.getAttribute('aria-label')!)
      );
    expect(names.length).toBeGreaterThanOrEqual(2);

    // Tab from the kind's toggle (below md, the sheet's handle, which has focus) reaches every bar.
    if (!isMobile)
      await page
        .getByTestId('tl-timeline')
        .getByRole('button', { name: kind, exact: true })
        .first()
        .focus();
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < names.length; i++) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate(
        (sel) => document.activeElement?.matches(sel) && document.activeElement.ariaLabel,
        BARS
      );
      if (at) seen.add(at);
    }
    expect([...seen].sort()).toEqual([...names].sort());

    // The policy's bar: Enter selects it and opens its editor.
    const bar = page.locator(`[data-testid="tl-kind-${key}"] [data-testid="tl-bar"]:visible`);
    await expect(bar).toHaveCount(1);
    await bar.focus();
    const name = (await bar.getAttribute('aria-label'))!;
    // The name is "{label}, {10 Dec 2030} to {date | no end}[, off]".
    const label = name.replace(/, \d{1,2} [A-Z][a-z]{2} \d{4} to .*$/, '');
    expect(label).not.toBe(name);
    await page.keyboard.press('Enter');
    await expect(bar).toHaveAttribute('aria-pressed', 'true');
    await expect(editor(page).getByRole('heading', { name: label })).toBeVisible();

    // An arrow moves an edge: the span's dates change and the bar keeps focus.
    const spans = async () =>
      (await fzp(page, 'policy')).kinds[key].map((p) => p.spans.map((s) => [s.from, s.to]));
    const was = await spans();
    expect(was.flat().length).toBeGreaterThan(0);
    const named = new RegExp(
      `^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, \\d{1,2} [A-Z][a-z]{2} \\d{4} to `
    );
    const focused = page.getByRole('button', { name: named, pressed: true });
    await focused.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(spans).not.toEqual(was);
    await expect(focused).toBeFocused();

    // Close by keyboard: focus returns to the bar.
    await closeEditor(page);
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'tl-bar');
    await expect(page.locator(':focus')).toHaveAccessibleName(named);
    // Below md, the kind's sheet closes for the next kind.
    if (isMobile) await page.keyboard.press('Escape');
  }
});

test('a market term committed by Enter keeps focus in its field', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Public money', 'Market terms');
  const cut = editor(page).getByRole('spinbutton', {
    name: /^Guarantee rate cut, percentage points/
  });
  await cut.focus();
  await page.keyboard.type('0.5');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    (window as FzpWin).__sfhFzp!.policy.kinds.money.some((p) =>
      p.spans.some(
        (s) =>
          s.what.tag === 'terms' &&
          (s.what.terms as { guaranteeRateCut?: number }).guaranteeRateCut === 0.005
      )
    )
  );
  await expect(cut).toBeFocused();
  await expect(cut).toHaveValue('0.5');
});

// ---- the phone rows -----------------------------------------------------------------------------

test('375 px: Zoning, Permitting and Public money read in full; a policy row names itself in the sheet', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'mobile project only');
  await gotoSim(page);
  const rows = page.getByTestId('tl-rows');
  /** A toggle or name shows its words whole (no ellipsis cut). */
  const whole = (l: Locator) => l.evaluate((e) => e.scrollWidth <= e.clientWidth);
  for (const kind of ['Zoning', 'Permitting', 'Public money']) {
    const toggle = rows.getByRole('button', { name: kind, exact: true });
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(kind);
    expect(await whole(toggle), `${kind} is cut`).toBe(true);
  }
  await addPolicy(page, 'Permitting', PRESET);
  await closeEditor(page);
  await openKind(page, 'Permitting');
  const sheet = page.getByRole('dialog', { name: 'Permitting' });
  await expect(sheet).toBeVisible();
  const row = sheet.getByTestId('tl-policy');
  await expect(row).toHaveCount(1);
  const name = row.locator('.name');
  await expect(name).toBeVisible();
  expect(await whole(name)).toBe(true);
  // The name is a line of its own, above its lane, both inside the 375 px screen.
  const n = (await name.boundingBox())!;
  const lane = (await row.getByTestId('tl-lane').boundingBox())!;
  expect(lane.y).toBeGreaterThanOrEqual(n.y + n.height - 1);
  expect(lane.x + lane.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
