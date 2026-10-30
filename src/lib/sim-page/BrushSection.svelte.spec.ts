/// <reference types="@vitest/browser-playwright" />
// "Your zoning", tools part (layout rulings 7 and 8): Undo and Redo named by the change, the tool
// radios, the controls Protect hides, and each brush's lot count, wait or failure with Retry.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import BrushSection from './BrushSection.svelte';
import { ERASE_HINT, SimBrushTools, type SimTool } from './brush-tools.svelte';
import { policyFromLevers, queryKey, type Stroke, type ZoningBrush } from './policy';
import { PolicyStore } from './policy-store.svelte';
import { createStrokeAdapter } from './stroke-adapter';
import type { BrushCatalog } from '$lib/sim/levers/brushes';
import { testCatalog } from './test/catalog';

const strokes: Stroke[] = [{ path: [[-122.42, 37.76]], radiusM: 30 }];
const freehand: ZoningBrush = {
  id: 'b1',
  kind: 'freehand',
  strokes,
  effect: { mode: 'raise', stories: 8, densityLimits: false }
};
const key = queryKey({ kind: 'freehand', strokes });

function setup(
  opts: {
    result?: BrushLotsResult;
    brushes?: ZoningBrush[];
    tool?: SimTool;
    catalog?: BrushCatalog | null;
  } = {}
) {
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  if (opts.brushes) {
    const brushes = opts.brushes;
    store.apply((p) => ({ ...p, brushes }), 'Raised lots to 8 stories');
  }
  const brush = new BrushState({ storage: null, fine: false });
  brush.phase = 'ready';
  const tools = new SimBrushTools(brush);
  if (opts.tool) tools.tool = opts.tool;
  const announce = vi.fn();
  const adapter = createStrokeAdapter({
    store,
    target: () => tools.target(),
    effect: () => tools.effect(),
    announce
  });
  const sync = {
    result: vi.fn((k: string) => (k === key ? opts.result : undefined)),
    retry: vi.fn()
  };
  const ontool = vi.fn((t: SimTool) => (tools.tool = t));
  render(BrushSection, {
    props: {
      store,
      sync,
      tools,
      ontool,
      onundo: () => adapter.editor.undo(),
      onredo: () => adapter.editor.redo(),
      catalog: opts.catalog,
      announce
    }
  });
  return { store, tools, sync, ontool, announce };
}

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

