/// <reference types="@vitest/browser-playwright" />
// The zoning rule forms (Transit, Street, Commercial corridor): what each saves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_BANDS, type ZoningRule } from './policy';
import RuleBrushForm from './RuleBrushForm.svelte';
import type { RuleKind } from './brush-summary';
import { testCatalog } from './test/catalog';

function setup(kind: RuleKind, initial?: ZoningRule) {
  const onsave = vi.fn();
  const oncancel = vi.fn();
  const view = render(RuleBrushForm, {
    props: { kind, catalog: testCatalog(), initial, onsave, oncancel }
  });
  return { onsave, oncancel, unmount: async () => (await view).unmount() };
}

const save = () => page.getByRole('button', { name: 'Save rule' });

describe('RuleBrushForm', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('Transit: one stop type ticked saves the default bands, and nothing else', async () => {
    const { onsave } = setup('transit');
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
    setup('transit');
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

  it('Commercial corridor saves arterials, NC only, fronting lots', async () => {
    const { onsave } = setup('corridor');
    await expect
      .element(page.getByText('Arterial frontage zoned neighborhood commercial (NC or NCT)'))
      .toBeVisible();
    await save().click();
    expect(onsave.mock.calls[0][0]).toMatchObject({
      kind: 'street',
      classes: ['arterial'],
      names: [],
      depth: 0,
      ncOnly: true,
      stories: 6
    });
  });

  it('Street: classes, a named street and one lot deep', async () => {
    const { onsave } = setup('street');
    await page.getByRole('checkbox', { name: 'Arterials' }).click();
    await page.getByRole('combobox', { name: 'Street name' }).fill('market st');
    await page.getByRole('button', { name: 'Add street' }).click();
    await expect.element(page.getByRole('button', { name: 'Remove Market St' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Include the lots one lot deep' }).click();
    await page.getByRole('spinbutton', { name: 'Stories' }).fill('8');
    await save().click();
    const b = onsave.mock.calls[0][0];
    expect(b).toEqual({
      id: b.id,
      kind: 'street',
      classes: ['arterial'],
      names: ['Market St'],
      depth: 1,
      ncOnly: false,
      stories: 8
    });
  });

  it('names the form with "a" or "an" as the kind needs', async () => {
    const titles: [RuleKind, string][] = [
      ['transit', 'Add a transit rule'],
      ['street', 'Add a street rule'],
      ['corridor', 'Add a commercial corridor rule']
    ];
    for (const [kind, name] of titles) {
      const view = setup(kind);
      await expect.element(page.getByRole('form', { name, exact: true })).toBeVisible();
      await view.unmount();
    }
    const initial: ZoningRule = {
      id: 'transit12345',
      kind: 'transit',
      stopTypes: ['metro'],
      bands: DEFAULT_BANDS
    };
    setup('transit', initial);
    await expect
      .element(page.getByRole('form', { name: 'Edit a transit rule', exact: true }))
      .toBeVisible();
  });

  it('editing a saved street rule keeps its id and stories', async () => {
    const initial: ZoningRule = {
      id: 'keepMe123456',
      kind: 'street',
      classes: ['major'],
      names: ['Geary Blvd'],
      depth: 0,
      ncOnly: false,
      stories: 9
    };
    const { onsave } = setup('street', initial);
    await expect.element(page.getByRole('checkbox', { name: 'Major streets' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Collectors' }).click();
    await save().click();
    expect(onsave.mock.calls[0][0]).toMatchObject({
      id: 'keepMe123456',
      classes: ['major', 'collector'],
      names: ['Geary Blvd'],
      stories: 9
    });
  });

  it('Save with nothing chosen announces why and saves nothing (WCAG 4.1.3)', async () => {
    const { onsave } = setup('street');
    const reason = 'Choose a street class or add a street.';
    const status = page.getByRole('status').filter({ hasText: reason });
    await expect.element(status).not.toBeInTheDocument();
    await save().click();
    expect(onsave).not.toHaveBeenCalled();
    await expect.element(status).toBeVisible();
    await expect.element(save()).toHaveAccessibleDescription(reason);
    // The reason follows the fields, and clears once the brush is complete.
    await page.getByRole('checkbox', { name: 'Arterials' }).click();
    await expect.element(status).not.toBeInTheDocument();
    await save().click();
    expect(onsave).toHaveBeenCalledOnce();
  });

  it('an unknown street name is an alert', async () => {
    setup('street');
    await page.getByRole('combobox', { name: 'Street name' }).fill('Nowhere Ln');
    await page.getByRole('button', { name: 'Add street' }).click();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('No street named “Nowhere Ln” in this dataset.');
    await expect
      .element(page.getByRole('combobox', { name: 'Street name' }))
      .toHaveAccessibleDescription('No street named “Nowhere Ln” in this dataset.');
  });

  it('two bands at one distance are announced at once and block Save', async () => {
    const { onsave } = setup('transit');
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
    const { onsave } = setup('transit');
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
    const { onsave } = setup('transit');
    await page.getByRole('checkbox', { name: /^Muni Metro/ }).click();
    await page.getByRole('spinbutton', { name: 'Band 2 stories' }).fill('6');
    await save().click();
    expect(onsave.mock.calls[0][0].bands).toEqual([
      { maxM: 402, stories: 6 },
      { maxM: 805, stories: 6 }
    ]);
  });

  it('has no Mode radios and no Density limits checkbox', async () => {
    for (const kind of ['transit', 'street', 'corridor'] as const) {
      const view = setup(kind);
      await expect.element(page.getByRole('form')).toBeVisible();
      expect(page.getByRole('group', { name: 'Mode' }).elements()).toHaveLength(0);
      expect(page.getByRole('radio').elements()).toHaveLength(0);
      expect(page.getByRole('checkbox', { name: 'Density limits' }).elements()).toHaveLength(0);
      await view.unmount();
    }
  });

  it('the live regions stay in the accessibility tree while empty', async () => {
    setup('street');
    for (const role of ['status', 'alert'] as const) {
      // getByRole skips nodes outside the accessibility tree (display:none, hidden).
      const region = page.getByRole(role);
      await expect.element(region).toBeInTheDocument();
      const el = region.element() as HTMLElement;
      expect(el.textContent).toBe('');
      expect(getComputedStyle(el).display).not.toBe('none');
      expect(el.hidden).toBe(false);
    }
  });

  it('Cancel calls oncancel', async () => {
    const { oncancel, onsave } = setup('corridor');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(oncancel).toHaveBeenCalledOnce();
    expect(onsave).not.toHaveBeenCalled();
  });
});
