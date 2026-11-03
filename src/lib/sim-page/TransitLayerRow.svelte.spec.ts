/// <reference types="@vitest/browser-playwright" />
// One transit layer row: the select button (swatch, name, lot count), and, selected, the editor in
// place (stop-type chips, per band a distance and a stories stepper, + Band, Remove layer), whose
// every control hands back a rule the band rule accepts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { BrushCatalog } from '$lib/sim/levers/brushes';
import type { LotStatus } from '$lib/paint/rows';
import { bandProblem, type ZoningRule } from './policy';
import { testCatalog } from './test/catalog';
import TransitLayerRowHost from './test/TransitLayerRowHost.svelte';

const metro: ZoningRule = {
  id: 'r1',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [
    { maxM: 402, stories: 8 },
    { maxM: 805, stories: 4 }
  ]
};

function setup(
  opts: {
    rule?: ZoningRule;
    status?: LotStatus;
    catalog?: BrushCatalog | null;
    selected?: boolean;
  } = {}
) {
  const onselect = vi.fn();
  const onedit = vi.fn<(next: ZoningRule, coalesce?: string) => void>();
  const onremove = vi.fn();
  const onretry = vi.fn();
  render(TransitLayerRowHost, {
    props: {
      rule: opts.rule ?? metro,
      status: opts.status,
      catalog: opts.catalog === undefined ? testCatalog() : opts.catalog,
      selected: opts.selected ?? true,
      onselect,
      onedit,
      onremove,
      onretry
    }
  });
  return { onselect, onedit, onremove, onretry };
}

const row = () => document.querySelector('[data-layer-row="r1"]') as HTMLElement;
const selectBtn = () => page.getByRole('button', { name: /^Near / });
const band = (n: number) => page.getByRole('group', { name: `Band ${n}`, exact: true });
const chips = () => page.getByRole('group', { name: 'Stop types' });
const chip = (name: RegExp) => chips().getByRole('button', { name });
const distance = (n: number) => band(n).getByRole('spinbutton', { name: /^Within/ });
const more = (n: number) => band(n).getByRole('button', { name: 'More stories' });
const fewer = (n: number) => band(n).getByRole('button', { name: 'Fewer stories' });

/** Every rule handed to `onedit` is one the parser and `compileLevers` accept. */
function expectValid(calls: [ZoningRule, string?][]): void {
  for (const [r] of calls) {
    expect(bandProblem(r.bands)).toBeNull();
    expect(r.stopTypes.length).toBeGreaterThan(0);
    expect(r.bands.length).toBeGreaterThanOrEqual(1);
    expect(r.bands.length).toBeLessThanOrEqual(3);
  }
}

