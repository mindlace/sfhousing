/// <reference types="@vitest/browser-playwright" />
// One card in "Your zoning": a rule (Edit, Remove) or a custom brush (Move up, Move down, Remove),
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

const street: ZoningRule = {
  id: 's1',
  kind: 'street',
  classes: ['arterial'],
  names: [],
  depth: 0,
  ncOnly: false,
  stories: 8
};
const stroke = { path: [[-122.42, 37.76]] as [number, number][], radiusM: 30 };
const paint: CustomBrush = { id: 'p1', kind: 'paint', strokes: [stroke], stories: 3 };
const erase: CustomBrush = { id: 'e1', kind: 'erase', strokes: [stroke, stroke] };
const streetKey = queryKey(ruleQueries(street)[0]);
const paintKey = queryKey(customQuery(paint));

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

function setup(list: 'rules' | 'custom', id: string, index: number) {
  const store = new PolicyStore(DEFAULT_POLICY);
  store.apply((p) => ({ ...p, rules: [street], custom: [paint, erase] }), 'Seeded');
  const sync = {
    result: vi.fn((k: string) =>
      k === streetKey ? lots(1204) : k === paintKey ? lots(12) : undefined
    ),
    retry: vi.fn()
  };
  const onedit = vi.fn();
  const announce = vi.fn();
  render(BrushCard, { props: { store, sync, list, id, index, onedit, announce } });
  return { store, onedit, announce };
}

const RULE = 'Up to 8 stories · Arterials · 1,204 lots';
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
    expect(onedit).toHaveBeenCalledWith(street);
  });

  it('removing a rule is a labelled change that undo reverses', async () => {
    const { store, announce } = setup('rules', 's1', 0);
    await page.getByRole('button', { name: /^Remove/ }).click();
    expect(store.policy.rules).toEqual([]);
    expect(store.undoLabel).toBe('Removed: Allowed up to 8 stories on arterials');
    expect(announce).toHaveBeenCalledWith('Removed: Allowed up to 8 stories on arterials');
    store.undo();
    expect(store.policy.rules).toEqual([street]);
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
});
