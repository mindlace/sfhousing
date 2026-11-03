/// <reference types="@vitest/browser-playwright" />
// One card in "New zoning rules" or "Custom zoning": a rule (Edit, Remove) or a custom brush (Move up, Move down, Remove),
// its summary, and each change as a labelled store change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import BrushCard from './BrushCard.svelte';
import {
  DEFAULT_POLICY,
  customQuery,
  queryKey,
  ruleQueries,
  type CustomBrush,
  type ZoningRule
} from './policy';
import { PolicyStore } from './policy-store.svelte';

const transit: ZoningRule = {
  id: 's1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [{ maxM: 402, stories: 8 }]
};
const stroke = { path: [[-122.42, 37.76]] as [number, number][], radiusM: 30 };
const paint: CustomBrush = { id: 'p1', kind: 'paint', strokes: [stroke], stories: 3 };
const erase: CustomBrush = { id: 'e1', kind: 'erase', strokes: [stroke, stroke] };
const transitKey = queryKey(ruleQueries(transit)[0]);
const paintKey = queryKey(customQuery(paint));

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

function setup(
  list: 'rules' | 'custom',
  id: string,
  index: number,
  extra: { selected?: boolean; onselect?: (on: boolean) => void } = {}
) {
  const store = new PolicyStore(DEFAULT_POLICY);
  store.apply((p) => ({ ...p, rules: [transit], custom: [paint, erase] }), 'Seeded');
  const sync = {
    result: vi.fn((k: string) =>
      k === transitKey ? lots(1204) : k === paintKey ? lots(12) : undefined
    ),
    retry: vi.fn()
  };
  const onedit = vi.fn();
  const announce = vi.fn();
  render(BrushCard, { props: { store, sync, list, id, index, onedit, announce, ...extra } });
  return { store, onedit, announce };
}

const RULE = 'Up to 8 stories within 402 m · Near Muni Metro · 1,204 lots';
const PAINT = 'Allow 3 stories · 1 stroke · 12 lots';

describe('BrushCard', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('a rule card shows its summary, with Edit and Remove named by it', async () => {
    const { onedit } = setup('rules', 's1', 0);
    await expect.element(page.getByText(RULE)).toBeVisible();
    for (const verb of ['Edit', 'Remove'])
      await expect
        .element(page.getByRole('button', { name: `${verb}: ${RULE}` }))
        .toBeInTheDocument();
    expect(page.getByRole('button', { name: /^Move/ }).elements()).toHaveLength(0);
    await page.getByRole('button', { name: `Edit: ${RULE}` }).click();
    expect(onedit).toHaveBeenCalledWith(transit);
  });

  it('removing a rule is a labelled change that undo reverses', async () => {
    const { store, announce } = setup('rules', 's1', 0);
    await page.getByRole('button', { name: /^Remove/ }).click();
    expect(store.policy.rules).toEqual([]);
    expect(store.undoLabel).toBe('Removed: Allowed up to 8 stories near Muni Metro');
    expect(announce).toHaveBeenCalledWith('Removed: Allowed up to 8 stories near Muni Metro');
    store.undo();
    expect(store.policy.rules).toEqual([transit]);
  });

  it('a custom card has Move up, Move down and Remove, and no Edit', async () => {
    setup('custom', 'p1', 0);
    await expect.element(page.getByText(PAINT)).toBeVisible();
    await expect.element(page.getByRole('button', { name: `Move up: ${PAINT}` })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: `Move down: ${PAINT}` })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: `Remove: ${PAINT}` })).toBeVisible();
    expect(page.getByRole('button', { name: /^Edit/ }).elements()).toHaveLength(0);
  });

  it('Move down moves a custom brush as a labelled change', async () => {
    const { store, announce } = setup('custom', 'p1', 0);
    await page.getByRole('button', { name: /^Move down/ }).click();
    expect(store.policy.custom.map((b) => b.id)).toEqual(['e1', 'p1']);
    expect(store.undoLabel).toBe('Moved down: Allowed 3 stories');
    expect(announce).toHaveBeenCalledWith('Moved down: Allowed 3 stories');
    store.undo();
    expect(store.policy.custom.map((b) => b.id)).toEqual(['p1', 'e1']);
  });

  it('an erase card reads Erase, and Move down is disabled on the last card', async () => {
    const { store } = setup('custom', 'e1', 1);
    await expect.element(page.getByText('Erase · 2 strokes · Finding lots…')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Move down/ })).toBeDisabled();
    await page.getByRole('button', { name: /^Remove/ }).click();
    expect(store.policy.custom.map((b) => b.id)).toEqual(['p1']);
    expect(store.undoLabel).toBe('Removed: Erased custom zoning');
  });

  it('a rule card has a Show on map toggle with aria-pressed; custom cards do not', async () => {
    setup('rules', 's1', 0);
    const toggle = page.getByRole('button', { name: `Show on map: ${RULE}` });
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.element().textContent?.trim()).toBe('Show on map');
    const box = toggle.element().getBoundingClientRect();
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    // No read-only wrapper: a run hides the tabs instead (plan 2, Task 4).
    expect(toggle.element().closest('fieldset')).toBeNull();
  });

  it('a custom card has no Show on map toggle', async () => {
    setup('custom', 'p1', 0);
    await expect.element(page.getByText(PAINT)).toBeVisible();
    expect(page.getByRole('button', { name: /Show on map/ }).elements()).toHaveLength(0);
  });

  it('pressing it calls onselect(true), pressing again onselect(false)', async () => {
    const onselect = vi.fn();
    const { rerender } = await setupWith(onselect, false);
    await page.getByRole('button', { name: /^Show on map/ }).click();
    expect(onselect).toHaveBeenLastCalledWith(true);
    await rerender(true);
    await expect
      .element(page.getByRole('button', { name: /^Show on map/ }))
      .toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^Show on map/ }).click();
    expect(onselect).toHaveBeenLastCalledWith(false);
  });
});

async function setupWith(onselect: (on: boolean) => void, selected: boolean) {
  const store = new PolicyStore(DEFAULT_POLICY);
  store.apply((p) => ({ ...p, rules: [transit] }), 'Seeded');
  const sync = { result: vi.fn(() => undefined), retry: vi.fn() };
  const r = await render(BrushCard, {
    props: { store, sync, list: 'rules' as const, id: 's1', index: 0, selected, onselect }
  });
  return { rerender: (v: boolean) => r.rerender({ selected: v }) };
}
