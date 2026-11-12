/// <reference types="@vitest/browser-playwright" />
// The Funding tab (funding-ui spec 4.4, 4.5, 4.9, 4.10, 4.16): the coverage line and its
// disclosure, today's funding rows and the group editor with dated changes, "Money you add"
// when empty, and the selection clearing on an undo that removes the selected row.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { formatDollarsExact } from '$lib/fzp/format';
import { HORIZON } from '$lib/fzp/time';
import { dayOf } from '$lib/sim/scenario/dates';
import type { FinanceLevers } from '$lib/sim/levers/types';
import {
  MONTH_OFFER_CAVEAT,
  coverageSummaryText,
  scaleLimitDesc,
  smallProjectsCaveat
} from './funding-copy';
import { addPresetEdit, isRefused } from './funding-edit';
import { fundingPresets, nextFiscal } from './funding-presets';
import { baselineGroups, coverageSteps } from './funding-view';
import type { SimPolicy } from './policy';
import type { PolicyStore } from './policy-store.svelte';
import { FUND_ASOF, fundingCalibration, policyWith } from './test/funding';
import FundingTabHost from './test/FundingTabHost.svelte';

const JULY = nextFiscal(FUND_ASOF);
const YEAR = new Date(JULY * 86_400_000).getUTCFullYear();

function setup(policy: SimPolicy = policyWith({})) {
  const calibration = fundingCalibration();
  let store!: PolicyStore;
  render(FundingTabHost, {
    props: { policy, calibration, onready: (s: PolicyStore) => (store = s) }
  });
  return { store, calibration };
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
    await Promise.resolve();
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
  });
});
