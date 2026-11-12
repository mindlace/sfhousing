/// <reference types="@vitest/browser-playwright" />
// The Funding tab (funding-ui spec 4.4, 4.5, 4.9, 4.10, 4.16): the coverage line and its
// disclosure, today's funding rows and the group editor with dated changes, "Money you add"
// when empty, and the selection clearing on an undo that removes the selected row.
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { formatDollarsExact } from '$lib/fzp/format';
import { HORIZON } from '$lib/fzp/time';
import { dayOf } from '$lib/sim/scenario/dates';
import type { FinanceLevers } from '$lib/sim/levers/types';
import {
  AMOUNT_ERROR,
  CUSTOM_LINE,
  DRAFT_LINE,
  DRAFT_OPEN_DESC,
  MONTH_OFFER_CAVEAT,
  PAST_LINE,
  POOL_LIMIT_DESC,
  addProgrammeName,
  coverageSummaryText,
  limitAlert,
  scaleLimitDesc,
  smallProjectsCaveat
} from './funding-copy';
import type { FundingDrafts } from './funding-drafts.svelte';
import { addPresetEdit, isRefused } from './funding-edit';
import { fundingPresets, nextFiscal, type FundingPreset } from './funding-presets';
import { baselineGroups, coverageSteps } from './funding-view';
import type { SimPolicy } from './policy';
import type { PolicyStore } from './policy-store.svelte';
import { BOND_POLICY, FUND_ASOF, fundingCalibration, policyWith } from './test/funding';
import FundingTabHost from './test/FundingTabHost.svelte';

const JULY = nextFiscal(FUND_ASOF);
const YEAR = new Date(JULY * 86_400_000).getUTCFullYear();

function setup(policy: SimPolicy = policyWith({})) {
  const calibration = fundingCalibration();
  let store!: PolicyStore;
  let drafts!: FundingDrafts;
  render(FundingTabHost, {
    props: {
      policy,
      calibration,
      onready: (s: PolicyStore, d: FundingDrafts) => {
        store = s;
        drafts = d;
      }
    }
  });
  return { store, drafts, calibration };
}

const row = (name: RegExp) => page.getByRole('button', { name });
const announced = () =>
  [...document.querySelectorAll('[data-testid="announced"] li')].map((li) => li.textContent);

