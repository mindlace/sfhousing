/// <reference types="@vitest/browser-playwright" />
// The Paint tab: the Move, Paint and Erase radios, the height palette, the brush size and the
// painted-area rows (select, Remove with its focus rule, Retry).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import PaintTab from './PaintTab.svelte';
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

  it('offers Move, Paint and Erase as radios in a Tool group', async () => {
    setup({ tool: 'paint' });
    const group = page.getByRole('radiogroup', { name: 'Tool' });
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

  it('labels Tool, Height and Brush size on screen, and each control by its label', async () => {
    setup({ tool: 'paint' });
    for (const text of ['Tool', 'Height', 'Brush size']) {
      await expect.element(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect.element(page.getByRole('radiogroup', { name: 'Tool', exact: true })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Height', exact: true })).toBeVisible();
    const slider = page.getByRole('slider', { name: 'Brush size', exact: true });
    await expect.element(slider).toHaveAttribute('aria-valuetext', '30 metres');
    await expect.element(page.getByText('30 m', { exact: true })).toBeVisible();
    // Real labels: the group's name comes from the visible text, the slider's from a label.
    const tools = page.getByRole('radiogroup').element();
    const heading = document.getElementById(tools.getAttribute('aria-labelledby')!);
    expect(heading?.textContent).toBe('Tool');
    expect(tools.hasAttribute('aria-label')).toBe(false);
    const input = slider.element() as HTMLInputElement;
    expect(input.labels?.[0]?.textContent).toBe('Brush size');
  });

  it('draws the brush-size slider in the accent token (light: #a3472c)', async () => {
    setup({ tool: 'paint' });
    const slider = page.getByRole('slider');
    await expect.element(slider).toBeVisible();
    expect(getComputedStyle(slider.element()).accentColor).toBe('rgb(163, 71, 44)');
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

  it('names a row button "name · meta" and keeps the lot status outside it', async () => {
    setup();
    await expect
      .element(page.getByRole('button', { name: '8 stories · 3 strokes · 52 lots', exact: true }))
      .toBeVisible();
    const btn = document.querySelector('[data-paint-row="a"]')!;
    const status = btn.closest('li')!.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('52 lots');
    expect(btn.contains(status)).toBe(false);
    expect(btn.querySelector('[role="status"]')).toBeNull();
    // The visible text (name, then meta) is in the button, so the name contains it (WCAG 2.5.3).
    expect(btn.textContent).toContain('8 stories');
    expect(btn.textContent).toContain('3 strokes · 52 lots');
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

  it('shows the intro first, and read-only the summary in place of rows', async () => {
    const brush = new BrushState({ fine: false, storage: null });
    brush.phase = 'ready';
    // `/` passes no rows, selection or Remove: the props are optional.
    const editable = await render(PaintTab, {
      props: { brush, tool: 'move', ontool: () => {}, eraseHint: 'x', intro: 'Start here.' }
    });
    const tab = () => editable.container.firstElementChild!;
    await expect.element(page.getByText('Start here.', { exact: true })).toBeVisible();
    expect(tab().firstElementChild!.textContent).toBe('Start here.');
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
    // The intro sits above the Tool label.
    const label = page.getByText('Tool', { exact: true }).element();
    expect(
      tab().firstElementChild!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toHaveLength(0);
    await editable.unmount();

    const shared = await render(PaintTab, {
      props: {
        brush,
        tool: 'move',
        ontool: () => {},
        eraseHint: 'x',
        readonly: true,
        rows,
        intro: 'Read-only. Remix to edit.',
        summary: '6 and 8 stories · 2 lots rebuilt'
      }
    });
    const lines = [...shared.container.firstElementChild!.children].map((e) => e.textContent);
    expect(lines).toEqual(['Read-only. Remix to edit.', '6 and 8 stories · 2 lots rebuilt']);
    expect(page.getByRole('list', { name: 'Painted areas' }).elements()).toHaveLength(0);
    expect(document.querySelector('[data-paint-row]')).toBeNull();
    expect(page.getByRole('radiogroup').elements()).toHaveLength(0);
  });

  it('gives no Retry to a row that found its lots', async () => {
    setup();
    expect(page.getByRole('button', { name: /^Retry/ }).elements()).toHaveLength(0);
  });
});
