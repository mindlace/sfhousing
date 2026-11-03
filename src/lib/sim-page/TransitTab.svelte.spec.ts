/// <reference types="@vitest/browser-playwright" />
// The Transit tab: the layers, the locked FZP baseline row, "+ Transit layer", and in-place edits
// as labelled store changes (Review Focus 5: one undo per coalesced run, the row stays selected
// and expanded, and the store never holds an invalid rule).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { BrushCatalog } from '$lib/sim/levers/brushes';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { ruleChangeLabel } from './brush-summary';
import {
  DEFAULT_BANDS,
  DEFAULT_POLICY,
  bandProblem,
  queryKey,
  ruleQueries,
  type SimPolicy,
  type ZoningRule
} from './policy';
import { PolicyStore } from './policy-store.svelte';
import type { DockSelection } from './selection';
import { testCatalog } from './test/catalog';
import TransitTabHost from './test/TransitTabHost.svelte';

const metro: ZoningRule = {
  id: 'r1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [
    { maxM: 402, stories: 6 },
    { maxM: 805, stories: 4 }
  ]
};
const rail: ZoningRule = {
  id: 'r2',
  kind: 'transit',
  stopTypes: ['regionalRail'],
  bands: [{ maxM: 805, stories: 12 }]
};

function setup(
  opts: {
    rules?: ZoningRule[];
    catalog?: BrushCatalog | null;
    selection?: DockSelection;
    results?: Record<string, BrushLotsResult>;
  } = {}
) {
  const store = new PolicyStore(DEFAULT_POLICY);
  // A load, not a change: the history starts empty.
  store.reset({ ...DEFAULT_POLICY, rules: opts.rules ?? [] });
  const announce = vi.fn();
  const sync = { result: vi.fn((k: string) => opts.results?.[k]), retry: vi.fn() };
  render(TransitTabHost, {
    props: {
      store,
      sync,
      catalog: 'catalog' in opts ? opts.catalog : testCatalog(),
      selection: opts.selection ?? null,
      announce
    }
  });
  return { store, sync, announce };
}

const list = () => page.getByRole('list', { name: 'Transit layers' });
const add = () => page.getByRole('button', { name: 'Add transit layer' });
const rowOf = (id: string) => document.querySelector(`[data-layer-row="${id}"]`) as HTMLElement;
/** A layer's select button, by the start of its name (the name carries its live lot count). */
const NAMES: Record<string, RegExp> = {
  r1: /^Near Muni Metro ·/,
  r2: /^Near regional rail ·/
};
const selectOf = (id: string) =>
  page.getByRole('button', { name: NAMES[id] ?? /^Near regional rail and Muni Metro ·/ });
const selection = () =>
  JSON.parse(document.querySelector('[data-testid="selection"]')!.textContent!) as DockSelection;
const band = (n: number) => page.getByRole('group', { name: `Band ${n}`, exact: true });
const more = (n: number) =>
  band(n).getByRole('button', { name: `More stories, band ${n}`, exact: true });
const chips = () => page.getByRole('group', { name: 'Stop types' });

/** Every rule in the store passes the band rule and has a stop type (Review Focus 5). */
function expectValid(p: SimPolicy): void {
  for (const r of p.rules) {
    expect(bandProblem(r.bands)).toBeNull();
    expect(r.stopTypes.length).toBeGreaterThan(0);
  }
}

