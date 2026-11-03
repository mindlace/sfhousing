/// <reference types="@vitest/browser-playwright" />
// One card in "New zoning rules": a rule (Show on map, Edit, Remove), its summary, and each change
// as a labelled store change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import BrushCard from './BrushCard.svelte';
import { DEFAULT_POLICY, queryKey, ruleQueries, type ZoningRule } from './policy';
import { PolicyStore } from './policy-store.svelte';

const transit: ZoningRule = {
  id: 's1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [{ maxM: 402, stories: 8 }]
};
const transitKey = queryKey(ruleQueries(transit)[0]);

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

function setup(extra: { selected?: boolean; onselect?: (on: boolean) => void } = {}) {
  const store = new PolicyStore(DEFAULT_POLICY);
  store.apply((p) => ({ ...p, rules: [transit] }), 'Seeded');
  const sync = {
    result: vi.fn((k: string) => (k === transitKey ? lots(1204) : undefined)),
    retry: vi.fn()
  };
  const onedit = vi.fn();
  const announce = vi.fn();
  render(BrushCard, { props: { store, sync, id: 's1', index: 0, onedit, announce, ...extra } });
  return { store, onedit, announce };
}

const RULE = 'Up to 8 stories within 402 m · Near Muni Metro · 1,204 lots';

describe('BrushCard', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('a rule card shows its summary, with Edit and Remove named by it', async () => {
    const { onedit } = setup();
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
    const { store, announce } = setup();
    await page.getByRole('button', { name: /^Remove/ }).click();
    expect(store.policy.rules).toEqual([]);
    expect(store.undoLabel).toBe('Removed: Allowed up to 8 stories near Muni Metro');
    expect(announce).toHaveBeenCalledWith('Removed: Allowed up to 8 stories near Muni Metro');
    store.undo();
    expect(store.policy.rules).toEqual([transit]);
  });

  it('a rule card has a Show on map toggle with aria-pressed', async () => {
    setup();
    const toggle = page.getByRole('button', { name: `Show on map: ${RULE}` });
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.element().textContent?.trim()).toBe('Show on map');
    const box = toggle.element().getBoundingClientRect();
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    // No read-only wrapper: a run hides the tabs instead (plan 2, Task 4).
    expect(toggle.element().closest('fieldset')).toBeNull();
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
    props: { store, sync, id: 's1', index: 0, selected, onselect }
  });
  return { rerender: (v: boolean) => r.rerender({ selected: v }) };
}