describe('TransitLayerRow', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('collapsed shows the swatch, the name and the lot count, and no editor', async () => {
    const { onselect } = setup({ selected: false });
    const btn = selectBtn();
    await expect.element(btn).toHaveAccessibleName('Near Muni Metro · 8 stories · 1,204 lots');
    await expect.element(btn).toHaveAttribute('aria-pressed', 'false');
    const el = btn.element();
    // The swatch: the tallest band's stories on the neutral tile.
    expect(el.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('8');
    expect(el.textContent).toContain('Near Muni Metro');
    expect(el.textContent).toContain('1,204 lots');
    expect(chips().query()).toBeNull();
    expect(page.getByRole('button', { name: 'Remove layer' }).query()).toBeNull();
    await btn.click();
    expect(onselect).toHaveBeenCalledOnce();
  });

  it('keeps the lot status outside the select button, as a polite sibling', async () => {
    setup({ selected: false });
    const btn = selectBtn().element();
    const status = row().querySelector('[role="status"]')!;
    expect(status.textContent).toBe('1,204 lots');
    expect(btn.contains(status)).toBe(false);
    expect(btn.querySelector('[role="status"]')).toBeNull();
  });

  it('a failed lookup offers Retry with its keys', async () => {
    const { onretry } = setup({ selected: false, status: { kind: 'failed', keys: ['k1', 'k2'] } });
    await page.getByRole('button', { name: /^Retry/ }).click();
    expect(onretry).toHaveBeenCalledWith(['k1', 'k2']);
  });

  it('selected shows the editor: chips with stop counts, the bands innermost first, + Band, Remove layer', async () => {
    setup();
    await expect.element(selectBtn()).toHaveAttribute('aria-pressed', 'true');
    const named = chips()
      .getByRole('button')
      .elements()
      .map((b) => b.textContent?.trim());
    expect(named).toEqual([
      'Regional rail (BART, Caltrain) · 12 stops',
      'Muni Metro · 40 stops',
      'Muni Rapid bus · 80 stops',
      'Frequent bus (6+ trips an hour) · 300 stops'
    ]);
    await expect.element(chip(/^Muni Metro/)).toHaveAttribute('aria-pressed', 'true');
    await expect.element(chip(/^Muni Rapid/)).toHaveAttribute('aria-pressed', 'false');
    await expect.element(distance(1)).toHaveValue(402);
    await expect.element(distance(2)).toHaveValue(805);
    await expect.element(band(1)).toHaveTextContent(/8\s*stories/);
    await expect.element(band(2)).toHaveTextContent(/4\s*stories/);
    await expect.element(page.getByRole('button', { name: 'Add band' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Remove layer' })).toBeVisible();
    // The editor follows the select button.
    const editor = chips().element();
    expect(
      selectBtn().element().compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('without a catalog a chip reads the stop label alone', async () => {
    setup({ catalog: null });
    await expect.element(chip(/^Muni Metro/)).toHaveTextContent(/^\s*Muni Metro\s*$/);
  });

  it('a saved rule out of order shows innermost first', async () => {
    setup({ rule: { ...metro, bands: [...metro.bands].reverse() } });
    await expect.element(distance(1)).toHaveValue(402);
    await expect.element(distance(2)).toHaveValue(805);
  });

  it("More stories on the outer band is disabled at the inner band's height; Fewer on the inner at the outer's", async () => {
    const { onedit } = setup({
      rule: {
        ...metro,
        bands: [
          { maxM: 402, stories: 6 },
          { maxM: 805, stories: 6 }
        ]
      }
    });
    await expect.element(more(2)).toHaveAttribute('aria-disabled', 'true');
    await expect.element(fewer(1)).toHaveAttribute('aria-disabled', 'true');
    await expect.element(more(1)).not.toHaveAttribute('aria-disabled', 'true');
    await expect.element(fewer(2)).not.toHaveAttribute('aria-disabled', 'true');
    // Playwright will not click an aria-disabled button without force.
    await more(2).click({ force: true });
    await fewer(1).click({ force: true });
    expect(onedit).not.toHaveBeenCalled();
    // Pressing the inner band's More frees the outer's.
    await more(1).click();
    expect(onedit).toHaveBeenLastCalledWith(
      {
        ...metro,
        bands: [
          { maxM: 402, stories: 7 },
          { maxM: 805, stories: 6 }
        ]
      },
      'rule:r1:stories:0'
    );
    await expect.element(more(2)).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('typing 402 into band 2 (band 1 at 402) commits 403; a non-number reverts', async () => {
    const { onedit } = setup();
    await distance(2).fill('402');
    await userEvent.keyboard('{Enter}');
    expect(onedit).toHaveBeenLastCalledWith(
      {
        ...metro,
        bands: [
          { maxM: 402, stories: 8 },
          { maxM: 403, stories: 4 }
        ]
      },
      'rule:r1:distance:1'
    );
    await expect.element(distance(2)).toHaveValue(403);
    await expect.element(distance(2)).toHaveAttribute('min', '403');
    await expect.element(distance(1)).toHaveAttribute('max', '402');
    const calls = onedit.mock.calls.length;
    await distance(2).fill('');
    await userEvent.keyboard('{Enter}');
    await expect.element(distance(2)).toHaveValue(403);
    expect(onedit).toHaveBeenCalledTimes(calls);
  });

  it("a distance input's bounds come from its neighbours, not a fixed cap", async () => {
    // A saved rule past the editor's cap: the inner band may go up to just below the outer.
    setup({
      rule: {
        ...metro,
        bands: [
          { maxM: 402, stories: 8 },
          { maxM: 5000, stories: 4 }
        ]
      }
    });
    await expect.element(distance(1)).toHaveAttribute('max', '4999');
    await expect.element(distance(1)).toHaveAttribute('min', '1');
  });

  it('the last pressed chip is aria-disabled with its reason, and pressing it calls nothing', async () => {
    const { onedit } = setup();
    const last = chip(/^Muni Metro/);
    await expect.element(last).toHaveAttribute('aria-disabled', 'true');
    await expect.element(last).toHaveAccessibleDescription('A layer needs at least one stop type');
    await last.click({ force: true });
    expect(onedit).not.toHaveBeenCalled();
    await expect.element(last).toHaveAttribute('aria-pressed', 'true');
    // With a second stop on, neither is the last.
    await chip(/^Muni Rapid/).click();
    expect(onedit.mock.calls.at(-1)![0]).toEqual({ ...metro, stopTypes: ['metro', 'rapidBus'] });
    expect(onedit.mock.calls.at(-1)![1]).toBeUndefined();
    await expect.element(last).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('+ Band is disabled at three bands; Remove band is disabled with one', async () => {
    const { onedit } = setup({ rule: { ...metro, bands: [{ maxM: 402, stories: 8 }] } });
    await expect
      .element(band(1).getByRole('button', { name: 'Remove band' }))
      .toHaveAttribute('aria-disabled', 'true');
    const add = page.getByRole('button', { name: 'Add band' });
    await add.click();
    await add.click();
    expect(onedit).toHaveBeenCalledTimes(2);
    expect(onedit.mock.calls[0][1]).toBeUndefined();
    await expect.element(band(3)).toBeVisible();
    await expect.element(add).toHaveAttribute('aria-disabled', 'true');
    await add.click({ force: true });
    expect(onedit).toHaveBeenCalledTimes(2);
    await band(2).getByRole('button', { name: 'Remove band' }).click();
    expect(onedit).toHaveBeenCalledTimes(3);
    expect(onedit.mock.calls[2][1]).toBeUndefined();
    await expect.element(band(3)).not.toBeInTheDocument();
    // Focus stays in the editor (on + Band) after its band is gone.
    await expect.element(add).toHaveFocus();
  });

  it('Remove layer calls onremove', async () => {
    const { onremove } = setup();
    await page.getByRole('button', { name: 'Remove layer' }).click();
    expect(onremove).toHaveBeenCalledOnce();
  });

  it('each control calls onedit with a rule bandProblem accepts', async () => {
    const { onedit } = setup();
    await chip(/^Regional rail/).click();
    await chip(/^Muni Metro/).click();
    // force: past a bound the button is aria-disabled and the press does nothing.
    for (let k = 0; k < 6; k++) await more(2).click({ force: true }); // stops at band 1's 8
    for (let k = 0; k < 3; k++) await fewer(1).click({ force: true }); // stops at band 2's
    await more(1).click();
    await distance(1).fill('900');
    await userEvent.keyboard('{Enter}');
    await distance(2).fill('1');
    await userEvent.keyboard('{Enter}');
    await page.getByRole('button', { name: 'Add band' }).click();
    await distance(3).fill('99999');
    await userEvent.keyboard('{Enter}');
    await more(3).click({ force: true });
    await band(1).getByRole('button', { name: 'Remove band' }).click();
    await fewer(1).click({ force: true });
    expect(onedit.mock.calls.length).toBeGreaterThan(10);
    expectValid(onedit.mock.calls);
  });
});
