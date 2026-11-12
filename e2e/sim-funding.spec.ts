// /sim's Funding tab e2e (funding-ui spec 6, tests 1 to 10): the tab and its rows, presets, your
// own pool, a dated change, market terms, the programme editor, the Results money and tier blocks
// with the market paragraph and the sources dialog, the published summary, a schema-2 document's
// notice and a calibration without baseline funding. Runs against the VITE_E2E build on fixture-0
// (window.__sfhFzp, src/lib/fzp/debug.ts). Every fixture value is read from fixture-0's
// calibration.json on disk and derived with the page's own view functions, never hard-coded.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { HORIZON } from '../src/lib/fzp/time';
import { marketText } from '../src/lib/fzp/money-view';
import { marketLevel } from '../src/lib/sim/scenario/market';
import type { FinanceLevers } from '../src/lib/sim/levers/types';
import type { Calibration } from '../src/lib/timelapse/types';
import {
  AMOUNT_ERROR,
  DRAFT_LINE,
  NO_LIMIT,
  SWITCHED_OFF,
  addProgrammeName,
  coverageStepText,
  fundingNotices,
  groupPaysText,
  perYearText,
  typedTermSummary
} from '../src/lib/sim-page/funding-copy';
import {
  fundingPresets,
  nextFiscal,
  type FundingPreset
} from '../src/lib/sim-page/funding-presets';
import {
  baselineGroups,
  coverageSizeMixed,
  coverageSteps,
  programmeSentence,
  summaryRows
} from '../src/lib/sim-page/funding-view';
import { expectNoA11yViolations } from './helpers/a11y';
import { startRun } from './helpers/run';
import {
  SIM_KEY,
  gotoHydrated,
  headerAction,
  openHeaderMenu,
  openPublish,
  seedPlanRow,
  type Win
} from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

// ---- fixture values -----------------------------------------------------------------------------

const CAL_URL = new URL(
  './fixtures/data/fixture-0/scenarios/fzp/calibration.json',
  import.meta.url
);
const CAL = JSON.parse(readFileSync(CAL_URL, 'utf8')) as Calibration;
const BASELINE = CAL.baselineFunding!;
const ASOF = CAL.asOf;
/** The policy's funding with nothing changed (DEFAULT_LEVERS.finance). */
const NO_FUNDING: FinanceLevers = { baselineScale: [], pools: [], programmes: [], terms: {} };
const PRESETS = fundingPresets(CAL);
/** July of the next fiscal year: where a dated change and a hand-made pool start. */
const JULY = nextFiscal(ASOF);
const YEAR = new Date(JULY * 86_400_000).getUTCFullYear();

/** A schema-2 policy document (the sample finance-levers adds), as stored text. */
const PROFILE_TEXT = readFileSync(
  new URL('../src/lib/sim-page/fixtures/schema2/profile.json', import.meta.url),
  'utf8'
);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- helpers (as in e2e/sim.spec.ts and e2e/sim-share.spec.ts, which keep their own copies) ------

const leverStatus = (page: Page) =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.levers) as Promise<SfhFzpDebug['levers']>;

/** The session is ready (the worker's first timeline) and its levers are in force. */
async function waitSession(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await expect
    .poll(async () => (await leverStatus(page)).status, { timeout: 20_000 })
    .toBe('current');
}

/** /sim (or `path`), the session ready. The map is not waited for: no test here reads it. */
async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await waitSession(page);
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

const sentRev = async (page: Page): Promise<number | null> => (await leverStatus(page)).sentRev;

/** The policy dock. Its root is `display: contents`: the docked panel, rail or sheet is the box. */
const panel = (page: Page): Locator => page.getByTestId('dock');
const handle = (page: Page): Locator => page.getByTestId('dock-handle');

const dockShown = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      !!document.querySelector('.sfh-dock-panel') ||
      document.querySelector('[data-testid="dock-handle"]')?.getAttribute('aria-expanded') ===
        'true'
  );

/** The dock, opened if it is not already (from md the Policy button, below md the handle). */
async function openPolicy(page: Page): Promise<Locator> {
  if (!(await dockShown(page))) {
    if (await handle(page).isVisible()) await handle(page).click();
    else await (await headerAction(page, 'Policy')).click();
  }
  await expect.poll(() => dockShown(page)).toBe(true);
  return panel(page);
}

