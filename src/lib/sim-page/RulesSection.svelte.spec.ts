/// <reference types="@vitest/browser-playwright" />
// "New zoning rules" (sim runs): the rules with "Add transit rule", the inline form, Edit, and focus
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

const transit: ZoningRule = {
  id: 's1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [{ maxM: 402, stories: 8 }]
};

function setup(opts: { rules?: ZoningRule[]; catalog?: BrushCatalog | null } = {}) {
  const store = new PolicyStore(DEFAULT_POLICY);
  if (opts.rules) store.apply((p) => ({ ...p, rules: opts.rules! }), 'Allowed 8 stories');
  const announce = vi.fn();
  const sync = { result: vi.fn(() => undefined), retry: vi.fn() };
  const onsaved = vi.fn();
  render(RulesSection, { props: { store, sync, catalog: opts.catalog, announce, onsaved } });
  return { store, sync, announce, onsaved };
}

describe('RulesSection', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('lists the rules as cards with Edit enabled once the catalog is there', async () => {
    setup({ rules: [transit], catalog: testCatalog() });
    const rules = page.getByRole('list', { name: 'New zoning rules' });
    await expect
      .element(
        rules.getByRole('button', { name: /^Edit: Up to 8 stories within 402 m · Near Muni Metro/ })
      )
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

  it('"Add transit rule" opens the transit form', async () => {
    setup({ catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add transit rule' }).click();
    await expect.element(page.getByRole('form', { name: 'Add a transit rule' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Add a rule' }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Street', exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Commercial corridor' }).elements()).toHaveLength(0);
  });

  it('without transit data, "Add transit rule" is aria-disabled with its reason and opens nothing', async () => {
    setup({ catalog: testCatalog({ transit: false }) });
    const add = page.getByRole('button', { name: 'Add transit rule' });
    await expect.element(add).toHaveAttribute('aria-disabled', 'true');
    await expect.element(add).toHaveAccessibleDescription('This dataset has no transit data.');
    await add.click({ force: true }); // Playwright will not click an aria-disabled button
    expect(page.getByRole('form', { name: 'Add a transit rule' }).elements()).toHaveLength(0);
  });

  it('while the catalog loads, "Add transit rule" says so and stays focusable', async () => {
    setup({ catalog: undefined });
    const add = page.getByRole('button', { name: 'Add transit rule' });
    await expect.element(add).toHaveAccessibleDescription('Loading brush data…');
    (add.element() as HTMLElement).focus();
    await expect.element(add).toHaveFocus();
  });

  it('on md+ a rule form opens inline and its save is a labelled change', async () => {
    const { store, announce } = setup({ catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add transit rule' }).click();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    expect(store.policy.rules).toHaveLength(1);
    expect(store.policy.custom).toHaveLength(0);
    expect(store.undoLabel).toBe('Allowed up to 6 stories near regional rail');
    expect(announce).toHaveBeenCalledWith('Allowed up to 6 stories near regional rail');
    await expect.element(page.getByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add transit rule' })).toHaveFocus();
  });

  it('onsaved names the saved rule and whether the save changed the policy', async () => {
    const { store, onsaved } = setup({ rules: [transit], catalog: testCatalog() });
    await page.getByRole('button', { name: /^Edit:/ }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    expect(onsaved).toHaveBeenLastCalledWith(expect.objectContaining({ id: transit.id }), false);
    await page.getByRole('button', { name: 'Add transit rule' }).click();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    const added = store.policy.rules.at(-1)!;
    expect(onsaved).toHaveBeenLastCalledWith(added, true);
  });

  it('Edit waits for the catalog and says why', async () => {
    setup({ rules: [transit], catalog: undefined });
    const edit = page.getByRole('button', { name: /^Edit:/ });
    await expect.element(edit).toBeDisabled();
    await expect.element(edit).toHaveAccessibleDescription('Loading brush data…');
    await expect
      .element(
        page.getByRole('list', { name: 'New zoning rules' }).getByText('Loading brush data…')
      )
      .toBeVisible();
  });

  it('removing the last rule moves focus to "Add transit rule"', async () => {
    const { store } = setup({ rules: [transit], catalog: testCatalog() });
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.rules).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Add transit rule' })).toHaveFocus();
  });

  it('removing the rule whose Edit form is open closes the form and focuses "Add transit rule"', async () => {
    const { store } = setup({ rules: [transit], catalog: testCatalog() });
    await page.getByRole('button', { name: /^Edit:/ }).click();
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeVisible();
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.rules).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add transit rule' })).toHaveFocus();
  });

  it('removing the last rule while a new rule form is open keeps focus in the section', async () => {
    const { store } = setup({ rules: [transit], catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add transit rule' }).click();
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeVisible();
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.rules).toHaveLength(0);
    // The new rule's form stays open (it is not the removed rule's); focus goes into it.
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeVisible();
    await expect.poll(() => document.activeElement).not.toBe(document.body);
    expect(document.querySelector('form')?.contains(document.activeElement)).toBe(true);
  });
});
