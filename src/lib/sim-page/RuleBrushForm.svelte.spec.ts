/// <reference types="@vitest/browser-playwright" />
// The transit rule form: what it saves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_BANDS, type ZoningRule } from './policy';
import RuleBrushForm from './RuleBrushForm.svelte';
import { testCatalog } from './test/catalog';

function setup(initial?: ZoningRule) {
  const onsave = vi.fn();
  const oncancel = vi.fn();
  const view = render(RuleBrushForm, {
    props: { catalog: testCatalog(), initial, onsave, oncancel }
  });
  return { onsave, oncancel, unmount: async () => (await view).unmount() };
}

const save = () => page.getByRole('button', { name: 'Save rule' });

describe('RuleBrushForm', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('Transit: one stop type ticked saves the default bands, and nothing else', async () => {
    const { onsave } = setup();
    await expect.element(save()).toBeEnabled();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await save().click();
    expect(onsave).toHaveBeenCalledOnce();
    const b = onsave.mock.calls[0][0] as ZoningRule;
    expect(b).toEqual({
      id: b.id,
      kind: 'transit',
      stopTypes: ['regionalRail'],
      bands: DEFAULT_BANDS
    });
    expect(b.id).toMatch(/^[1-9A-Za-z]{12}$/);
  });

  it('Transit: shows each stop count, and bands can be added up to three', async () => {
    setup();
    await expect
      .element(page.getByRole('checkbox', { name: /^Muni Metro · 40 stops$/ }))
      .toBeVisible();
    const add = page.getByRole('button', { name: 'Add a band' });
    await add.click();
    await expect
      .element(page.getByRole('spinbutton', { name: 'Band 3 distance (m)' }))
      .toBeVisible();
    await expect.element(add).toBeDisabled();
    await page.getByRole('button', { name: 'Remove band 3' }).click();
    await expect
      .element(page.getByRole('spinbutton', { name: 'Band 3 distance (m)' }))
      .not.toBeInTheDocument();
  });

  it('names the form for a new rule and an edit', async () => {
    const view = setup();
    await expect
      .element(page.getByRole('form', { name: 'Add a transit rule', exact: true }))
      .toBeVisible();
    await view.unmount();
    const initial: ZoningRule = {
      id: 'transit12345',
      kind: 'transit',
      stopTypes: ['metro'],
      bands: DEFAULT_BANDS
    };
    setup(initial);
    await expect
      .element(page.getByRole('form', { name: 'Edit a transit rule', exact: true }))
      .toBeVisible();
  });

  it('editing a saved transit rule keeps its id and values', async () => {
    const initial: ZoningRule = {
      id: 'keepMe123456',
      kind: 'transit',
      stopTypes: ['metro'],
      bands: [{ maxM: 300, stories: 9 }]
    };
    const { onsave } = setup(initial);
    await expect.element(page.getByRole('checkbox', { name: /^Muni Metro/ })).toBeChecked();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await save().click();
    expect(onsave.mock.calls[0][0]).toEqual({
      id: 'keepMe123456',
      kind: 'transit',
      stopTypes: ['regionalRail', 'metro'],
      bands: [{ maxM: 300, stories: 9 }]
    });
  });

  it('Save with nothing chosen announces why and saves nothing (WCAG 4.1.3)', async () => {
    const { onsave } = setup();
    const reason = 'Choose at least one stop type.';
    const status = page.getByRole('status').filter({ hasText: reason });
    await expect.element(status).not.toBeInTheDocument();
    await save().click();
    expect(onsave).not.toHaveBeenCalled();
    await expect.element(status).toBeVisible();
    await expect.element(save()).toHaveAccessibleDescription(reason);
    // The reason follows the fields, and clears once the rule is complete.
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await expect.element(status).not.toBeInTheDocument();
    await save().click();
    expect(onsave).toHaveBeenCalledOnce();
  });

  it('two bands at one distance are announced at once and block Save', async () => {
    const { onsave } = setup();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await page.getByRole('spinbutton', { name: 'Band 2 distance (m)' }).fill('402');
    const status = page
      .getByRole('status')
      .filter({ hasText: 'Each band needs a different distance.' });
    await expect.element(status).toBeVisible();
    await save().click();
    expect(onsave).not.toHaveBeenCalled();
    await page.getByRole('spinbutton', { name: 'Band 2 distance (m)' }).fill('805');
    await expect.element(status).not.toBeInTheDocument();
    await save().click();
    expect(onsave).toHaveBeenCalledOnce();
  });

  it('an outer band taller than the band inside it is announced and blocks Save', async () => {
    const { onsave } = setup();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    // Entered out of order: band 1 is the outer band.
    await page.getByRole('spinbutton', { name: 'Band 1 distance (m)' }).fill('805');
    await page.getByRole('spinbutton', { name: 'Band 1 stories' }).fill('8');
    await page.getByRole('spinbutton', { name: 'Band 2 distance (m)' }).fill('402');
    await page.getByRole('spinbutton', { name: 'Band 2 stories' }).fill('6');
    const status = page
      .getByRole('status')
      .filter({ hasText: "An outer band can't be taller than the band inside it" });
    await expect.element(status).toBeVisible();
    await save().click();
    expect(onsave).not.toHaveBeenCalled();
    // Out of order but never taller outward: saves.
    await page.getByRole('spinbutton', { name: 'Band 1 stories' }).fill('4');
    await expect.element(status).not.toBeInTheDocument();
    await save().click();
    expect(onsave).toHaveBeenCalledOnce();
    expect(onsave.mock.calls[0][0].bands).toEqual([
      { maxM: 805, stories: 4 },
      { maxM: 402, stories: 6 }
    ]);
  });

  it('equal bands save', async () => {
    const { onsave } = setup();
    await page.getByRole('checkbox', { name: /^Muni Metro/ }).click();
    await page.getByRole('spinbutton', { name: 'Band 2 stories' }).fill('6');
    await save().click();
    expect(onsave.mock.calls[0][0].bands).toEqual([
      { maxM: 402, stories: 6 },
      { maxM: 805, stories: 6 }
    ]);
  });

  it('has no Mode radios and no Density limits checkbox', async () => {
    setup();
    await expect.element(page.getByRole('form')).toBeVisible();
    expect(page.getByRole('group', { name: 'Mode' }).elements()).toHaveLength(0);
    expect(page.getByRole('radio').elements()).toHaveLength(0);
    expect(page.getByRole('checkbox', { name: 'Density limits' }).elements()).toHaveLength(0);
  });

  it('the live region stays in the accessibility tree while empty', async () => {
    setup();
    // getByRole skips nodes outside the accessibility tree (display:none, hidden).
    const region = page.getByRole('status');
    await expect.element(region).toBeInTheDocument();
    const el = region.element() as HTMLElement;
    expect(el.textContent).toBe('');
    expect(getComputedStyle(el).display).not.toBe('none');
    expect(el.hidden).toBe(false);
  });

  it('Cancel calls oncancel', async () => {
    const { oncancel, onsave } = setup();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(oncancel).toHaveBeenCalledOnce();
    expect(onsave).not.toHaveBeenCalled();
  });
});
