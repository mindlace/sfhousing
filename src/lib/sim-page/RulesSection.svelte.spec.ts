/// <reference types="@vitest/browser-playwright" />
// "New zoning rules" (sim runs): the rules with "Add a rule", the inline form, Edit, and focus
// after the last rule is removed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { BrushCatalog } from '$lib/sim/levers/brushes';
import { DEFAULT_POLICY, type ZoningRule } from './policy';
import { PolicyStore } from './policy-store.svelte';
import RulesSection from './RulesSection.svelte';
import { testCatalog } from './test/catalog';

const street: ZoningRule = {
  id: 's1',
  kind: 'street',
  classes: ['arterial'],
  names: [],
  depth: 0,
  ncOnly: false,
  stories: 8
};

function setup(opts: { rules?: ZoningRule[]; catalog?: BrushCatalog | null } = {}) {
  const store = new PolicyStore(DEFAULT_POLICY);
  if (opts.rules) store.apply((p) => ({ ...p, rules: opts.rules! }), 'Allowed 8 stories');
  const announce = vi.fn();
  const sync = { result: vi.fn(() => undefined), retry: vi.fn() };
  render(RulesSection, { props: { store, sync, catalog: opts.catalog, announce } });
  return { store, sync, announce };
}

describe('RulesSection', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('lists the rules as cards with Edit enabled once the catalog is there', async () => {
    setup({ rules: [street], catalog: testCatalog() });
    const rules = page.getByRole('list', { name: 'New zoning rules' });
    await expect
      .element(rules.getByRole('button', { name: /^Edit: Up to 8 stories · Arterials/ }))
      .toBeEnabled();
    await expect
      .element(page.getByText('Each lot takes the tallest rule that covers it, never below FZP.'))
      .toBeVisible();
  });

  it('has no tools, key or custom list (those are Custom zoning)', async () => {
    setup({ catalog: testCatalog() });
    expect(page.getByRole('radiogroup', { name: 'Brush tool' }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(0);
    expect(page.getByText('Map key').elements()).toHaveLength(0);
  });

  it('"Add a rule" offers Transit, Street and Commercial corridor, and no Area', async () => {
    setup({ catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const kinds = page
      .getByRole('button')
      .elements()
      .map((e) => e.textContent?.trim())
      .filter((t) => ['Transit', 'Street', 'Commercial corridor', 'Area'].includes(t ?? ''));
    expect(kinds).toEqual(['Transit', 'Street', 'Commercial corridor']);
  });

  it('a rule kind without its data says why', async () => {
    setup({ catalog: testCatalog({ frontage: false }) });
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await expect.element(page.getByRole('button', { name: 'Transit' })).toBeEnabled();
    const streetBtn = page.getByRole('button', { name: 'Street', exact: true });
    await expect.element(streetBtn).toBeDisabled();
    await expect
      .element(streetBtn)
      .toHaveAccessibleDescription('This dataset has no street frontage data.');
    await expect.element(page.getByRole('button', { name: 'Commercial corridor' })).toBeDisabled();
    await expect
      .element(page.getByText('This dataset has no street frontage data.').first())
      .toBeVisible();
  });

  it('kinds wait for the catalog', async () => {
    setup({ catalog: undefined });
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await expect.element(page.getByRole('button', { name: 'Transit' })).toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'Transit' }))
      .toHaveAccessibleDescription('Loading brush data…');
  });

  it('on md+ a rule form opens inline and its save is a labelled change', async () => {
    const { store, announce } = setup({ catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await page.getByRole('button', { name: 'Transit' }).click();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    expect(store.policy.rules).toHaveLength(1);
    expect(store.policy.custom).toHaveLength(0);
    expect(store.undoLabel).toBe('Allowed up to 6 stories near regional rail');
    expect(announce).toHaveBeenCalledWith('Allowed up to 6 stories near regional rail');
    await expect.element(page.getByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add a rule' })).toHaveFocus();
  });

  it('Edit waits for the catalog and says why', async () => {
    setup({ rules: [street], catalog: undefined });
    const edit = page.getByRole('button', { name: /^Edit:/ });
    await expect.element(edit).toBeDisabled();
    await expect.element(edit).toHaveAccessibleDescription('Loading brush data…');
    await expect
      .element(
        page.getByRole('list', { name: 'New zoning rules' }).getByText('Loading brush data…')
      )
      .toBeVisible();
  });

  it('removing the last rule moves focus to "Add a rule"', async () => {
    const { store } = setup({ rules: [street], catalog: testCatalog() });
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.rules).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Add a rule' })).toHaveFocus();
  });

  it('removing the rule whose Edit form is open closes the form and focuses "Add a rule"', async () => {
    const { store } = setup({ rules: [street], catalog: testCatalog() });
    await page.getByRole('button', { name: /^Edit:/ }).click();
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeVisible();
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.rules).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add a rule' })).toHaveFocus();
  });

  it('removing the last rule while a new rule form is open keeps focus in the section', async () => {
    const { store } = setup({ rules: [street], catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await page.getByRole('button', { name: 'Street', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeVisible();
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.rules).toHaveLength(0);
    // The new rule's form stays open (it is not the removed rule's); focus goes into it.
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeVisible();
    await expect.poll(() => document.activeElement).not.toBe(document.body);
    expect(document.querySelector('form')?.contains(document.activeElement)).toBe(true);
  });
});
