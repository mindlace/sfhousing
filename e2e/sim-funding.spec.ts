// /sim's public money e2e (funding-ui spec 6, tests 1 to 10) on the timeline: the Public money
// kind's policies (City funding scale, a preset's fund, your own pool, market terms), each edited
// in the inspector, the Details money and tier blocks with the market paragraph and the sources
// dialog, the published policy's read-only summary, a schema-2 document's notice and a calibration
// without baseline funding. Runs against the VITE_E2E build on fixture-0 (window.__sfhFzp,
// src/lib/fzp/debug.ts). Every fixture value is read from fixture-0's calibration.json on disk and
// derived with the page's own view functions, never hard-coded.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { marketText } from '../src/lib/fzp/money-view';
import { marketLevel } from '../src/lib/sim/scenario/market';
import { marketBody } from '../src/lib/timeline/copy';
import type { FinanceLevers } from '../src/lib/sim/levers/types';
import type { Calibration, Pool, Programme } from '../src/lib/timelapse/types';
import {
  AMOUNT_ERROR,
  DRAFT_LINE,
  NO_LIMIT,
  SWITCHED_OFF,
  addProgrammeName,
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
import { baselineGroups, programmeSentence } from '../src/lib/sim-page/funding-view';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, openKind, slider, waitFilled } from './helpers/run';
import {
  SIM_KEY,
  gotoHydrated,
  headerAction,
  openHeaderMenu,
  openPublish,
  seedPlanRow,
  type Win
} from './helpers/sharing';
import { PLUS_NAME } from '../src/lib/timeline/test/plus';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

// ---- fixture values -----------------------------------------------------------------------------

const CAL_URL = new URL(
  './fixtures/data/fixture-0/scenarios/fzp/calibration.json',
  import.meta.url
);
const CAL = JSON.parse(readFileSync(CAL_URL, 'utf8')) as Calibration;
const BASELINE = CAL.baselineFunding!;
const ASOF = CAL.asOf;
/** A policy's funding with nothing changed (DEFAULT_LEVERS.finance). */
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

/** The session is ready and the forecast filled. */
async function waitSession(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

/** /sim (or `path`), the session ready. The map is not waited for: no test here reads it. */
async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await waitSession(page);
}

const refillCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.refills.length);

/** Waits for a refill after the `before`-th, and the forecast filled again. */
async function waitRefilled(page: Page, before: number): Promise<void> {
  await page.waitForFunction((n) => {
    const f = (window as FzpWin).__sfhFzp!;
    return f.refills.length > n && !f.stale && f.filledThrough === f.lastIndex;
  }, before);
}

const editor = (page: Page): Locator => page.getByTestId('inspector');
/** The header's Undo, made visible first (below 1024 px it waits in the Menu). */
const undoButton = (page: Page): Promise<Locator> => headerAction(page, /^Undo/);

type Doc = SfhFzpDebug['policy'];
const docOf = (page: Page): Promise<Doc> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.policy);

/** The document's public money, gathered as one `FinanceLevers` (every span, in order). */
function fundingOf(doc: Doc): FinanceLevers {
  const f: FinanceLevers = { baselineScale: [], pools: [], programmes: [], terms: {} };
  for (const p of doc.kinds.money)
    for (const s of p.spans) {
      const w = s.what;
      if (w.tag === 'scales') f.baselineScale.push(...w.entries);
      else if (w.tag === 'fund') {
        if (w.pool) f.pools.push(w.pool as Pool);
        f.programmes.push(...(w.programmes as Programme[]));
      } else if (w.tag === 'terms') Object.assign(f.terms, w.terms);
    }
  return f;
}

/** The document's funding once `ok` holds for it. */
async function fundingWhen(page: Page, ok: (f: FinanceLevers) => boolean): Promise<FinanceLevers> {
  await expect.poll(async () => ok(fundingOf(await docOf(page)))).toBe(true);
  return fundingOf(await docOf(page));
}

/** The autosaved document's policy, or null. */
const storedPolicy = (page: Page): Promise<Doc | null> =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (raw === null) return null;
    return (JSON.parse((JSON.parse(raw) as { plan: string }).plan) as { policy: Doc }).policy;
  }, SIM_KEY);

/** The first available preset whose pool is a general-obligation bond, as "+" offers it. */
function bondPreset(): FundingPreset {
  const p = PRESETS.find((x) => x.available && x.pools.some((y) => y.kind === 'goBond'));
  if (!p) throw new Error('fixture-0 offers no general-obligation bond preset');
  return p;
}

/** Adds the bond preset as a Public money policy and waits for its refill. Returns it. */
async function addBond(page: Page): Promise<FundingPreset> {
  const preset = bondPreset();
  const before = await refillCount(page);
  await addPolicy(page, 'Public money', preset.label);
  await waitRefilled(page, before);
  return preset;
}