/** Below md: folds an open sheet to its handle. */
async function closeSheet(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile || (await handle(page).getAttribute('aria-expanded')) !== 'true') return;
  await panel(page)
    .getByRole('button', { name: /^Collapse Policy/ })
    .click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
}

const tabOf = (page: Page, name: string): Locator =>
  panel(page).getByRole('tab', { name, exact: true });

/** Opens the dock on the Funding tab. */
async function openFunding(page: Page): Promise<void> {
  await openPolicy(page);
  await tabOf(page, 'Funding').click();
  await expect(tabOf(page, 'Funding')).toHaveAttribute('aria-selected', 'true');
}

/** The autosaved policy's funding, or null. */
const storedFunding = (page: Page): Promise<FinanceLevers | null> =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (raw === null) return null;
    const doc = JSON.parse((JSON.parse(raw) as { plan: string }).plan) as {
      policy: { funding?: FinanceLevers };
    };
    return doc.policy.funding ?? null;
  }, SIM_KEY);

/** The autosaved funding once `ok` holds for it. */
async function savedFunding(page: Page, ok: (f: FinanceLevers) => boolean): Promise<FinanceLevers> {
  await expect
    .poll(async () => {
      const f = await storedFunding(page);
      return f !== null && ok(f);
    })
    .toBe(true);
  return (await storedFunding(page))!;
}

const addMoney = (page: Page): Locator =>
  panel(page).getByRole('button', { name: 'Add money', exact: true });

/**
 * The first available preset whose pool is a general-obligation bond, as the page's chooser
 * offers it (the chooser must be open).
 */
async function bondPreset(page: Page): Promise<FundingPreset> {
  const candidates = PRESETS.filter((p) => p.available && p.pools.some((x) => x.kind === 'goBond'));
  for (const p of candidates) {
    if (await panel(page).getByRole('button', { name: p.label, exact: true }).isVisible()) return p;
  }
  throw new Error('the chooser offers no general-obligation bond preset');
}

/** Opens "+ Add money" and adds the bond preset; waits for its levers. Returns it. */
async function addBond(page: Page): Promise<FundingPreset> {
  await addMoney(page).click();
  await expect(addMoney(page)).toHaveAttribute('aria-expanded', 'true');
  const preset = await bondPreset(page);
  const before = await sentRev(page);
  await panel(page).getByRole('button', { name: preset.label, exact: true }).click();
  await expectNewRevision(page, before);
  return preset;
}

/** An added pool's row (`data-funding-row="pool:<id>"`). */
const poolRow = (page: Page, id: string): Locator =>
  panel(page).locator(`[data-funding-row="pool:${id}"]`);
/** A programme's nested row (`data-prog-row="<id>"`; a new programme's draft is "draft"). */
const progRow = (page: Page, id: string): Locator => panel(page).locator(`[data-prog-row="${id}"]`);

/** The always-present alert paragraph a field's input references. */
async function alertOf(field: Locator): Promise<Locator> {
  const ids = ((await field.getAttribute('aria-describedby')) ?? '').split(' ').filter(Boolean);
  for (const id of ids) {
    const el = field.page().locator(`[id="${id}"]`);
    if ((await el.getAttribute('role')) === 'alert') return el;
  }
  throw new Error('the field references no alert');
}

/** Types `text` into a field and commits it with Enter. */
async function commit(field: Locator, text: string): Promise<void> {
  await field.fill(text);
  await field.press('Enter');
}

const notices = (page: Page): Locator => page.getByTestId('sim-notice');
/** The dock's Results face. */
const results = (page: Page): Locator => page.getByRole('region', { name: 'Results' });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
}

// ---- 1. the tab -----------------------------------------------------------------------------------