describe('TransitTab', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('lists the layers, then the locked FZP baseline row, then + Transit layer', async () => {
    const lots = (k: string): BrushLotsResult => ({
      ok: true,
      lots: [`${k}-a`, `${k}-b`],
      points: new Float64Array(4)
    });
    const results = Object.fromEntries(
      [...ruleQueries(metro), ...ruleQueries(rail)].map((q) => [queryKey(q), lots(queryKey(q))])
    );
    setup({ rules: [metro, rail], results });
    await expect.element(list()).toBeVisible();
    const rows = [...list().element().querySelectorAll('[data-layer-row]')].map((r) =>
      r.getAttribute('data-layer-row')
    );
    expect(rows).toEqual(['r1', 'r2', 'fzp']);
    await expect
      .element(selectOf('r1'))
      .toHaveAccessibleName('Near Muni Metro · 6 stories · 4 lots');
    await expect
      .element(selectOf('r2'))
      .toHaveAccessibleName('Near regional rail · 12 stories · 2 lots');
    // FZP baseline: named, a lock glyph hidden from AT, no lot count, never an editor.
    const fzp = page.getByRole('button', { name: 'FZP baseline', exact: true });
    await expect.element(fzp).toHaveAttribute('aria-pressed', 'false');
    expect(fzp.element().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(rowOf('fzp').querySelector('[role="status"]')).toBeNull();
    // + Transit layer follows the list.
    await expect.element(add()).toBeVisible();
    expect(add().element().hasAttribute('data-brush-add')).toBe(true);
    const visible = add().element().cloneNode(true) as HTMLElement;
    visible.querySelectorAll('.sr-only').forEach((n) => n.remove());
    expect(visible.textContent?.trim()).toBe('+ Transit layer');
    expect(
      list().element().compareDocumentPosition(add().element()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(page.getByText('Each lot takes the tallest rule').elements()).toHaveLength(0);
  });

  it('a row toggles its selection; the FZP row selects fzp and opens no editor', async () => {
    setup({ rules: [metro] });
    await selectOf('r1').click();
    expect(selection()).toEqual({ kind: 'rule', id: 'r1' });
    await expect.element(chips()).toBeVisible();
    await selectOf('r1').click();
    expect(selection()).toBeNull();
    await expect.element(chips()).not.toBeInTheDocument();
    const fzp = page.getByRole('button', { name: 'FZP baseline', exact: true });
    await fzp.click();
    expect(selection()).toEqual({ kind: 'fzp' });
    await expect.element(fzp).toHaveAttribute('aria-pressed', 'true');
    expect(chips().query()).toBeNull();
    expect(page.getByRole('button', { name: 'Remove layer' }).query()).toBeNull();
    await fzp.click();
    expect(selection()).toBeNull();
  });

  it('+ Transit layer adds a selected, expanded layer with the default stops and bands', async () => {
    const { store, announce } = setup();
    await add().click();
    expect(store.policy.rules).toHaveLength(1);
    const r = store.policy.rules[0];
    expect(r.stopTypes).toEqual(['regionalRail', 'metro']);
    expect(r.bands).toEqual(DEFAULT_BANDS);
    expect(store.undoLabel).toBe(ruleChangeLabel(r));
    expect(announce).toHaveBeenCalledWith(ruleChangeLabel(r));
    expect(selection()).toEqual({ kind: 'rule', id: r.id });
    await expect.element(selectOf(r.id)).toHaveAttribute('aria-pressed', 'true');
    await expect.element(chips().getByRole('button').first()).toHaveFocus();
    expectValid(store.policy);
  });

  it('three More presses on one band are one undo step; the row stays selected', async () => {
    const { store } = setup({ rules: [metro], selection: { kind: 'rule', id: 'r1' } });
    for (let k = 0; k < 3; k++) await more(1).click();
    expect(store.policy.rules[0].bands[0].stories).toBe(9);
    expect(store.undoLabel).toBe('Edited: Allowed up to 9 stories near Muni Metro');
    expectValid(store.policy);
    store.undo();
    expect(store.policy.rules[0]).toEqual(metro);
    expect(store.canUndo).toBe(false);
    await expect.element(selectOf('r1')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(band(1)).toHaveTextContent(/6\s*stories/);
    expect(selection()).toEqual({ kind: 'rule', id: 'r1' });
    // After an undo, a new run is a new step.
    await more(1).click();
    await more(2).click();
    expect(store.policy.rules[0].bands.map((b) => b.stories)).toEqual([7, 5]);
    store.undo();
    expect(store.policy.rules[0].bands.map((b) => b.stories)).toEqual([7, 4]);
  });

  it('deselecting the row ends a stepper run: a press after reselecting is a new undo step', async () => {
    const { store } = setup({ rules: [metro], selection: { kind: 'rule', id: 'r1' } });
    await more(1).click();
    await selectOf('r1').click(); // deselect
    expect(selection()).toBeNull();
    await selectOf('r1').click(); // reselect
    await more(1).click();
    expect(store.policy.rules[0].bands[0].stories).toBe(8);
    store.undo();
    expect(store.policy.rules[0].bands[0].stories).toBe(7);
    store.undo();
    expect(store.policy.rules[0]).toEqual(metro);
    expect(store.canUndo).toBe(false);
  });

  it('selecting another row ends a distance run too', async () => {
    const { store } = setup({ rules: [metro, rail], selection: { kind: 'rule', id: 'r1' } });
    const commit = async (v: string) => {
      const input = band(1).getByRole('spinbutton', { name: 'Within metres, band 1' });
      await input.fill(v);
      (input.element() as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    };
    await commit('500');
    await selectOf('r2').click();
    await selectOf('r1').click();
    await commit('600');
    store.undo();
    expect(store.policy.rules[0].bands[0].maxM).toBe(500);
  });

  it('a chip and an added band are each one undo step; the row stays expanded and valid', async () => {
    const { store } = setup({ rules: [metro], selection: { kind: 'rule', id: 'r1' } });
    await chips()
      .getByRole('button', { name: /^Regional rail/ })
      .click();
    await page.getByRole('button', { name: 'Add band' }).click();
    expect(store.policy.rules[0].stopTypes).toEqual(['regionalRail', 'metro']);
    expect(store.policy.rules[0].bands).toHaveLength(3);
    expectValid(store.policy);
    store.undo();
    expect(store.policy.rules[0].bands).toHaveLength(2);
    expect(store.policy.rules[0].stopTypes).toEqual(['regionalRail', 'metro']);
    expectValid(store.policy);
    await expect.element(band(3)).not.toBeInTheDocument();
    await expect.element(chips()).toBeVisible();
    store.undo();
    expect(store.policy.rules[0]).toEqual(metro);
    await expect
      .element(chips().getByRole('button', { name: /^Regional rail/ }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect.element(selectOf('r1')).toHaveAttribute('aria-pressed', 'true');
    expect(store.canUndo).toBe(false);
  });

  it('a distance commit is one step of its own, named by the rule', async () => {
    const { store } = setup({ rules: [metro], selection: { kind: 'rule', id: 'r1' } });
    await more(1).click();
    const input = band(1).getByRole('spinbutton', { name: 'Within metres, band 1' });
    await input.fill('500');
    (input.element() as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.policy.rules[0].bands[0].maxM).toBe(500);
    expect(store.undoLabel).toBe('Edited: Allowed up to 7 stories near Muni Metro');
    store.undo();
    expect(store.policy.rules[0].bands[0]).toEqual({ maxM: 402, stories: 7 });
    store.undo();
    expect(store.policy.rules[0]).toEqual(metro);
  });

  it('Remove layer is one change Undo names, and focus moves on', async () => {
    const { store, announce } = setup({
      rules: [metro, rail],
      selection: { kind: 'rule', id: 'r1' }
    });
    await page.getByRole('button', { name: 'Remove layer' }).click();
    expect(store.policy.rules.map((r) => r.id)).toEqual(['r2']);
    expect(store.undoLabel).toBe(`Removed: ${ruleChangeLabel(metro)}`);
    expect(announce).toHaveBeenCalledWith(`Removed: ${ruleChangeLabel(metro)}`);
    expect(selection()).toBeNull();
    // The row now at its index.
    await expect.element(selectOf('r2')).toHaveFocus();
    // The last layer: focus goes to + Transit layer.
    await selectOf('r2').click();
    await page.getByRole('button', { name: 'Remove layer' }).click();
    expect(store.policy.rules).toEqual([]);
    await expect.element(add()).toHaveFocus();
    store.undo();
    expect(store.policy.rules.map((r) => r.id)).toEqual(['r2']);
    // Undo brings the layer back, not its selection.
    expect(selection()).toBeNull();
  });

  it('+ Transit layer is aria-disabled with its reason while the catalog loads', async () => {
    const { store } = setup({ catalog: undefined });
    await expect.element(add()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(add()).toHaveAccessibleDescription('Loading brush data…');
    await add().click({ force: true });
    expect(store.policy.rules).toEqual([]);
  });

  it('without transit data + Transit layer says so', async () => {
    setup({ catalog: testCatalog({ transit: false }) });
    await expect.element(add()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(add()).toHaveAccessibleDescription('This dataset has no transit data.');
  });

  it('a failed lookup Retries through the sync', async () => {
    const q = queryKey(ruleQueries(rail)[0]);
    const { sync } = setup({
      rules: [rail],
      results: { [q]: { ok: false, reason: 'bad-request', message: 'x' } }
    });
    await page.getByRole('button', { name: /^Retry/ }).click();
    expect(sync.retry).toHaveBeenCalledWith(q);
  });
});
