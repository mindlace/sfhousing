/// <reference types="@vitest/browser-playwright" />
// The rule brush forms (Transit, Street, Commercial corridor, Area): what each saves.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_BANDS, type ZoningBrush } from './policy';
import RuleBrushForm from './RuleBrushForm.svelte';
import type { RuleKind } from './brush-summary';
import { testCatalog } from './test/catalog';

function setup(kind: RuleKind, initial?: ZoningBrush) {
  const onsave = vi.fn();
  const oncancel = vi.fn();
  render(RuleBrushForm, { props: { kind, catalog: testCatalog(), initial, onsave, oncancel } });
  return { onsave, oncancel };
}

const save = () => page.getByRole('button', { name: 'Save brush' });

describe('RuleBrushForm', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('Transit: one stop type ticked saves the default bands, raise, no density limits', async () => {
    const { onsave } = setup('transit');
    await expect.element(save()).toBeDisabled();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await save().click();
    expect(onsave).toHaveBeenCalledOnce();
    const b = onsave.mock.calls[0][0] as ZoningBrush;
    expect(b).toMatchObject({
      kind: 'transit',
      stopTypes: ['regionalRail'],
      bands: DEFAULT_BANDS,
      mode: 'raise',
      densityLimits: false
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
      ncOnly: true
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
    expect(onsave.mock.calls[0][0]).toMatchObject({
      kind: 'street',
      classes: ['arterial'],
      names: ['Market St'],
      depth: 1,
      ncOnly: false,
      effect: { mode: 'raise', stories: 8, densityLimits: false }
    });
  });

  it('Area: ticking the RH-1 family selects every RH-1 code', async () => {
    const { onsave } = setup('area');
    await page.getByRole('checkbox', { name: /^RH-1 family/ }).click();
    await page.getByRole('button', { name: 'RH-1 codes' }).click();
    for (const code of ['RH-1', 'RH-1(D)', 'RH-1(S)'])
      await expect
        .element(page.getByRole('checkbox', { name: `${code} · `, exact: false }))
        .toBeChecked();
    await save().click();
    expect(onsave.mock.calls[0][0]).toMatchObject({
      kind: 'area',
      districts: ['RH-1', 'RH-1(D)', 'RH-1(S)'],
      neighborhoods: []
    });
  });

  it('editing a saved street brush keeps its id', async () => {
    const initial: ZoningBrush = {
      id: 'keepMe123456',
      kind: 'street',
      classes: ['major'],
      names: ['Geary Blvd'],
      depth: 0,
      ncOnly: false,
      effect: { mode: 'raise', stories: 6, densityLimits: false }
    };
    const { onsave } = setup('street', initial);
    await expect.element(page.getByRole('checkbox', { name: 'Major streets' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Collectors' }).click();
    await save().click();
    expect(onsave.mock.calls[0][0]).toMatchObject({
      id: 'keepMe123456',
      classes: ['major', 'collector'],
      names: ['Geary Blvd']
    });
  });

  it('Cancel calls oncancel', async () => {
    const { oncancel, onsave } = setup('area');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(oncancel).toHaveBeenCalledOnce();
    expect(onsave).not.toHaveBeenCalled();
  });
});
