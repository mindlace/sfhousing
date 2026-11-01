/// <reference types="@vitest/browser-playwright" />
// "Your zoning" (sim runs): Undo and Redo named by the change, the Move, Paint and Erase radios,
// "Allow N stories", the rules with "Add a rule", the custom brushes, and each card's lot count,
// wait or failure with Retry.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import BrushSection from './BrushSection.svelte';
import { ERASE_HINT, SimBrushTools, type SimTool } from './brush-tools.svelte';
import { DEFAULT_POLICY, queryKey, type CustomBrush, type Stroke, type ZoningRule } from './policy';
import { PolicyStore } from './policy-store.svelte';
import { createStrokeAdapter } from './stroke-adapter';
import type { BrushCatalog } from '$lib/sim/levers/brushes';
import { testCatalog } from './test/catalog';

const strokes: Stroke[] = [{ path: [[-122.42, 37.76]], radiusM: 30 }];
const freehand: CustomBrush = { id: 'b1', kind: 'paint', strokes, stories: 8 };
const key = queryKey({ kind: 'freehand', strokes });
const street: ZoningRule = {
  id: 's1',
  kind: 'street',
  classes: ['arterial'],
  names: [],
  depth: 0,
  ncOnly: false,
  stories: 8
};

function setup(
  opts: {
    result?: BrushLotsResult;
    brushes?: CustomBrush[];
    rules?: ZoningRule[];
    tool?: SimTool;
    catalog?: BrushCatalog | null;
  } = {}
) {
  const store = new PolicyStore(DEFAULT_POLICY);
  if (opts.brushes || opts.rules) {
    const custom = opts.brushes ?? [];
    const rules = opts.rules ?? [];
    store.apply((p) => ({ ...p, custom, rules }), 'Allowed 8 stories');
  }
  const brush = new BrushState({ storage: null, fine: false });
  brush.phase = 'ready';
  const tools = new SimBrushTools(brush);
  if (opts.tool) tools.tool = opts.tool;
  const announce = vi.fn();
  const adapter = createStrokeAdapter({ store, stories: () => tools.stories(), announce });
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
    const undo = page.getByRole('button', { name: 'Undo: Allowed 8 stories' });
    await expect.element(undo).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
    await undo.click();
    expect(undoSpy).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith('Undid: Allowed 8 stories');
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'Redo: Allowed 8 stories' }))
      .toBeEnabled();
  });

  it('offers exactly Move, Paint and Erase as radios', async () => {
    const { ontool } = setup();
    const group = page.getByRole('radiogroup', { name: 'Brush tool' });
    await expect.element(group).toBeVisible();
    const names = group
      .getByRole('radio')
      .elements()
      .map((e) => e.textContent?.trim());
    expect(names).toEqual(['Move', 'Paint', 'Erase']);
    await expect.element(page.getByRole('radio', { name: 'Move' })).toBeChecked();
    await page.getByRole('radio', { name: 'Paint' }).click();
    expect(ontool).toHaveBeenLastCalledWith('paint');
    await expect.element(page.getByRole('radio', { name: 'Paint' })).toBeChecked();
  });

  it('the stories control reads "Allow N stories"; there is no Mode or Density limits', async () => {
    const { tools } = setup({ tool: 'paint' });
    await expect.element(page.getByText(/Allow \d+ stor/)).toBeVisible();
    await expect
      .element(page.getByText(`Allow ${tools.stories()} stories`, { exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toBeVisible();
    expect(page.getByRole('radiogroup', { name: 'Mode' }).elements()).toHaveLength(0);
    expect(page.getByRole('checkbox', { name: 'Density limits' }).elements()).toHaveLength(0);
    await page.getByRole('button', { name: 'More stories' }).click();
    await expect
      .element(page.getByText(`Allow ${tools.stories()} stories`, { exact: true }))
      .toBeVisible();
  });

  it('Erase disables Stories with the /sim hint', async () => {
    setup({ tool: 'erase' });
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toBeDisabled();
    await expect
      .element(page.getByRole('spinbutton', { name: 'Stories' }))
      .toHaveAccessibleDescription(ERASE_HINT);
  });

  it('has a map key with one swatch, your zoning changes', async () => {
    setup();
    const key = page.getByRole('list', { name: 'Map key' });
    await expect.element(key).toBeVisible();
    const items = key
      .getByRole('listitem')
      .elements()
      .map((e) => e.textContent?.trim());
    expect(items).toEqual(['Your zoning changes']);
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

  it('the custom brushes are an ordered list of cards', async () => {
    setup({ brushes: [freehand], result: lots(3) });
    const list = page.getByRole('list', { name: 'Custom zoning' });
    expect(list.element().tagName).toBe('OL');
    await expect
      .element(list.getByRole('button', { name: 'Remove: Allow 8 stories · 1 stroke · 3 lots' }))
      .toBeVisible();
  });

  it('the rules are a list of cards above the custom brushes', async () => {
    setup({ rules: [street], brushes: [freehand], catalog: testCatalog() });
    const rules = page.getByRole('list', { name: 'New zoning rules' });
    await expect
      .element(rules.getByRole('button', { name: /^Edit: Up to 8 stories · Arterials/ }))
      .toBeEnabled();
    const custom = page.getByRole('list', { name: 'Custom zoning' });
    const r = rules.element();
    expect(r.compareDocumentPosition(custom.element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
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
});