/** The bond's pool row in its editor (the pool is the policy, so its row is open). */
const poolRow = (page: Page): Locator => editor(page).locator('[data-funding-row^="pool:"]');
/** A programme's nested row (`data-prog-row="<id>"`; a new programme's draft is "draft"). */
const progRow = (page: Page, id: string): Locator =>
  editor(page).locator(`[data-prog-row="${id}"]`);

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
/** Details, which the header score shows in the inspector. */
const results = (page: Page): Locator => page.getByTestId('tl-details');

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
}

// ---- 1. the policies ----------------------------------------------------------------------------

// Spec 6 test 1 in four tests, each scanning two or three of its states, so no test carries ten
// whole-page axe scans inside one test's budget.

test('1a. City funding scale and its rows, a11y light and dark', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Public money', 'City funding scale');

  // Today's funding: one row per group, its amount and its per-home figure from the fixture.
  const groups = baselineGroups(NO_FUNDING, BASELINE, ASOF);
  expect(groups.length).toBeGreaterThanOrEqual(3);
  for (const g of groups) {
    const amount = g.off ? SWITCHED_OFF : g.perYear === null ? NO_LIMIT : perYearText(g.perYear);
    const row = editor(page).getByRole('button', { name: new RegExp(`^${esc(g.name)} · `) });
    await expect(row).toContainText(`${g.name} · ${amount}`);
    await expect(row).toContainText(groupPaysText(g.perHome));
    await expect(row).toHaveAttribute('aria-pressed', 'false');
  }
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expectNoA11yViolations(page);
});

test('1b. a11y with Coverage over time and Sources and tiers open', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Public money', 'City funding scale');

  // "Coverage over time" open.
  const coverage = editor(page).getByRole('button', { name: 'Coverage over time' });
  await coverage.click();
  await expect(coverage).toHaveAttribute('aria-expanded', 'true');
  await expectNoA11yViolations(page);
  await coverage.click();

  // "Sources and tiers" open.
  const sources = editor(page).locator('details').filter({ hasText: 'Sources and tiers' });
  await sources.locator('summary').click();
  await expect(sources).toHaveAttribute('open', '');
  await expectNoA11yViolations(page);
});

