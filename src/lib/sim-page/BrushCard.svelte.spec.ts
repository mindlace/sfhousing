/// <reference types="@vitest/browser-playwright" />
// One brush in "Your zoning"'s ordered list: its summary, and Edit, Move up, Move down and Remove
// as labelled store changes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import BrushCard from './BrushCard.svelte';
import { brushQueries, policyFromLevers, queryKey, type ZoningBrush } from './policy';
import { PolicyStore } from './policy-store.svelte';

const street: ZoningBrush = {
  id: 's1',
  kind: 'street',
  classes: ['arterial'],
  names: [],
  depth: 0,
  ncOnly: false,
  effect: { mode: 'raise', stories: 8, densityLimits: false }
};
const freehand: ZoningBrush = {
  id: 'f1',
  kind: 'freehand',
  strokes: [{ path: [[-122.42, 37.76]], radiusM: 30 }],
  effect: { mode: 'lower', stories: 3, densityLimits: true }
};
const streetKey = queryKey(brushQueries(street)[0]);

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

function setup(index: number) {
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  store.apply((p) => ({ ...p, brushes: [street, freehand] }), 'Seeded');
  const sync = {
    result: vi.fn((k: string) => (k === streetKey ? lots(1204) : undefined)),
    retry: vi.fn()
  };
  const onedit = vi.fn();
  const announce = vi.fn();
  render(BrushCard, {
    props: { store, sync, brush: store.policy.brushes[index], index, onedit, announce }
  });
  return { store, onedit, announce };
}

const SUMMARY = 'Raise to 8 stories · Arterials · 1,204 lots · density limits off';

describe('BrushCard', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('shows a one-line summary and names each button by it', async () => {
    const { onedit } = setup(0);
    await expect.element(page.getByText(SUMMARY)).toBeVisible();
    for (const verb of ['Edit', 'Move up', 'Move down', 'Remove'])
      await expect
        .element(page.getByRole('button', { name: `${verb}: ${SUMMARY}` }))
        .toBeInTheDocument();
    await page.getByRole('button', { name: `Edit: ${SUMMARY}` }).click();
    expect(onedit).toHaveBeenCalledWith(street);
  });

  it('Move up is disabled on the first card; Move down moves it as a labelled change', async () => {
    const { store, announce } = setup(0);
    await expect.element(page.getByRole('button', { name: /^Move up/ })).toBeDisabled();
    await page.getByRole('button', { name: /^Move down/ }).click();
    expect(store.policy.brushes.map((b) => b.id)).toEqual(['f1', 's1']);
    expect(store.undoLabel).toBe('Moved down: Raised arterials to 8 stories');
    expect(announce).toHaveBeenCalledWith('Moved down: Raised arterials to 8 stories');
    store.undo();
    expect(store.policy.brushes.map((b) => b.id)).toEqual(['s1', 'f1']);
  });

  it('a freehand brush has no Edit; Move down is disabled on the last card', async () => {
    setup(1);
    await expect.element(page.getByRole('button', { name: /^Move down/ })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: /^Move up/ })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it('Remove applies a store change labelled "Removed …"', async () => {
    const { store } = setup(0);
    await page.getByRole('button', { name: /^Remove/ }).click();
    expect(store.policy.brushes.map((b) => b.id)).toEqual(['f1']);
    expect(store.undoLabel).toMatch(/^Removed/);
    expect(store.undoLabel).toBe('Removed: Raised arterials to 8 stories');
    store.undo();
    expect(store.policy.brushes.map((b) => b.id)).toEqual(['s1', 'f1']);
  });
});
