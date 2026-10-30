/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import LayersSection from './LayersSection.svelte';
import { policyFromLevers } from './policy';
import { PolicyStore } from './policy-store.svelte';

const CURRENT = 'Current law (Family Zoning Plan + SB 79 alternative plan)';
const FZP = 'Family Zoning Plan map';
const SB79 = 'SB 79 as written';
const BASE = 'Zoning before the Family Zoning Plan';
const ASSUME = 'Assume the City keeps an alternative plan after 2031';

const box = (name: string) => page.getByRole('checkbox', { name, exact: true });
const radio = (name: string) => page.getByRole('radio', { name, exact: true });

async function setup() {
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  await render(LayersSection, { props: { store } });
  return store;
}

describe('LayersSection', () => {
  it('lists the four layers in a "Zoning layers" group, current law checked', async () => {
    await page.viewport(1024, 768);
    await setup();
    await expect.element(page.getByRole('group', { name: 'Zoning layers' })).toBeInTheDocument();
    await expect.element(box(CURRENT)).toBeChecked();
    for (const name of [FZP, SB79, BASE]) await expect.element(box(name)).not.toBeChecked();
  });

  it('the last checked layer cannot be unchecked, and says why', async () => {
    await page.viewport(1024, 768);
    const store = await setup();
    await expect.element(box(CURRENT)).toBeDisabled();
    await expect.element(box(CURRENT)).toHaveAccessibleDescription(/at least one/i);
    await box(CURRENT).click({ force: true });
    expect(store.policy.stock).toEqual(['currentLaw']);
    expect(store.canUndo).toBe(false);
  });

  it('toggling SB 79 adds it in canonical order, as one labelled change', async () => {
    await page.viewport(1024, 768);
    const store = await setup();
    await box(SB79).click();
    expect(store.policy.stock).toEqual(['currentLaw', 'sb79']);
    expect(store.canUndo).toBe(true);
    // Two are checked: neither is disabled.
    await expect.element(box(CURRENT)).toBeEnabled();
    await box(CURRENT).click();
    expect(store.policy.stock).toEqual(['sb79']);
    await expect.element(box(SB79)).toBeDisabled();
    expect(store.undo()).toMatch(/Current law/);
    expect(store.policy.stock).toEqual(['currentLaw', 'sb79']);
  });

  it('the alternative-plan assumption is a described checkbox', async () => {
    await page.viewport(1024, 768);
    const store = await setup();
    await expect
      .element(box(ASSUME))
      .toHaveAccessibleDescription(
        'Otherwise SB 79 as written takes effect on 31 January 2032 (an assumption)'
      );
    await box(ASSUME).click();
    expect(store.policy.assumeAlternativePlanKept).toBe(true);
    expect(store.canUndo).toBe(true);
  });

  it('the compare radios set compare', async () => {
    await page.viewport(1024, 768);
    const store = await setup();
    await expect.element(page.getByRole('radiogroup', { name: 'Compare against' })).toBeVisible();
    await expect.element(radio('Current law')).toBeChecked();
    await radio(BASE).click();
    expect(store.policy.compare).toBe('preFzp');
    await expect.element(radio(BASE)).toBeChecked();
    await radio('Current law').click();
    expect(store.policy.compare).toBe('currentLaw');
  });
});
