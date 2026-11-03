/// <reference types="@vitest/browser-playwright" />
// The Paint tab: the Move, Paint and Erase radios, the height palette, the brush size and the
// painted-area rows (select, Remove with its focus rule, Retry).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import type { PaintRow } from './rows';
import PaintTabHost from './test/PaintTabHost.svelte';

const rows: PaintRow[] = [
  { id: 'a', kind: 'paint', stories: 8, strokes: 3, lots: { kind: 'found', lots: 52 } },
  { id: 'b', kind: 'erase', stories: null, strokes: 1, lots: { kind: 'found', lots: 1 } },
  { id: 'c', kind: 'paint', stories: 1, strokes: 2, lots: { kind: 'finding' } }
];

function setup(
  opts: {
    phase?: 'ready' | 'loading';
    rows?: PaintRow[];
    tool?: 'move' | 'paint' | 'erase';
    selected?: string | null;
    readonly?: boolean;
  } = {}
) {
  const brush = new BrushState({ fine: false, storage: null });
  brush.phase = opts.phase ?? 'ready';
  const ontool = vi.fn();
  const onremove = vi.fn();
  const onretry = vi.fn();
  render(PaintTabHost, {
    props: {
      brush,
      rows: opts.rows ?? rows,
      tool: opts.tool,
      selected: opts.selected,
      readonly: opts.readonly,
      ontool,
      onremove,
      onretry
    }
  });
  return { brush, ontool, onremove, onretry };
}

const radio = (name: string) => page.getByRole('radio', { name, exact: true });
const rowBtn = (id: string) =>
  page.elementLocator(document.querySelector(`[data-paint-row="${id}"]`)!);
const selectedOut = () => document.querySelector('[data-testid="selected"]')!.textContent;

