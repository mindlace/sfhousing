/// <reference types="@vitest/browser-playwright" />
// "Protections" (plan 3, Task 10): the category checkboxes, the years input of "newer than", the
// note, the Protect tool button and the brushed lots with Clear (one undoable change, ruling 6).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import ProtectionsSection from './ProtectionsSection.svelte';
import { SimBrushTools, type SimTool } from './brush-tools.svelte';
import { policyFromLevers, queryKey, type ProtectStroke, type Stroke } from './policy';
import { PolicyStore } from './policy-store.svelte';

const s1: Stroke = { path: [[-122.42, 37.76]], radiusM: 30 };
const s2: Stroke = { path: [[-122.41, 37.77]], radiusM: 30 };
const twoStrokes: ProtectStroke[] = [
  { ...s1, kind: 'protect' },
  { ...s2, kind: 'protect' }
];
/** Consecutive protect strokes are one run: one freehand query over both. */
const runKey = queryKey({ kind: 'freehand', strokes: [s1, s2] });

const lots = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `L${i}`),
  points: new Float64Array(n * 2)
});

function setup(
  opts: {
    strokes?: ProtectStroke[];
    result?: BrushLotsResult;
    phase?: 'ready' | 'loading';
  } = {}
) {
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  if (opts.strokes) {
    const strokes = opts.strokes;
    store.apply((p) => ({ ...p, protect: { ...p.protect, strokes } }), 'Protected lots');
  }
  const brush = new BrushState({ storage: null, fine: false });
  brush.phase = opts.phase ?? 'ready';
  const tools = new SimBrushTools(brush);
  const sync = {
    result: vi.fn((k: string) => (k === runKey ? opts.result : undefined)),
    retry: vi.fn()
  };
  const ontool = vi.fn((t: SimTool) => (tools.tool = t));
  const announce = vi.fn();
  render(ProtectionsSection, { props: { store, sync, tools, ontool, announce } });
  return { store, tools, sync, ontool, announce };
}

describe('ProtectionsSection', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('starts from the policy: no category checked, years 30 and disabled', async () => {
    setup();
    await expect
      .element(page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }))
      .not.toBeChecked();
    await expect
      .element(page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' }))
      .not.toBeChecked();
    await expect
      .element(page.getByRole('checkbox', { name: 'Buildings newer than' }))
      .not.toBeChecked();
    const years = page.getByRole('spinbutton', { name: /years/i });
    await expect.element(years).toBeDisabled();
    await expect.element(years).toHaveValue(30);
    // A real disabled attribute, explained by the checkbox above it.
    expect((years.element() as HTMLInputElement).disabled).toBe(true);
    await expect
      .element(
        page.getByText(
          'Protected lots get no new housing in the simulation. Projects already in the pipeline continue.'
        )
      )
      .toBeVisible();
  });

  it('each checkbox sets its field, as one undoable change', async () => {
    const { store, announce } = setup();
    await page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }).click();
    expect(store.policy.protect.rentControl).toBe(true);
    expect(store.undoLabel).not.toBeNull();
    expect(announce).toHaveBeenCalledWith(store.undoLabel);
    await page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' }).click();
    expect(store.policy.protect.historic).toBe(true);
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    expect(store.policy.protect.newerThanYears).toBe(30);
    await expect.element(page.getByRole('spinbutton', { name: /years/i })).toBeEnabled();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    expect(store.policy.protect.newerThanYears).toBeNull();
    await expect.element(page.getByRole('spinbutton', { name: /years/i })).toBeDisabled();
    // Undo restores the checkbox state from the store.
    store.undo();
    await expect
      .element(page.getByRole('checkbox', { name: 'Buildings newer than' }))
      .toBeChecked();
    store.undo();
    store.undo();
    await expect
      .element(page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }))
      .toBeChecked();
    store.undo();
    await expect
      .element(page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }))
      .not.toBeChecked();
  });

  it('a valid year count sets newerThanYears', async () => {
    const { store } = setup();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    const years = page.getByRole('spinbutton', { name: /years/i });
    await years.fill('50');
    await userEvent.tab();
    expect(store.policy.protect.newerThanYears).toBe(50);
    await expect.element(years).not.toHaveAttribute('aria-invalid');
  });

  it('rejects 0 and out-of-range years with an announced error, keeping the policy', async () => {
    const { store } = setup();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    const years = page.getByRole('spinbutton', { name: /years/i });
    // The error region is in the accessibility tree before any error (WCAG 4.1.3).
    const alert = page.getByRole('alert');
    await expect.element(alert).toBeInTheDocument();
    await expect.element(alert).toHaveTextContent('');
    await years.fill('0');
    await userEvent.tab();
    await expect.element(alert).toHaveTextContent('Enter a whole number of years from 1 to 200.');
    await expect.element(years).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(years)
      .toHaveAccessibleDescription('Enter a whole number of years from 1 to 200.');
    expect(store.policy.protect.newerThanYears).toBe(30);
    await years.fill('201');
    await userEvent.tab();
    await expect.element(alert).toHaveTextContent('Enter a whole number of years from 1 to 200.');
    expect(store.policy.protect.newerThanYears).toBe(30);
    await years.fill('40');
    await userEvent.tab();
    await expect.element(alert).toHaveTextContent('');
    expect(store.policy.protect.newerThanYears).toBe(40);
  });

  it('"Protect lots with the brush" selects the Protect tool', async () => {
    const { ontool, tools } = setup();
    await page.getByRole('button', { name: 'Protect lots with the brush' }).click();
    expect(ontool).toHaveBeenCalledWith('protect');
    expect(tools.tool).toBe('protect');
  });

  it('the Protect button waits for the map, as the tool radios do', async () => {
    setup({ phase: 'loading' });
    await expect
      .element(page.getByRole('button', { name: 'Protect lots with the brush' }))
      .toBeDisabled();
  });

  it('counts the compiled brushed lots; Clear is one change that undo reverses', async () => {
    const { store, announce } = setup({ strokes: twoStrokes, result: lots(3) });
    await expect.element(page.getByText('Protected with the brush · 3 lots')).toBeVisible();
    await expect
      .element(page.getByRole('status').filter({ hasText: '3 lots' }))
      .toBeInTheDocument();
    await page.getByRole('button', { name: 'Clear brush protections' }).click();
    expect(store.policy.protect.strokes).toEqual([]);
    expect(store.undoLabel).toBe('Cleared brush protections');
    expect(announce).toHaveBeenCalledWith('Cleared brush protections');
    await expect.element(page.getByText(/^Protected with the brush/)).not.toBeInTheDocument();
    // Focus does not drop to <body> with the row gone.
    await expect
      .element(page.getByRole('button', { name: 'Protect lots with the brush' }))
      .toHaveFocus();
    store.undo();
    expect(store.policy.protect.strokes).toEqual(twoStrokes);
    await expect.element(page.getByText('Protected with the brush · 3 lots')).toBeVisible();
  });

  it('reads "Finding lots…" while the strokes resolve', async () => {
    setup({ strokes: twoStrokes });
    await expect.element(page.getByText('Protected with the brush · Finding lots…')).toBeVisible();
  });

  it('a failed resolution offers Retry', async () => {
    const { sync } = setup({
      strokes: twoStrokes,
      result: { ok: false, reason: 'bad-request', message: 'x' }
    });
    await expect
      .element(page.getByText("Protected with the brush · Couldn't find lots"))
      .toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(sync.retry).toHaveBeenCalledWith(runKey);
  });
});