describe('BrushSection', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('names Undo by the change and pressing it calls store.undo()', async () => {
    const { store, announce } = setup({ brushes: [freehand] });
    const undoSpy = vi.spyOn(store, 'undo');
    const undo = page.getByRole('button', { name: 'Undo: Raised lots to 8 stories' });
    await expect.element(undo).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
    await undo.click();
    expect(undoSpy).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith('Undid: Raised lots to 8 stories');
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'Redo: Raised lots to 8 stories' }))
      .toBeEnabled();
  });

  it('offers Move, Paint, Erase, Protect and Unprotect as radios', async () => {
    const { ontool } = setup();
    const group = page.getByRole('radiogroup', { name: 'Brush tool' });
    await expect.element(group).toBeVisible();
    const names = group
      .getByRole('radio')
      .elements()
      .map((e) => e.textContent?.trim());
    expect(names).toEqual(['Move', 'Paint', 'Erase', 'Protect', 'Unprotect']);
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await page.getByRole('radio', { name: 'Paint' }).click();
    expect(ontool).toHaveBeenLastCalledWith('paint');
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeChecked();
  });

  it('hides Mode, Stories and Density while Protect is active', async () => {
    setup({ tool: 'paint' });
    await expect.element(page.getByRole('radiogroup', { name: 'Mode' })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Density limits' })).toBeVisible();
    await page.getByRole('radio', { name: 'Protect', exact: true }).click();
    await expect.element(page.getByRole('radiogroup', { name: 'Mode' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('checkbox', { name: 'Density limits' }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole('slider', { name: /^Brush \d+ m$/ })).toBeVisible();
    await page.getByRole('radio', { name: 'Unprotect' }).click();
    await expect.element(page.getByRole('radiogroup', { name: 'Mode' })).not.toBeInTheDocument();
  });

  it('Erase hides Mode and Density and disables Stories with the /sim hint', async () => {
    setup({ tool: 'erase' });
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toBeDisabled();
    await expect
      .element(page.getByRole('spinbutton', { name: 'Stories' }))
      .toHaveAccessibleDescription(ERASE_HINT);
    await expect.element(page.getByRole('radiogroup', { name: 'Mode' })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('checkbox', { name: 'Density limits' }))
      .not.toBeInTheDocument();
  });

  it('has a map key naming each lot colour and the protected ring', async () => {
    setup();
    const key = page.getByRole('list', { name: 'Map key' });
    await expect.element(key).toBeVisible();
    const items = key
      .getByRole('listitem')
      .elements()
      .map((e) => e.textContent?.trim());
    expect(items).toEqual(['Raised', 'Lowered', 'Set', 'Protected (ring)']);
  });

  it('Density limits follows the mode default when the mode changes', async () => {
    const { tools } = setup({ tool: 'paint' });
    const density = page.getByRole('checkbox', { name: 'Density limits' });
    await expect.element(density).not.toBeChecked();
    await page.getByRole('radio', { name: 'Lower' }).click();
    await expect.element(density).toBeChecked();
    expect(tools.effect()).toMatchObject({ mode: 'lower', densityLimits: true });
    await density.click();
    expect(tools.effect().densityLimits).toBe(false);
    await page.getByRole('radio', { name: 'Raise' }).click();
    await expect.element(density).not.toBeChecked();
  });

  it('shows a brush lot count once found', async () => {
    setup({ brushes: [freehand], result: lots(3) });
    await expect.element(page.getByText('3 lots')).toBeVisible();
    // The count is in a polite live region (WCAG 4.1.3).
    await expect
      .element(page.getByRole('status').filter({ hasText: '3 lots' }))
      .toBeInTheDocument();
  });

  it('shows "Finding lots…" while unanswered and for a parked no-session answer', async () => {
    setup({
      brushes: [freehand],
      result: { ok: false, reason: 'no-session', message: 'gone' }
    });
    await expect.element(page.getByText('Finding lots…')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a failed brush offers Retry', async () => {
    const { sync } = setup({
      brushes: [freehand],
      result: { ok: false, reason: 'data-missing', message: 'no frontage' }
    });
    await expect.element(page.getByText("Couldn't find lots")).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(sync.retry).toHaveBeenCalledWith(key);
  });

  it('the brushes are an ordered list of cards', async () => {
    setup({ brushes: [freehand], result: lots(3) });
    const list = page.getByRole('list', { name: 'Your brushes' });
    expect(list.element().tagName).toBe('OL');
    await expect
      .element(list.getByRole('button', { name: 'Remove: Raise to 8 stories · 1 stroke · 3 lots' }))
      .toBeVisible();
  });

  it('"Add a brush" offers the four rule brushes; a kind without its data says why', async () => {
    setup({ catalog: testCatalog({ frontage: false }) });
    await page.getByRole('button', { name: 'Add a brush' }).click();
    await expect.element(page.getByRole('button', { name: 'Transit' })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Area' })).toBeEnabled();
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
    await page.getByRole('button', { name: 'Add a brush' }).click();
    await expect.element(page.getByRole('button', { name: 'Transit' })).toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'Transit' }))
      .toHaveAccessibleDescription('Loading brush data…');
  });

  it('on md+ a rule brush form opens inline and its save is a labelled change', async () => {
    const { store, announce } = setup({ catalog: testCatalog() });
    await page.getByRole('button', { name: 'Add a brush' }).click();
    await page.getByRole('button', { name: 'Transit' }).click();
    await page.getByRole('checkbox', { name: /^Regional rail/ }).click();
    await page.getByRole('button', { name: 'Save brush' }).click();
    expect(store.policy.brushes).toHaveLength(1);
    expect(store.undoLabel).toBe('Raised lots near regional rail');
    expect(announce).toHaveBeenCalledWith('Raised lots near regional rail');
    await expect.element(page.getByRole('button', { name: 'Save brush' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Add a brush' })).toHaveFocus();
  });
});