describe('PaintTab', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('offers Move, Paint and Erase as radios in a Brush tool group', async () => {
    setup({ tool: 'paint' });
    const group = page.getByRole('radiogroup', { name: 'Brush tool' });
    await expect.element(group).toBeVisible();
    const names = group
      .getByRole('radio')
      .elements()
      .map((e) => e.textContent?.trim());
    expect(names).toEqual(['Move', 'Paint', 'Erase']);
    await expect.element(radio('Paint')).toHaveAttribute('aria-checked', 'true');
    await expect.element(radio('Move')).toHaveAttribute('aria-checked', 'false');
    await expect.element(page.getByRole('group', { name: 'Height' })).toBeVisible();
    await expect.element(page.getByRole('slider')).toBeVisible();
  });

  it('chooses a tool and moves between enabled ones with the arrow keys', async () => {
    const { ontool } = setup();
    await radio('Paint').click();
    expect(ontool).toHaveBeenCalledWith('paint');
    await expect.element(radio('Paint')).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(ontool).toHaveBeenLastCalledWith('erase');
    await expect.element(radio('Erase')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(ontool).toHaveBeenLastCalledWith('move');
    await expect.element(radio('Move')).toHaveFocus();
    await expect.element(radio('Move')).toHaveAttribute('tabindex', '0');
    await expect.element(radio('Paint')).toHaveAttribute('tabindex', '-1');
  });

  it('disables Paint and Erase while the city is loading, so arrows stay on Move', async () => {
    const { ontool } = setup({ phase: 'loading' });
    await expect.element(radio('Paint')).toBeDisabled();
    await expect.element(radio('Erase')).toBeDisabled();
    await expect.element(radio('Move')).toBeEnabled();
    (radio('Move').element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(ontool).not.toHaveBeenCalled();
    await expect.element(radio('Move')).toHaveFocus();
  });

  it('disables the height palette with the hint while Erase is chosen', async () => {
    setup({ tool: 'erase' });
    await expect
      .element(page.getByRole('button', { name: '12 stories', exact: true }))
      .toBeDisabled();
    await expect.element(page.getByText('Erase has no height.')).toBeVisible();
  });

  it('keeps the height palette enabled for Paint', async () => {
    setup({ tool: 'paint' });
    await expect
      .element(page.getByRole('button', { name: '12 stories', exact: true }))
      .toBeEnabled();
    expect(page.getByText('Erase has no height.').elements()).toHaveLength(0);
  });

  it('lists the painted areas in order with name and meta, lot count as a status', async () => {
    setup();
    const list = page.getByRole('list', { name: 'Painted areas' });
    await expect.element(list).toBeVisible();
    const items = list.getByRole('listitem').elements();
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('8 stories');
    expect(items[0].textContent).toContain('3 strokes · 52 lots');
    expect(items[1].textContent).toContain('Erased');
    expect(items[1].textContent).toContain('1 stroke · 1 lot');
    expect(items[2].textContent).toContain('1 story');
    await expect.element(list.getByRole('status').first()).toHaveTextContent('52 lots');
  });

  it('shows no list without rows', async () => {
    setup({ rows: [] });
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toHaveLength(0);
  });

  it('selects a row on press, shows its Remove, and unselects on a second press', async () => {
    setup();
    expect(page.getByRole('button', { name: /^Remove:/ }).elements()).toHaveLength(0);
    await rowBtn('a').click();
    expect(selectedOut()).toBe('a');
    await expect.element(rowBtn('a')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(rowBtn('b')).toHaveAttribute('aria-pressed', 'false');
    await expect
      .element(page.getByRole('button', { name: 'Remove: 8 stories · 3 strokes · 52 lots' }))
      .toBeVisible();
    await rowBtn('a').click();
    expect(selectedOut()).toBe('');
    await expect.element(rowBtn('a')).toHaveAttribute('aria-pressed', 'false');
    expect(page.getByRole('button', { name: /^Remove:/ }).elements()).toHaveLength(0);
  });

  it('Remove calls onremove and focus moves to the next row, then the one before, then the tool', async () => {
    const { onremove } = setup({ selected: 'a', tool: 'paint' });
    await page.getByRole('button', { name: /^Remove: 8 stories/ }).click();
    expect(onremove).toHaveBeenCalledWith('a');
    await expect.element(rowBtn('b')).toHaveFocus();

    await rowBtn('c').click();
    await page.getByRole('button', { name: /^Remove: 1 story/ }).click();
    expect(onremove).toHaveBeenLastCalledWith('c');
    await expect.element(rowBtn('b')).toHaveFocus();

    await rowBtn('b').click();
    await page.getByRole('button', { name: /^Remove: Erased/ }).click();
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toHaveLength(0);
    await expect.element(radio('Paint')).toHaveFocus();
  });

  it('readonly shows the rows alone: no tools, palette, size or Remove, and rows still select', async () => {
    setup({ readonly: true, selected: 'a' });
    expect(page.getByRole('radiogroup').elements()).toHaveLength(0);
    expect(page.getByRole('group', { name: 'Height' }).elements()).toHaveLength(0);
    expect(page.getByRole('slider').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Remove:/ }).elements()).toHaveLength(0);
    await rowBtn('b').click();
    expect(selectedOut()).toBe('b');
    await expect.element(rowBtn('b')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a failed row shows Retry, which calls onretry with its keys', async () => {
    const { onretry } = setup({
      rows: [
        {
          id: 'f',
          kind: 'paint',
          stories: 5,
          strokes: 1,
          lots: { kind: 'failed', keys: ['k1', 'k2'] }
        }
      ]
    });
    await expect.element(page.getByRole('status')).toHaveTextContent("Couldn't find lots");
    await page.getByRole('button', { name: /^Retry/ }).click();
    expect(onretry).toHaveBeenCalledWith(['k1', 'k2']);
  });

  it('gives no Retry to a row that found its lots', async () => {
    setup();
    expect(page.getByRole('button', { name: /^Retry/ }).elements()).toHaveLength(0);
  });
});
