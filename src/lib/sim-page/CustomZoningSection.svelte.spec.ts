/// <reference types="@vitest/browser-playwright" />
// "Custom zoning" (sim runs): the Move, Paint and Erase radios, "Allow N stories", the map key,
// the custom brushes, and each card's lot count, wait or failure with Retry.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { ERASE_HINT, SimBrushTools, type SimTool } from './brush-tools.svelte';
import CustomZoningSection from './CustomZoningSection.svelte';
import { DEFAULT_POLICY, queryKey, type CustomBrush, type Stroke } from './policy';
import { PolicyStore } from './policy-store.svelte';

const strokes: Stroke[] = [{ path: [[-122.42, 37.76]], radiusM: 30 }];
const freehand: CustomBrush = { id: 'b1', kind: 'paint', strokes, stories: 8 };
const key = queryKey({ kind: 'freehand', strokes });

function setup(opts: { result?: BrushLotsResult; brushes?: CustomBrush[]; tool?: SimTool } = {}) {
  const store = new PolicyStore(DEFAULT_POLICY);
  if (opts.brushes) store.apply((p) => ({ ...p, custom: opts.brushes! }), 'Allowed 8 stories');
  const brush = new BrushState({ storage: null, fine: false });
  brush.phase = 'ready';
  const tools = new SimBrushTools(brush);
  if (opts.tool) tools.tool = opts.tool;
  const announce = vi.fn();
  const sync = {
    result: vi.fn((k: string) => (k === key ? opts.result : undefined)),
    retry: vi.fn()
  };
  const ontool = vi.fn((t: SimTool) => (tools.tool = t));
  render(CustomZoningSection, { props: { store, sync, tools, ontool, announce } });
  return { store, tools, sync, ontool, announce };
}

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

describe('CustomZoningSection', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('has no Undo or Redo and no rules (those are the history row and New zoning rules)', async () => {
    setup();
    expect(page.getByRole('button', { name: /^(Undo|Redo)/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Add a rule' }).elements()).toHaveLength(0);
    await expect.element(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeVisible();
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

  it('has no map key', () => {
    setup();
    expect(page.getByRole('list', { name: 'Map key' }).query()).toBeNull();
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
      result: { ok: false, reason: 'data-missing', message: 'no transit' }
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

  it('does not repeat that later strokes win (the order is the list)', async () => {
    setup({ brushes: [freehand], result: lots(3) });
    await expect.element(page.getByRole('list', { name: 'Custom zoning' })).toBeVisible();
    expect(page.getByText('Later strokes win').elements()).toHaveLength(0);
  });

  it('removing the last custom brush moves focus to the tool radio, not to a rule control', async () => {
    const { store } = setup({ brushes: [freehand], result: lots(3) });
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(store.policy.custom).toHaveLength(0);
    await expect.element(page.getByRole('radio', { name: 'Move' })).toHaveFocus();
  });
});