describe('FundingTab', () => {
  it('rows and amounts from the fragment', async () => {
    const { calibration } = setup();
    const groups = baselineGroups(policyWith({}).funding, calibration.baselineFunding!, FUND_ASOF);
    await expect.element(row(/^City · \$200 million a year/)).toBeVisible();
    await expect.element(row(/^State · \$100 million a year/)).toBeVisible();
    await expect.element(row(/^Federal tax credits · no limit/)).toBeVisible();
    for (const g of groups) {
      const r = row(new RegExp(`^${g.name} ·`));
      await expect.element(r).toHaveAttribute('aria-pressed', 'false');
      await expect
        .element(r)
        .toHaveTextContent(`pays ${formatDollarsExact(g.perHome)} of each home`);
    }
  });

  it('Nothing added yet.', async () => {
    setup();
    await expect.element(page.getByRole('heading', { name: 'Money you add' })).toBeVisible();
    await expect.element(page.getByText('Nothing added yet.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Add money' })).toBeVisible();
  });

  it('selecting a row expands its editor; again collapses', async () => {
    setup();
    const city = row(/^City ·/);
    await city.click();
    await expect.element(city).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByRole('heading', { name: 'Dated changes' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    await city.click();
    await expect.element(city).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-funding-editor]')).toBeNull();
  });

  it('City-group dated change shows as one line', async () => {
    setup(
      policyWith({
        baselineScale: [
          { pool: 'city-gf', from: JULY, scale: 0 },
          { pool: 'city-tax', from: JULY, scale: 0 }
        ]
      })
    );
    await expect.element(row(/^City ·/)).toHaveTextContent(`Changes from July ${YEAR}`);
    await row(/^City ·/).click();
    const removes = page.getByRole('button', {
      name: new RegExp(`^Remove change from July ${YEAR}`)
    });
    expect(removes.elements()).toHaveLength(1);
    const lines = document.querySelectorAll('[data-scale-line]');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('City money');
    expect(lines[0].textContent).toContain(`From July ${YEAR}: switched off`);
  });

  it('+ Change from a date is aria-disabled near 24', async () => {
    const baselineScale: FinanceLevers['baselineScale'] = [];
    for (let i = 0; i < 11; i++)
      baselineScale.push({ pool: 'federal', from: dayOf(YEAR + i, 7, 1), scale: i % 2 });
    for (let i = 0; i < 12; i++)
      baselineScale.push({ pool: 'state', from: dayOf(YEAR + i, 7, 1), scale: 0.5 });
    expect(baselineScale).toHaveLength(23);
    setup(policyWith({ baselineScale }));
    await row(/^City ·/).click();
    const add = page.getByRole('button', { name: 'Change from a date', exact: true });
    await expect.element(add).toHaveAttribute('aria-disabled', 'true');
    await expect.element(add).toHaveAccessibleDescription(scaleLimitDesc(2));
    // Playwright will not click an aria-disabled control; a user's click still reaches it.
    (add.element() as HTMLElement).click();
    await tick();
    expect(page.getByRole('button', { name: 'Apply change' }).elements()).toHaveLength(0);
  });

  it('state switch-off: coverage text and announcement', async () => {
    const { store, calibration } = setup();
    await row(/^State ·/).click();
    await page.getByRole('button', { name: 'Change from a date', exact: true }).click();
    // The entry opens on its "From" month, July of the next year, at 0%.
    await expect.element(page.getByRole('combobox', { name: /^Month/ })).toHaveFocus();
    await expect.element(page.getByRole('combobox', { name: /^Month/ })).toHaveValue('7');
    await expect.element(page.getByRole('spinbutton', { name: /^Year/ })).toHaveValue(YEAR);
    await expect
      .element(page.getByRole('spinbutton', { name: /^Amount, % of today's/ }))
      .toHaveValue(0);
    await page.getByRole('button', { name: 'Apply change' }).click();

    expect(store.undoLabel).toBe(`Today's funding: state switched off from July ${YEAR}`);
    const steps = coverageSteps(
      store.policy.funding,
      calibration.baselineFunding!,
      FUND_ASOF,
      HORIZON
    );
    const summary = coverageSummaryText(steps);
    expect(summary).toBe(`Affordable homes: fully funded today; from July ${YEAR}, 86%.`);
    const said = announced();
    expect(said).toHaveLength(1);
    expect(said[0]!.startsWith(`Today's funding: state switched off from July ${YEAR}.`)).toBe(
      true
    );
    expect(said[0]).toContain(summary);

    const disclosure = page.getByRole('button', { name: 'Coverage over time' });
    await disclosure.click();
    await expect.element(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect
      .element(page.getByText(new RegExp(`^From July ${YEAR}: 86%, not fully funded`)))
      .toBeVisible();
    await expect.element(row(/^State ·/)).toHaveTextContent(`Changes from July ${YEAR}`);
  });

  it('the coverage disclosure carries the R22 and R24 caveats', async () => {
    setup();
    const disclosure = page.getByRole('button', { name: 'Coverage over time' });
    await expect.element(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await expect.element(disclosure).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(disclosure.element().getAttribute('aria-controls')!);
    expect(region).not.toBeNull();
    expect(region!.textContent).toContain(smallProjectsCaveat(20));
    expect(region!.textContent).toContain(MONTH_OFFER_CAVEAT);
    // Caveats last: R24 is the final paragraph.
    expect(region!.lastElementChild!.textContent).toBe(MONTH_OFFER_CAVEAT);
  });

  it('no draggable element', async () => {
    setup();
    await row(/^City ·/).click();
    await page.getByRole('button', { name: 'Change from a date', exact: true }).click();
    await page.getByRole('button', { name: 'Coverage over time' }).click();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it('undo of the selected preset clears the selection', async () => {
    const { store, calibration } = setup();
    const preset = fundingPresets(calibration).find((p) => p.available && p.pools.length > 0)!;
    const e = addPresetEdit(store.policy, preset);
    if (isRefused(e)) throw new Error(e.refused);
    store.apply(e.change, e.label);
    const pool = store.policy.funding.pools[0];
    const r = row(new RegExp(`^${pool.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ·`));
    await r.click();
    await expect.element(r).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-funding-editor]')).not.toBeNull();
    store.undo();
    await expect.element(page.getByText('Nothing added yet.')).toBeVisible();
    expect(document.querySelector('[data-funding-editor]')).toBeNull();
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    // Redo brings the pool back, but not its selection (the vanished row was forgotten).
    store.redo();
    await expect.element(r).toBeVisible();
    await expect.element(r).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-funding-editor]')).toBeNull();
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  });

  it('re-applying the same dated change is no store change and no announcement', async () => {
    const { store } = setup();
    await row(/^State ·/).click();
    for (let k = 0; k < 2; k++) {
      await page.getByRole('button', { name: 'Change from a date', exact: true }).click();
      await page.getByRole('button', { name: 'Apply change' }).click();
    }
    expect(announced()).toHaveLength(1);
    store.undo();
    expect(store.canUndo).toBe(false);
  });

  it('Coverage over time lists only the dates the bundle changes', async () => {
    setup();
    const disclosure = page.getByRole('button', { name: 'Coverage over time' });
    await disclosure.click();
    const region = document.getElementById(disclosure.element().getAttribute('aria-controls')!)!;
    // No change dates on the default policy: today's step is the coverage line, not a list item.
    expect(region.querySelectorAll('li')).toHaveLength(0);
    expect(region.textContent).not.toMatch(/^From /m);
  });

  it('the group editor words baseline programmes per 4.5 and names + What it pays for', async () => {
    setup();
    await row(/^City ·/).click();
    await expect
      .element(
        page.getByText(
          'Grants to affordable homes of 20 or more: 20% of the uncovered cost ' +
            '(52% very low, 31% low, 17% moderate)'
        )
      )
      .toBeVisible();
    const add = page.getByRole('button', { name: addProgrammeName('City'), exact: true });
    await expect.element(add).toBeVisible();
    expect(add.element().textContent).toContain('What it pays for');
  });
});

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const addMoney = () => page.getByRole('button', { name: 'Add money', exact: true });
const ownPool = () => page.getByRole('button', { name: 'Your own pool', exact: true });
const kindSelect = () => page.getByRole('combobox', { name: /^Kind of money/ });
const amountInput = () => page.getByRole('spinbutton', { name: /^Amount, \$ million/ });
/** The pool editor's always-present alert for a field (the one referenced by its input). */
const errorOf = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((x) => x?.getAttribute('role') === 'alert');

function applyPreset(store: PolicyStore, preset: FundingPreset) {
  const e = addPresetEdit(store.policy, preset);
  if (isRefused(e)) throw new Error(e.refused);
  store.apply(e.change, e.label);
}

const presetById = (id: string) => fundingPresets(fundingCalibration()).find((p) => p.id === id)!;

/** A hand-made pool: once in July of next year, or yearly from it. */
const ownPoolOf = (id: string, kind: 'generalRevenue' | 'goBond' = 'generalRevenue') => ({
  id,
  kind,
  label: `Pool ${id}`,
  inflows: [{ kind: 'once' as const, day: JULY, dollars: 10_000_000 }],
  uncapped: false,
  debt: kind === 'goBond' ? { rate: 0.06, termYears: 20 } : null,
  leverage: 1
});

describe('FundingTab: adding money (4.6, 4.7)', () => {
  it('presets grouped under their group heading with their description', async () => {
    const { calibration } = setup();
    const presets = fundingPresets(calibration).filter((p) => p.available);
    const add = addMoney();
    await expect.element(add).toHaveAttribute('aria-expanded', 'false');
    await add.click();
    await expect.element(add).toHaveAttribute('aria-expanded', 'true');
    const chooser = document.getElementById(add.element().getAttribute('aria-controls')!)!;
    expect(chooser).not.toBeNull();
    const titles: Record<FundingPreset['group'], string> = {
      city: 'City money',
      bank: 'The public bank',
      state: 'State money',
      federal: 'Federal money'
    };
    const order = (['city', 'bank', 'state', 'federal'] as const).filter((g) =>
      presets.some((p) => p.group === g)
    );
    expect([...chooser.querySelectorAll('h4')].map((h) => h.textContent?.trim())).toEqual(
      order.map((g) => titles[g])
    );
    for (const p of presets) {
      const b = page.getByRole('button', { name: p.label, exact: true });
      await expect.element(b).toHaveAccessibleDescription(p.description);
      const desc = document.getElementById(b.element().getAttribute('aria-describedby')!)!;
      expect(desc.textContent?.trim()).toBe(p.description);
      // Under its group's heading: the nearest h4 before it.
      const heads = [...chooser.querySelectorAll('h4')].filter(
        (h) => h.compareDocumentPosition(b.element()) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      expect(heads.at(-1)?.textContent?.trim()).toBe(titles[p.group]);
    }
    for (const p of fundingPresets(calibration).filter((x) => !x.available))
      expect(page.getByRole('button', { name: p.label, exact: true }).elements()).toHaveLength(0);
    // "Your own pool" comes last.
    const buttons = [...chooser.querySelectorAll('button')];
    expect(buttons.at(-1)?.textContent?.trim()).toBe('Your own pool');
  });

  it('a preset adds one undo step with its label and focuses the first field', async () => {
    const { store } = setup();
    const preset = presetById('housing-bond');
    await addMoney().click();
    await page.getByRole('button', { name: preset.label, exact: true }).click();
    expect(store.undoLabel).toBe(`Added: ${preset.label}`);
    await expect.element(kindSelect()).toHaveFocus();
    await expect.element(addMoney()).toHaveAttribute('aria-expanded', 'false');
    const pool = store.policy.funding.pools[0];
    await expect
      .element(page.getByRole('button', { name: new RegExp(`^${esc(pool.label)} ·`) }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(announced()[0]!.startsWith(`Added: ${preset.label}.`)).toBe(true);
    store.undo();
    expect(store.canUndo).toBe(false);
  });

  it('a preset-made pool shows a source line under every field valueSource covers', async () => {
    const { store } = setup();
    const preset = presetById('housing-bond');
    await addMoney().click();
    await page.getByRole('button', { name: preset.label, exact: true }).click();
    const editor = document.querySelector('[data-funding-editor]')!;
    const text = editor.textContent ?? '';
    const pool = store.policy.funding.pools[0];
    // The amount and the bond terms are sourced; the date is a starting value (tier 4).
    expect(pool.inflows[0].kind).toBe('once');
    expect(text).toContain('From A bond of what 0.01 point on the bond tax rate supports (tier 2)');
    expect(text.match(/From Bond interest rate and term \(tier 2\)/g)).toHaveLength(2);
    expect(text).toContain(CUSTOM_LINE);
    // The name and the kind are choices: no line.
    const lines = [...editor.querySelectorAll('[data-source-line]')].map((x) => x.textContent);
    expect(lines).toHaveLength(4);
  });

  it('draft pool: Not added yet, Discard, disables Add money and presets, no store change', async () => {
    const { store, drafts } = setup();
    const before = store.policy;
    await addMoney().click();
    await ownPool().click();
    await expect.element(page.getByText(DRAFT_LINE)).toBeVisible();
    const name = `City general fund, ${YEAR}`;
    await expect
      .element(page.getByRole('button', { name: `Discard ${name}`, exact: true }))
      .toBeVisible();
    await expect.element(kindSelect()).toHaveFocus();
    await expect.element(kindSelect()).toHaveValue('generalRevenue');
    await expect.element(page.getByRole('radio', { name: /^Every year/ })).toBeChecked();
    // The empty amount shows its error at once.
    const amount = amountInput();
    await expect.element(amount).toHaveAttribute('aria-invalid', 'true');
    expect(errorOf(amount.element())?.textContent?.trim()).toBe(AMOUNT_ERROR);
    await expect.element(addMoney()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(addMoney()).toHaveAccessibleDescription(DRAFT_OPEN_DESC);
    const chooser = document.getElementById(addMoney().element().getAttribute('aria-controls')!)!;
    for (const b of chooser.querySelectorAll('button'))
      expect(b.getAttribute('aria-disabled')).toBe('true');
    // A press does nothing.
    (addMoney().element() as HTMLElement).click();
    await tick();
    await expect.element(addMoney()).toHaveAttribute('aria-expanded', 'false');
    expect(store.canUndo).toBe(false);
    expect(store.policy).toBe(before);
    expect(drafts.isOpen).toBe(true);
    // Discard: gone, focus on "+ Add money".
    await page.getByRole('button', { name: `Discard ${name}`, exact: true }).click();
    expect(drafts.isOpen).toBe(false);
    expect(page.getByText(DRAFT_LINE).elements()).toHaveLength(0);
    await expect.element(addMoney()).toHaveFocus();
    expect(store.policy).toBe(before);
  });

  it('draft pool becomes a row with Added: your own pool once its amount is valid', async () => {
    const { store, drafts } = setup();
    await addMoney().click();
    await ownPool().click();
    await amountInput().fill('60');
    await userEvent.keyboard('{Enter}');
    expect(store.undoLabel).toBe('Added: your own pool');
    expect(drafts.isOpen).toBe(false);
    const pool = store.policy.funding.pools[0];
    expect(pool.id).toBe('u-pool-1');
    expect(pool.inflows).toEqual([
      { kind: 'yearly', from: JULY, to: null, dollarsPerYear: 60_000_000 }
    ]);
    expect(page.getByText(DRAFT_LINE).elements()).toHaveLength(0);
    const r = page.getByRole('button', { name: new RegExp(`^City general fund, ${YEAR} ·`) });
    await expect.element(r).toHaveAttribute('aria-pressed', 'true');
    // Focus stays in the field the user committed, now in the row.
    await expect.element(amountInput()).toHaveFocus();
    await expect.element(amountInput()).toHaveValue(60);
    expect(
      document.activeElement?.closest('[data-funding-row]')?.getAttribute('data-funding-row')
    ).toBe('pool:u-pool-1');
    store.undo();
    expect(store.policy.funding.pools).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('amount error has role=alert and aria-invalid, and clears on undo', async () => {
    const { store } = setup();
    applyPreset(store, presetById('general-revenue'));
    const pool = store.policy.funding.pools[0];
    await page.getByRole('button', { name: new RegExp(`^${esc(pool.label)} ·`) }).click();
    const amount = amountInput();
    await expect.element(amount).toHaveValue(36.7);
    await amount.fill('5');
    await userEvent.keyboard('{Enter}');
    expect(store.policy.funding.pools[0].inflows[0]).toMatchObject({ dollarsPerYear: 5_000_000 });
    const after = store.policy;
    await amount.fill('0');
    await userEvent.keyboard('{Enter}');
    await expect.element(amount).toHaveAttribute('aria-invalid', 'true');
    const alert = errorOf(amount.element())!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe(AMOUNT_ERROR);
    expect(store.policy).toBe(after);
    store.undo();
    await expect.element(amount).toHaveValue(36.7);
    await expect.element(amount).not.toHaveAttribute('aria-invalid', 'true');
    expect(alert.textContent?.trim()).toBe('');
    // Redo brings back the value the error was typed over, but not the error or its text.
    store.redo();
    await expect.element(amount).toHaveValue(5);
    await expect.element(amount).not.toHaveAttribute('aria-invalid', 'true');
    expect(alert.textContent?.trim()).toBe('');
  });

  it('a preset-made bond rate changed by hand reads Custom, not sourced.', async () => {
    const { store } = setup();
    applyPreset(store, presetById('housing-bond'));
    const pool = store.policy.funding.pools[0];
    await page.getByRole('button', { name: new RegExp(`^${esc(pool.label)} ·`) }).click();
    const rate = page.getByRole('spinbutton', { name: /^Interest rate, %/ });
    await rate.fill('5');
    await userEvent.keyboard('{Enter}');
    expect(store.policy.funding.pools[0].debt?.rate).toBe(0.05);
    const rateLine = () =>
      rate.element().closest('label')!.parentElement!.querySelector('[data-source-line]')
        ?.textContent;
    await expect.poll(rateLine).toBe(CUSTOM_LINE);
    // The hand-made form ("Your value … Sourced: …") is not used on a preset-made pool.
    const editor = document.querySelector('[data-funding-editor]')!;
    expect(editor.textContent).not.toContain('Your value (custom, not sourced). Sourced:');
    expect(editor.textContent).toContain('From Bond interest rate and term (tier 2)');
  });

  it('a generated name follows kind, first year and money-in rows until edited', async () => {
    const { store } = setup();
    await addMoney().click();
    await ownPool().click();
    await amountInput().fill('60');
    await userEvent.keyboard('{Enter}');
    const label = () => store.policy.funding.pools[0].label;
    expect(label()).toBe(`City general fund, ${YEAR}`);
    // Kind (M5).
    await kindSelect().selectOptions('goBond');
    expect(label()).toBe(`City bond, ${YEAR}`);
    // First year (M5).
    const year0 = page.getByRole('spinbutton', { name: /^Year\s?, From, row 1/ });
    await year0.fill(String(YEAR + 2));
    await userEvent.keyboard('{Enter}');
    expect(label()).toBe(`City bond, ${YEAR + 2}`);
    // A new row copies the last: the first year, and the name, stay.
    await page.getByRole('button', { name: /^Add money in/ }).click();
    expect(store.policy.funding.pools[0].inflows).toHaveLength(2);
    expect(label()).toBe(`City bond, ${YEAR + 2}`);
    // Row 1 earlier, then removed: the name follows row 2's year.
    const year1 = page.getByRole('spinbutton', { name: /^Year\s?, From, row 1/ });
    await year1.fill(String(YEAR));
    await userEvent.keyboard('{Enter}');
    expect(label()).toBe(`City bond, ${YEAR}`);
    await page.getByRole('button', { name: 'Remove money in, row 1', exact: true }).click();
    expect(store.policy.funding.pools[0].inflows).toHaveLength(1);
    expect(label()).toBe(`City bond, ${YEAR + 2}`);
    expect(store.undoLabel).toMatch(/^Removed money in: /);
    // Once / every year keeps the generated name.
    await page.getByRole('radio', { name: /^Once\s?, row 1/ }).click();
    expect(store.policy.funding.pools[0].inflows[0].kind).toBe('once');
    expect(label()).toBe(`City bond, ${YEAR + 2}`);
    // Once the user edits the name, it is kept.
    const name = page.getByRole('textbox', { name: /^Name/ });
    await name.fill('My bond');
    await userEvent.keyboard('{Enter}');
    expect(label()).toBe('My bond');
    await kindSelect().selectOptions('cop');
    expect(label()).toBe('My bond');
    await page.getByRole('button', { name: /^Add money in/ }).click();
    expect(label()).toBe('My bond');
  });

  it('a dated-change preset selects its group and focuses the new change', async () => {
    const { store } = setup();
    const preset = presetById('state-off');
    expect(preset.pools).toHaveLength(0);
    await addMoney().click();
    await page.getByRole('button', { name: preset.label, exact: true }).click();
    expect(store.undoLabel).toBe(`Added: ${preset.label}`);
    await expect.element(row(/^State ·/)).toHaveAttribute('aria-pressed', 'true');
    const from = preset.baselineScale[0].from;
    await expect
      .poll(() => (document.activeElement as HTMLElement | null)?.dataset.scaleFrom)
      .toBe(String(from));
    expect(document.activeElement?.hasAttribute('data-scale-line')).toBe(true);
  });

  it('the chooser alert clears when the chooser closes', async () => {
    const baselineScale: FinanceLevers['baselineScale'] = [];
    for (let i = 0; i < 12; i++)
      baselineScale.push({ pool: 'federal', from: dayOf(YEAR + i, 7, 1), scale: i % 2 });
    for (let i = 0; i < 12; i++)
      baselineScale.push({ pool: 'city-tax', from: dayOf(YEAR + i, 7, 1), scale: 0.5 });
    const { store } = setup(policyWith({ baselineScale }));
    const before = store.policy;
    const preset = presetById('state-off');
    await addMoney().click();
    await page.getByRole('button', { name: preset.label, exact: true }).click();
    expect(store.policy).toBe(before);
    const chooser = document.getElementById(addMoney().element().getAttribute('aria-controls')!)!;
    const alert = () => chooser.parentElement!.querySelector('[role="alert"]')!.textContent?.trim();
    expect(alert()).toBe(limitAlert('baselineScale'));
    await addMoney().click();
    await expect.element(addMoney()).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(alert).toBe('');
  });

  it('Add money aria-disabled at 12 pools', async () => {
    const pools = Array.from({ length: 12 }, (_, i) => ownPoolOf(`u-pool-${i + 1}`));
    setup(policyWith({ pools }));
    const add = addMoney();
    await expect.element(add).toHaveAttribute('aria-disabled', 'true');
    await expect.element(add).toHaveAccessibleDescription(POOL_LIMIT_DESC);
    (add.element() as HTMLElement).click();
    await tick();
    await expect.element(add).toHaveAttribute('aria-expanded', 'false');
  });

  it('focus after removing the last pool goes to Add money', async () => {
    const { store } = setup(BOND_POLICY);
    const name = BOND_POLICY.funding.pools[0].label;
    await page.getByRole('button', { name: new RegExp(`^${esc(name)} ·`) }).click();
    await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
    expect(store.undoLabel).toBe(`Removed: ${name} and its programme`);
    expect(store.policy.funding.programmes).toHaveLength(0);
    await expect.element(addMoney()).toHaveFocus();
  });

  it('focus after removing a pool goes to the row now at its index', async () => {
    setup(policyWith({ pools: [ownPoolOf('u-pool-1'), ownPoolOf('u-pool-2')] }));
    await page.getByRole('button', { name: /^Pool u-pool-1 ·/ }).click();
    await page.getByRole('button', { name: 'Remove Pool u-pool-1', exact: true }).click();
    await expect.element(page.getByRole('button', { name: /^Pool u-pool-2 ·/ })).toHaveFocus();
  });

  it('hand-made goBond starts at POOL_KIND_DEFAULTS rate and term with their source line', async () => {
    const { store } = setup(policyWith({ pools: [ownPoolOf('u-pool-1')] }));
    await page.getByRole('button', { name: /^Pool u-pool-1 ·/ }).click();
    // A general fund pool has no evidence field: no line.
    expect(document.querySelectorAll('[data-funding-editor] [data-source-line]')).toHaveLength(0);
    await kindSelect().selectOptions('goBond');
    expect(store.policy.funding.pools[0]).toMatchObject({
      kind: 'goBond',
      debt: { rate: 0.06, termYears: 20 }
    });
    expect(store.undoLabel).toBe(
      'Changed kind: Pool u-pool-1 is City housing bond (general obligation)'
    );
    const rate = page.getByRole('spinbutton', { name: /^Interest rate, %/ });
    await expect.element(rate).toHaveValue(6);
    await expect.element(rate).toHaveAttribute('step', 'any');
    await expect.element(page.getByRole('spinbutton', { name: /^Years to repay/ })).toHaveValue(20);
    const lines = () =>
      [...document.querySelectorAll('[data-funding-editor] [data-source-line]')].map((x) =>
        x.textContent?.trim()
      );
    expect(lines()).toEqual([
      'From Bond interest rate and term (tier 2)',
      'From Bond interest rate and term (tier 2)'
    ]);
    await rate.fill('5');
    await userEvent.keyboard('{Enter}');
    expect(store.policy.funding.pools[0].debt?.rate).toBe(0.05);
    await expect
      .poll(lines)
      .toEqual([
        'Your value (custom, not sourced). Sourced: 6% from Bond interest rate and term.',
        'From Bond interest rate and term (tier 2)'
      ]);
  });

  it('a pre-asOf inflow shows Before the simulation starts: not counted.', async () => {
    const past = dayOf(2020, 7, 1);
    const pool = {
      ...ownPoolOf('u-pool-1'),
      inflows: [
        { kind: 'once' as const, day: past, dollars: 1_000_000 },
        { kind: 'once' as const, day: JULY, dollars: 2_000_000 }
      ]
    };
    const gone = { ...ownPoolOf('u-pool-2'), inflows: [pool.inflows[0]] };
    setup(policyWith({ pools: [pool, gone] }));
    // A pool none of whose money arrives in the simulation: the line under its row.
    const goneRow = document.querySelector('[data-funding-row="pool:u-pool-2"]')!;
    expect(goneRow.textContent).toContain(PAST_LINE);
    const row1 = document.querySelector('[data-funding-row="pool:u-pool-1"]')!;
    expect(row1.textContent).not.toContain(PAST_LINE);
    await page.getByRole('button', { name: /^Pool u-pool-1 ·/ }).click();
    await expect.element(page.getByText(PAST_LINE).first()).toBeVisible();
    // Only the first row of money in is before the start.
    expect(row1.textContent!.split(PAST_LINE)).toHaveLength(2);
  });
});