test('1c. a11y with the "+" menu open and a pool editor expanded', async ({ page }) => {
  await gotoSim(page);

  // The kind's "+" menu open, then a preset's pool in its policy's editor.
  await page.getByRole('button', { name: PLUS_NAME['Public money'] }).click();
  await expect(page.getByRole('group', { name: 'Add to Public money' })).toBeVisible();
  await expectNoA11yViolations(page);
  await editor(page).getByRole('button', { name: 'Close editor' }).click();
  await addBond(page);
  // The pool's own editor: its header is plain text, not a toggle that cannot change (M3).
  await expect(poolRow(page).locator(':scope > button')).toHaveCount(0);
  await expect(poolRow(page).locator(':scope > [aria-pressed]')).toHaveCount(0);
  await expect(poolRow(page).locator(':scope > div').first()).toBeVisible();
  await expect(poolRow(page).locator('[data-funding-editor]')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('1d. a11y with a programme editor as a grant, a loan draft and a loan', async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  const preset = await addBond(page);
  const f = await fundingWhen(page, (x) => x.programmes.length === 1);
  expect(f.programmes[0].id).toBe(preset.programmes[0].id);

  // A programme editor expanded as a grant, with the income-mix fieldset.
  const prog = progRow(page, preset.programmes[0].id);
  await prog.locator(':scope > button').click();
  await expect(prog.locator('[data-programme-editor]')).toBeVisible();
  await expect(prog.getByRole('radio', { name: 'Grant', exact: true })).toBeChecked();
  await expect(prog.getByRole('group', { name: 'Who the homes are for' })).toBeVisible();
  await expectNoA11yViolations(page);

  // As a loan: a bond has no sourced loan rate, so the programme opens as a draft.
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

test('2. the bond preset: Undo names it and the forecast follows', async ({ page }) => {
  await gotoSim(page);
  const preset = await addBond(page);
  await expect(poolRow(page)).toBeVisible();
  expect((await docOf(page)).kinds.money).toHaveLength(1);

  const undo = await undoButton(page);
  await expect(undo).toHaveAccessibleName(`Undo: Added: ${preset.label}`);
  const before = await refillCount(page);
  await undo.click();
  await expect.poll(async () => (await docOf(page)).kinds.money).toHaveLength(0);
  await expect(editor(page)).toHaveCount(0);
  await waitRefilled(page, before);
});

test('3. your own pool: the amount error, then a yearly amount', async ({ page }) => {
  await gotoSim(page);
  await page.getByRole('button', { name: PLUS_NAME['Public money'] }).click();
  await page
    .getByRole('group', { name: 'Add to Public money' })
    .getByRole('button', { name: 'Your own pool', exact: true })
    .click();
  const draft = editor(page).locator('[data-funding-row="draft"]');
  const amount = draft.getByRole('spinbutton', { name: /^Amount, \$ million a year/ });
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  const alert = await alertOf(amount);
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toHaveText(AMOUNT_ERROR);

  const before = await refillCount(page);
  await commit(amount, '60');
  await expect(draft).toHaveCount(0);
  const f = await fundingWhen(page, (x) => x.pools.length === 1);
  const added = poolRow(page).getByRole('spinbutton', { name: /^Amount, \$ million a year/ });
  await expect(added).toHaveValue('60');
  await expect(added).not.toHaveAttribute('aria-invalid', 'true');
  await expect(await alertOf(added)).toHaveText('');
  await expect(editor(page).getByRole('heading', { name: f.pools[0].label })).toBeVisible();
  await expect(poolRow(page).locator('[data-funding-editor]')).toContainText(
    `$60 million a year from July ${YEAR}`
  );
  await waitRefilled(page, before);
});

test('4. a dated change: the state switched off from next July', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Public money', 'City funding scale');
  const state = baselineGroups(NO_FUNDING, BASELINE, ASOF).find((g) => g.group === 'state')!;
  const row = editor(page).getByRole('button', { name: new RegExp(`^${esc(state.name)} · `) });
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await editor(page).getByRole('button', { name: 'Change from a date', exact: true }).click();
  // The entry opens on July of the next year at 0%.
  await expect(editor(page).getByRole('combobox', { name: /^Month/ })).toHaveValue('7');
  await expect(editor(page).getByRole('spinbutton', { name: /^Year/ })).toHaveValue(String(YEAR));
  await expect(editor(page).getByRole('spinbutton', { name: /^Amount, % of today's/ })).toHaveValue(
    '0'
  );
  const before = await refillCount(page);
  await editor(page).getByRole('button', { name: 'Apply change' }).click();
  await waitRefilled(page, before);

  const line = editor(page).locator(`[data-scale-line][data-scale-from="${JULY}"]`);
  await expect(line).toContainText(SWITCHED_OFF);
  await expect(row).toContainText(`Changes from July ${YEAR}`);
  await fundingWhen(page, (x) => x.baselineScale.length === 1);

  // The coverage line's disclosure: below 100% from that month.
  const disclosure = editor(page).getByRole('button', { name: 'Coverage over time' });
  await disclosure.click();
  const region = editor(page).locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`);
  const item = region.getByRole('listitem').filter({ hasText: `From July ${YEAR}` });
  await expect(item).toHaveCount(1);
  const pct = Number(/^From July \d{4}: (\d+)%/.exec((await item.textContent())!.trim())?.[1]);
  expect(pct).toBeLessThan(100);
});

test('5. market terms: a typed rate cut lets a guarantee run', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Public money', 'Market terms');
  const cut = editor(page).getByRole('spinbutton', {
    name: /^Guarantee rate cut, percentage points/
  });
  let before = await refillCount(page);
  await commit(cut, '0.5');
  await waitRefilled(page, before);
  await fundingWhen(page, (f) => f.terms.guaranteeRateCut === 0.005);
  await editor(page).getByRole('button', { name: 'Close editor' }).click();

  const preset = await addBond(page);
  const prog = progRow(page, preset.programmes[0].id);
  await prog.locator(':scope > button').click();
  const guarantee = prog.getByRole('radio', { name: 'Loan guarantee', exact: true });
  await expect(guarantee).not.toHaveAttribute('aria-disabled', 'true');
  before = await refillCount(page);
  await guarantee.click();
  await expect(guarantee).toBeChecked();
  await waitRefilled(page, before);
  const f = await fundingWhen(page, (x) =>
    x.programmes.some((g) => g.instrument.kind === 'guarantee')
  );
  expect(f.terms).toEqual({ guaranteeRateCut: 0.005 });
});

test('6. the programme editor: a loan is a draft until its rate', async ({ page }) => {
  await gotoSim(page);
  const preset = await addBond(page);
  const pool = preset.pools[0];

  // "+ What it pays for": a grant has every field, so it is added at once and selected.
  let before = await refillCount(page);
  await poolRow(page)
    .getByRole('button', { name: addProgrammeName(pool.label), exact: true })
    .click();
  await waitRefilled(page, before);
  const f0 = await fundingWhen(page, (x) => x.programmes.length === 2);
  const id = f0.programmes.find((g) => g.id !== preset.programmes[0].id)!.id;
  const prog = progRow(page, id);
  await expect(prog.locator(':scope > button')).toHaveAttribute('aria-pressed', 'true');

  // A loan on a bond has no sourced rate: a draft, so nothing reaches the document or the worker.
  // The Undo name and the refills follow the document: with the draft line shown, each still
  // holds the grant's state.
  // Its label, read from the attribute: below 1024 px the button waits in the closed Menu.
  const undoLabel = page
    .getByRole('banner')
    .getByRole('button', { name: /^Undo/, includeHidden: true });
  const undoName = await undoLabel.getAttribute('aria-label');
  before = await refillCount(page);
  await prog.getByRole('radio', { name: 'Loan', exact: true }).click();
  await expect(prog.getByText(DRAFT_LINE)).toBeVisible();
  await expect(undoLabel).toHaveAttribute('aria-label', undoName!);
  expect(fundingOf(await docOf(page))).toEqual(f0);
  expect(await refillCount(page)).toBe(before);

  // The rate completes it: one refill.
  await commit(prog.getByRole('spinbutton', { name: /^Loan interest rate, %/ }), '4');
  await expect(prog.getByText(DRAFT_LINE)).toHaveCount(0);
  await waitRefilled(page, before);
  const f1 = await fundingWhen(page, (x) =>
    x.programmes.some((g) => g.id === id && g.instrument.kind === 'loan')
  );
  expect(f1.programmes.find((g) => g.id === id)!.instrument).toMatchObject({
    kind: 'loan',
    rate: 0.04
  });

  // The income mix.
  before = await refillCount(page);
  await commit(prog.getByRole('spinbutton', { name: /^Very low income, %/ }), '60');
  await waitRefilled(page, before);
  const f2 = await fundingWhen(
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

// ---- 7. Details -----------------------------------------------------------------------------------

test('7. Details: Public money, Who the homes are for, the market and the sources', async ({
  page
}) => {
  expect(marketLevel(CAL)).toBe('private');
  await gotoSim(page);
  await page.getByTestId('score-bar').click();
  const face = results(page);
  await expect(face).toBeVisible();
  // At today nothing is spent or finished yet: the blocks show from the first month on.
  await expect(face.getByTestId('fzp-money')).toHaveCount(0);
  await slider(page).focus();
  await page.keyboard.press('End');
  await waitFilled(page);

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
  // Details' wording: the sentence without its old closing disclaimer (timeline-ui rule 38).
  await expect(paragraph).toHaveText(marketBody(marketText(CAL)!));
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

test('8. a published policy lists its public money', async ({ page }) => {
  await gotoSim(page);
  await addPolicy(page, 'Public money', 'Market terms');
  await commit(
    editor(page).getByRole('spinbutton', { name: /^Guarantee rate cut, percentage points/ }),
    '0.5'
  );
  await editor(page).getByRole('button', { name: 'Close editor' }).click();
  await addBond(page);
  const f = await fundingWhen(
    page,
    (x) => x.pools.length === 1 && x.programmes.length === 1 && x.terms.guaranteeRateCut === 0.005
  );
  await editor(page).getByRole('button', { name: 'Close editor' }).click();

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
  await openKind(page, 'Public money');
  const pool = f.pools[0];
  const g = f.programmes[0];
  // The fund's read-only summary: its pool and what it pays for.
  await page
    .getByRole('button', { name: new RegExp(`^${esc(pool.label)}, `) })
    .last()
    .click();
  const fund = editor(page).getByRole('region', { name: 'Public money' });
  await expect(fund).toContainText(pool.label);
  await expect(fund).toContainText(programmeSentence(g, pool));
  await expectNoA11yViolations(page);
  // The terms' read-only summary (a phone's editor sheet closes first: the bars are under it).
  await editor(page).getByRole('button', { name: 'Close editor' }).click();
  await openKind(page, 'Public money');
  await page
    .getByRole('button', { name: /^Market terms, / })
    .last()
    .click();
  await expect(editor(page).getByRole('region', { name: 'Public money' })).toContainText(
    typedTermSummary('guaranteeRateCut', 0.005)
  );
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

test('10. no baselineFunding: no Public money kind, funding-off notice', async ({ page }) => {
  // An autosave holding added money, made by the app.
  await gotoSim(page);
  await addBond(page);
  await expect.poll(async () => (await storedPolicy(page))?.kinds.money.length).toBe(1);

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
  await expect(page.getByRole('button', { name: 'Zoning', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: PLUS_NAME['Public money'] })).toHaveCount(0);
  // The money is kept, not used.
  expect((await storedPolicy(page))?.kinds.money).toHaveLength(1);
});