test('1. Funding tab, rows and a11y in every state', async ({ page, isMobile }) => {
  // Ten axe scans of the whole page: about 8 s idle, each scan a few seconds under a full run.
  test.setTimeout(60_000);
  await gotoSim(page);
  await openFunding(page);
  const tabs = panel(page).getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.nth(4)).toHaveAccessibleName('Funding');

  // Today's funding: one row per group, its amount and its per-home figure from the fixture.
  const groups = baselineGroups(NO_FUNDING, BASELINE, ASOF);
  expect(groups.length).toBeGreaterThanOrEqual(3);
  for (const g of groups) {
    const amount = g.off ? SWITCHED_OFF : g.perYear === null ? NO_LIMIT : perYearText(g.perYear);
    const row = panel(page).getByRole('button', { name: new RegExp(`^${esc(g.name)} · `) });
    await expect(row).toContainText(`${g.name} · ${amount}`);
    await expect(row).toContainText(groupPaysText(g.perHome));
    await expect(row).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(panel(page).getByRole('heading', { name: 'Market terms you set' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  // "Coverage over time" open.
  const coverage = panel(page).getByRole('button', { name: 'Coverage over time' });
  await coverage.click();
  await expect(coverage).toHaveAttribute('aria-expanded', 'true');
  await expectNoA11yViolations(page);
  await coverage.click();

  // "Sources and tiers" open.
  const sources = panel(page).locator('details').filter({ hasText: 'Sources and tiers' });
  await sources.locator('summary').click();
  await expect(sources).toHaveAttribute('open', '');
  await expectNoA11yViolations(page);
  await sources.locator('summary').click();

  // The "+ Add money" chooser open, then a pool's editor expanded (a preset selects its row).
  await addMoney(page).click();
  await expect(addMoney(page)).toHaveAttribute('aria-expanded', 'true');
  await expectNoA11yViolations(page);
  const preset = await bondPreset(page);
  await panel(page).getByRole('button', { name: preset.label, exact: true }).click();
  const pool = preset.pools[0];
  const row = poolRow(page, pool.id);
  await expect(row.locator(':scope > button')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('[data-funding-editor]')).toBeVisible();
  await expectNoA11yViolations(page);

  // A programme editor expanded as a grant, with the income-mix fieldset.
  const prog = progRow(page, preset.programmes[0].id);
  await prog.locator(':scope > button').click();
  await expect(prog.locator('[data-programme-editor]')).toBeVisible();
  await expect(prog.getByRole('radio', { name: 'Grant', exact: true })).toBeChecked();
  await expect(prog.getByRole('group', { name: 'Who the homes are for' })).toBeVisible();
  await expectNoA11yViolations(page);

  // As a loan: a bond has no sourced loan rate, so the programme opens as a draft.
  // The draft keeps the programme's row (it replaces the stored programme once complete).
  await prog.getByRole('radio', { name: 'Loan', exact: true }).click();
  await expect(prog.getByText(DRAFT_LINE)).toBeVisible();
  const rate = prog.getByRole('spinbutton', { name: /^Loan interest rate, %/ });
  await expect(rate).toHaveValue('');
  await expectNoA11yViolations(page);
  // A rate completes it: a stored loan's editor.
  await commit(rate, '4');
  await expect(prog.getByText(DRAFT_LINE)).toHaveCount(0);
  await expect(prog.getByRole('radio', { name: 'Loan', exact: true })).toBeChecked();
  await expectNoA11yViolations(page);

  if (isMobile) await expectNoHorizontalScroll(page);
});

// ---- 2 to 6. editing ------------------------------------------------------------------------------

test('2. the bond preset: Undo names it and the levers follow', async ({ page }) => {
  await gotoSim(page);
  await openFunding(page);
  const preset = await addBond(page);
  const pool = preset.pools[0];
  await expect(poolRow(page, pool.id)).toBeVisible();

  const undo = panel(page).getByRole('button', { name: `Undo: Added: ${preset.label}` });
  await expect(undo).toBeEnabled();
  const before = await sentRev(page);
  await undo.click();
  await expect(poolRow(page, pool.id)).toHaveCount(0);
  await expect(panel(page).getByText('Nothing added yet.')).toBeVisible();
  await expectNewRevision(page, before);
});

test('3. your own pool: the amount error, then a yearly amount', async ({ page }) => {
  await gotoSim(page);
  await openFunding(page);
  await addMoney(page).click();
  await panel(page).getByRole('button', { name: 'Your own pool', exact: true }).click();
  const draft = panel(page).locator('[data-funding-row="draft"]');
  const amount = draft.getByRole('spinbutton', { name: /^Amount, \$ million a year/ });
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  const alert = await alertOf(amount);
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toHaveText(AMOUNT_ERROR);

  const before = await sentRev(page);
  await commit(amount, '60');
  await expect(draft).toHaveCount(0);
  const f = await savedFunding(page, (x) => x.pools.length === 1);
  const row = poolRow(page, f.pools[0].id);
  const added = row.getByRole('spinbutton', { name: /^Amount, \$ million a year/ });
  await expect(added).toHaveValue('60');
  await expect(added).not.toHaveAttribute('aria-invalid', 'true');
  await expect(await alertOf(added)).toHaveText('');
  await expect(row.locator('[data-funding-editor]')).toContainText(
    `$60 million a year from July ${YEAR}`
  );
  await expectNewRevision(page, before);
});

test('4. a dated change: the state switched off from next July', async ({ page }) => {
  await gotoSim(page);
  await openFunding(page);
  const state = baselineGroups(NO_FUNDING, BASELINE, ASOF).find((g) => g.group === 'state')!;
  const row = panel(page).getByRole('button', { name: new RegExp(`^${esc(state.name)} · `) });
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await panel(page).getByRole('button', { name: 'Change from a date', exact: true }).click();
  // The entry opens on July of the next year at 0%.
  await expect(panel(page).getByRole('combobox', { name: /^Month/ })).toHaveValue('7');
  await expect(panel(page).getByRole('spinbutton', { name: /^Year/ })).toHaveValue(String(YEAR));
  await expect(panel(page).getByRole('spinbutton', { name: /^Amount, % of today's/ })).toHaveValue(
    '0'
  );
  const before = await sentRev(page);
  await panel(page).getByRole('button', { name: 'Apply change' }).click();
  await expectNewRevision(page, before);

  const line = panel(page).locator(`[data-scale-line][data-scale-from="${JULY}"]`);
  await expect(line).toContainText(SWITCHED_OFF);
  await expect(row).toContainText(`Changes from July ${YEAR}`);

  // The coverage line's disclosure: below 100% from that month.
  const f = await savedFunding(page, (x) => x.baselineScale.length === 1);
  const steps = coverageSteps(f, BASELINE, ASOF, HORIZON);
  const step = steps.find((s) => s.from === JULY)!;
  expect(step).toBeDefined();
  const disclosure = panel(page).getByRole('button', { name: 'Coverage over time' });
  await disclosure.click();
  const region = panel(page).locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`);
  const text = coverageStepText(step, coverageSizeMixed(f, BASELINE, step.from));
  const item = region.getByRole('listitem').filter({ hasText: `From July ${YEAR}` });
  await expect(item).toHaveText(text);
  const pct = Number(/^From July \d{4}: (\d+)%/.exec(text)?.[1]);
  expect(pct).toBeLessThan(100);
});

test('5. market terms: a typed rate cut lets a guarantee run', async ({ page }) => {
  await gotoSim(page);
  await openFunding(page);
  const cut = panel(page).getByRole('spinbutton', {
    name: /^Guarantee rate cut, percentage points/
  });
  let before = await sentRev(page);
  await commit(cut, '0.5');
  await expectNewRevision(page, before);
  await savedFunding(page, (f) => f.terms.guaranteeRateCut === 0.005);

  const preset = await addBond(page);
  const prog = progRow(page, preset.programmes[0].id);
  await prog.locator(':scope > button').click();
  const guarantee = prog.getByRole('radio', { name: 'Loan guarantee', exact: true });
  await expect(guarantee).not.toHaveAttribute('aria-disabled', 'true');
  before = await sentRev(page);
  await guarantee.click();
  await expect(guarantee).toBeChecked();
  await expectNewRevision(page, before);
  const f = await savedFunding(page, (x) =>
    x.programmes.some((g) => g.instrument.kind === 'guarantee')
  );
  expect(f.terms).toEqual({ guaranteeRateCut: 0.005 });
});

test('6. the programme editor: a loan is a draft until its rate', async ({ page }) => {
  await gotoSim(page);
  await openFunding(page);
  const preset = await addBond(page);
  const pool = preset.pools[0];
  const row = poolRow(page, pool.id);

  // "+ What it pays for": a grant has every field, so it is added at once and selected.
  let before = await sentRev(page);
  await row.getByRole('button', { name: addProgrammeName(pool.label), exact: true }).click();
  await expectNewRevision(page, before);
  const f0 = await savedFunding(page, (x) => x.programmes.length === 2);
  const id = f0.programmes.find((g) => g.id !== preset.programmes[0].id)!.id;
  const prog = progRow(page, id);
  await expect(prog.locator(':scope > button')).toHaveAttribute('aria-pressed', 'true');

  // A loan on a bond has no sourced rate: a draft, so nothing reaches the levers.
  before = await sentRev(page);
  await prog.getByRole('radio', { name: 'Loan', exact: true }).click();
  await expect(prog.getByText(DRAFT_LINE)).toBeVisible();
  for (let k = 0; k < 5; k++) {
    await page.waitForTimeout(100);
    const l = await leverStatus(page);
    expect(l.sentRev).toBe(before);
    expect(l.status).toBe('current');
  }

  // The rate completes it: one revision.
  await commit(prog.getByRole('spinbutton', { name: /^Loan interest rate, %/ }), '4');
  await expect(prog.getByText(DRAFT_LINE)).toHaveCount(0);
  await expectNewRevision(page, before);
  const f1 = await savedFunding(page, (x) =>
    x.programmes.some((g) => g.id === id && g.instrument.kind === 'loan')
  );
  expect(f1.programmes.find((g) => g.id === id)!.instrument).toMatchObject({
    kind: 'loan',
    rate: 0.04
  });

  // The income mix.
  before = await sentRev(page);
  await commit(prog.getByRole('spinbutton', { name: /^Very low income, %/ }), '60');
  await expectNewRevision(page, before);
  const f2 = await savedFunding(
    page,
    (x) => x.programmes.find((g) => g.id === id)?.tiers?.veryLow === 0.6
  );
  const g = f2.programmes.find((x) => x.id === id)!;
  const sentence = programmeSentence(
    g,
    f2.pools.find((p) => p.id === g.pool)!
  );
  expect(sentence).toMatch(/^Loan to /);
  await expect(prog.locator(':scope > button')).toHaveText(sentence);
});

// ---- 7. the run -----------------------------------------------------------------------------------

test('7. a run: Public money, Who the homes are for, the market and the sources', async ({
  page
}) => {
  expect(marketLevel(CAL)).toBe('private');
  await gotoSim(page);
  await startRun(page);
  const face = results(page);
  await expect(face).toBeVisible();

  const money = face.getByTestId('fzp-money');
  await expect(money.getByRole('heading', { name: 'Public money' })).toBeVisible();
  const city = money.getByTestId('fzp-money-city');
  const all = money.getByTestId('fzp-money-all');
  await expect(city).toBeVisible();
  await expect(all).toBeVisible();
  // The City line comes first.
  expect(
    await city.evaluate(
      (a, b) => !!(a.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING),
      await all.elementHandle()
    )
  ).toBe(true);
  await expect(face.getByRole('heading', { name: 'Who the homes are for' })).toBeVisible();

  const details = face.getByRole('button', { name: 'Money details' });
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  const byIncome = face.getByRole('button', { name: 'Homes by income level' });
  await byIncome.click();
  await expect(byIncome).toHaveAttribute('aria-expanded', 'true');
  await expect(face.getByTestId('fzp-money-sources')).toBeVisible();
  await expect(face.getByTestId('fzp-tiers-table')).toBeVisible();
  await expectNoA11yViolations(page);

  // The market paragraph at the private level, its counts from calibration.json.
  const sources = face.getByTestId('fzp-sources');
  await sources.locator(':scope > summary').click();
  const paragraph = face.getByTestId('fzp-market');
  await expect(paragraph).toHaveText(marketText(CAL)!);
  const today = CAL.market!.today;
  await expect(paragraph).toContainText(
    `${today.observed.private} new projects started other than those proposing nearly all homes affordable`
  );
  await expect(paragraph).toContainText(`expected ${Math.round(today.implied)} of every kind`);

  await face.getByRole('button', { name: 'Where these numbers come from' }).click();
  const dialog = page.getByRole('dialog', { name: 'Where these numbers come from' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: "Today's market", exact: true })).toBeVisible();
  // The private level is in force: the all-starts line says why it is not, and the private
  // line has no "Not in force" of its own.
  await expect(dialog).toContainText('Private starts only: ');
  await expect(dialog).toContainText(
    "Not in force: today's public funding is modelled, so private starts run at their own level."
  );
  await expect(dialog).not.toContainText(
    'Not in force: this data has no public funding, so every start runs at one level.'
  );
  await expect(dialog.getByRole('heading', { name: 'Public money', exact: true })).toBeVisible();
  await expectNoA11yViolations(page, { include: 'dialog[open]', structure: true });
});

// ---- 8 to 10. sharing and loading -----------------------------------------------------------------

test('8. a published policy lists its public money', async ({ page, isMobile }) => {
  await gotoSim(page);
  await openFunding(page);
  await commit(
    panel(page).getByRole('spinbutton', { name: /^Guarantee rate cut, percentage points/ }),
    '0.5'
  );
  await addBond(page);
  const f = await savedFunding(
    page,
    (x) => x.pools.length === 1 && x.programmes.length === 1 && x.terms.guaranteeRateCut === 0.005
  );
  await closeSheet(page, isMobile);

  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Publish this policy|Published/ });
  await dialog.getByLabel('Title').fill('Bond and a rate cut');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.goto(link);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await waitSession(page);
  const summary = await openPolicy(page);
  await expect(summary).toHaveAttribute('aria-label', 'Policy (read-only)');
  const section = summary.getByRole('region', { name: 'Public money' });
  const rows = summaryRows(f, BASELINE, PRESETS).map((r) => r.text);
  await expect(section.getByRole('listitem')).toHaveText(rows);
  const g = f.programmes[0];
  const pool = f.pools[0];
  await expect(section).toContainText(pool.label);
  await expect(section).toContainText(programmeSentence(g, pool));
  await expect(section).toContainText(typedTermSummary('guaranteeRateCut', 0.005));
  await expectNoA11yViolations(page);
});

test('9. a schema-2 document opens on /s/<id> with the funding-added notice', async ({ page }) => {
  const doc = JSON.parse(PROFILE_TEXT) as { schema: number; datasetVersion: string };
  expect(doc.schema).toBe(2);
  // The sample was made on a release dataset: seeded on fixture-0, the dataset the e2e serves.
  const id = await seedPlanRow(page.request, {
    body: JSON.stringify({ ...doc, datasetVersion: 'fixture-0' }),
    datasetVersion: 'fixture-0',
    kind: 'sim'
  });
  const added = fundingNotices({
    upgradedFrom: 2,
    droppedScales: [],
    droppedProgrammes: [],
    unusable: false
  })[0];
  expect(added.id).toBe('funding-added');
  await gotoSim(page, `/s/${id}`);
  await expect(notices(page).filter({ hasText: added.text })).toHaveCount(1);
});

test('10. no baselineFunding: no tab, funding-off notice', async ({ page }) => {
  // An autosave holding added money, made by the app.
  await gotoSim(page);
  await openFunding(page);
  await addBond(page);
  await savedFunding(page, (f) => f.pools.length === 1);

  // The same data without baseline funding. A client navigation from /about, so the browser
  // fetches the calibration and the route serves it (docs/dev/fzp-mode.md, e2e notes).
  await page.route('**/scenarios/fzp/calibration.json', async (route) => {
    const res = await route.fetch();
    const cal = (await res.json()) as Record<string, unknown>;
    delete cal.baselineFunding;
    await route.fulfill({ response: res, json: cal });
  });
  await gotoHydrated(page, '/about');
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'Simulate', exact: true }).click();
  await expect(page).toHaveURL(/\/sim$/);
  await waitSession(page);

  const off = fundingNotices({
    upgradedFrom: null,
    droppedScales: [],
    droppedProgrammes: [],
    unusable: true
  })[0];
  expect(off.id).toBe('funding-off');
  await expect(notices(page).filter({ hasText: off.text })).toHaveCount(1);
  await openPolicy(page);
  await expect(tabOf(page, 'Protect')).toBeVisible();
  await expect(tabOf(page, 'Funding')).toHaveCount(0);
  // The money is kept, not used.
  expect((await storedFunding(page))?.pools).toHaveLength(1);
});
