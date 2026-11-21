/// <reference types="@vitest/browser-playwright" />
// The phone palette strip: tool, height swatch (a pop-over holding the height palette), size and
// Done, on one line.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { BrushTool } from '$lib/brush/sampler';
import { BrushState } from '$lib/brush/state.svelte';
import PaletteStripHost from './test/PaletteStripHost.svelte';

const HINT = 'Erase has no height.';

function setup(tool: BrushTool = 'paint', extra: Record<string, unknown> = {}) {
  const brush = new BrushState({ storage: null, fine: false });
  brush.phase = 'ready';
  const calls: string[] = [];
  const ontool = vi.fn((t: BrushTool) => calls.push(`tool:${t}`));
  const ondone = vi.fn(() => calls.push('done'));
  let focus = () => {};
  render(PaletteStripHost, {
    props: {
      brush,
      tool,
      eraseHint: HINT,
      ontool,
      ondone,
      onready: (f: () => void) => (focus = f),
      ...extra
    }
  });
  return { brush, ontool, ondone, calls, focus: () => focus() };
}

const strip = () => page.getByRole('group', { name: 'Brush', exact: true });
const btn = (name: string) => page.getByRole('button', { name, exact: true });
const swatch = () => page.getByRole('button', { name: /^Height: / });
const palette = () => page.getByRole('group', { name: 'Height', exact: true });

describe('PaletteStrip Undo', () => {
  beforeEach(async () => {
    await page.viewport(375, 700);
  });

  it('with onundo, Undo sits before Done, is disabled with nothing to undo, and calls it', async () => {
    const onundo = vi.fn();
    setup('paint', { onundo, canUndo: false });
    const undo = btn('Undo');
    await expect.element(undo).toBeDisabled();
    const done = btn('Done').element();
    expect(undo.element().compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(document.querySelectorAll('[data-testid="palette-strip"] button')).toHaveLength(5);
  });

  it('calls onundo when there is something to undo', async () => {
    const onundo = vi.fn();
    setup('paint', { onundo, canUndo: true });
    await btn('Undo').click();
    expect(onundo).toHaveBeenCalledOnce();
  });

  it('without onundo there is no Undo (as on /sim)', async () => {
    setup();
    await expect.element(strip()).toBeVisible();
    expect(page.getByRole('button', { name: 'Undo' }).elements()).toEqual([]);
  });

  it('at 320 px the Brush size pop-over is inside the viewport and its targets are 24 px', async () => {
    await page.viewport(320, 700);
    setup('paint', { onundo: vi.fn(), canUndo: true });
    await btn('Brush size: 30 m').click();
    const pop = page.getByRole('group', { name: 'Brush size', exact: true });
    await expect.element(pop).toBeVisible();
    const box = pop.element().getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(320);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(700);
    const targets = pop.element().querySelectorAll('button, input, [role="slider"]');
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const r = t.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });

  for (const tool of ['paint', 'erase'] as const) {
    it(`at 320 px in ${tool} the strip with Undo is inside the viewport and every target is 24 px`, async () => {
      await page.viewport(320, 700);
      setup(tool, { onundo: vi.fn(), canUndo: true });
      await expect.element(btn('Undo')).toBeVisible();
      const bar = page.getByTestId('palette-strip').element().getBoundingClientRect();
      expect(bar.right).toBeLessThanOrEqual(312);
      expect(bar.left).toBeGreaterThanOrEqual(8);
      for (const b of document.querySelectorAll('[data-testid="palette-strip"] button')) {
        const r = b.getBoundingClientRect();
        expect(r.width).toBeGreaterThanOrEqual(24);
        expect(r.height).toBeGreaterThanOrEqual(24);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    });
  }
});

describe('PaletteStrip Redo', () => {
  beforeEach(async () => {
    await page.viewport(375, 700);
  });

  it('with onredo: Redo after Undo, named Redo: {label}, disabled without canRedo', async () => {
    const onundo = vi.fn();
    const onredo = vi.fn();
    setup('paint', {
      onundo,
      onredo,
      canUndo: true,
      canRedo: false,
      undoLabel: 'Painted 8 stories',
      redoLabel: 'Erased'
    });
    const undo = btn('Undo: Painted 8 stories');
    const redo = btn('Redo: Erased');
    await expect.element(undo).toBeEnabled();
    await expect.element(redo).toBeDisabled();
    await expect.element(redo).toHaveAttribute('title', 'Redo: Erased');
    await expect.element(undo).toHaveAttribute('title', 'Undo: Painted 8 stories');
    // Order: Undo, Redo, Done.
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(undo.element(), redo.element())).toBe(true);
    expect(follows(redo.element(), btn('Done').element())).toBe(true);
  });

  it('without labels the two are named Undo and Redo; Redo calls onredo when enabled', async () => {
    const onredo = vi.fn();
    setup('paint', { onundo: vi.fn(), onredo, canRedo: true });
    await expect.element(btn('Undo')).toBeVisible();
    await btn('Redo').click();
    expect(onredo).toHaveBeenCalledOnce();
  });

  for (const tool of ['paint', 'erase'] as const) {
    it(`at 320 px in ${tool} the strip with Undo and Redo fits inside the viewport`, async () => {
      await page.viewport(320, 700);
      setup(tool, { onundo: vi.fn(), onredo: vi.fn(), canUndo: true, canRedo: true });
      await expect.element(btn('Redo')).toBeVisible();
      const bar = page.getByTestId('palette-strip').element().getBoundingClientRect();
      expect(bar.left).toBeGreaterThanOrEqual(8);
      expect(bar.right).toBeLessThanOrEqual(312);
      const buttons = [...document.querySelectorAll('[data-testid="palette-strip"] button')];
      expect(buttons).toHaveLength(6);
      const top = buttons[0].getBoundingClientRect().top;
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        expect(r.width).toBeGreaterThanOrEqual(24);
        expect(r.height).toBeGreaterThanOrEqual(24);
        expect(Math.abs(r.top - top)).toBeLessThan(10);
      }
      // Done is its check, still named Done.
      await expect.element(btn('Done')).toBeVisible();
      expect(btn('Done').element().querySelector('svg')?.getBoundingClientRect().width).toBe(20);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    });
  }

  it('at 375 px Done keeps its word beside Undo and Redo, inside the viewport', async () => {
    setup('erase', { onundo: vi.fn(), onredo: vi.fn() });
    await expect.element(page.getByText('Done', { exact: true })).toBeVisible();
    const bar = page.getByTestId('palette-strip').element().getBoundingClientRect();
    expect(bar.right).toBeLessThanOrEqual(375 - 8);
  });
});

describe('PaletteStrip at 375 px', () => {
  beforeEach(async () => {
    await page.viewport(375, 700);
  });

  it('is one row of tool, height, size and Done', async () => {
    setup();
    await expect.element(strip()).toBeVisible();
    await expect.element(page.getByTestId('palette-strip')).toBeVisible();
    const names = ['Tool: Paint', 'Height: 6 stories', 'Brush size: 30 m', 'Done'];
    const boxes = [];
    for (const n of names) {
      await expect.element(btn(n)).toBeVisible();
      boxes.push((btn(n).element() as HTMLElement).getBoundingClientRect());
    }
    // One line: the same band of y, left to right, inside the viewport.
    const top = boxes[0].top;
    for (const b of boxes) expect(Math.abs(b.top - top)).toBeLessThan(8);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
    }
    expect(boxes.at(-1)!.right).toBeLessThanOrEqual(375);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    // Targets are at least 24 px.
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(24);
      expect(b.height).toBeGreaterThanOrEqual(24);
    }
    // Names are unique.
    const all = [...document.querySelectorAll('[data-testid="palette-strip"] button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim()
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it('the tool button cycles Paint and Erase', async () => {
    const { ontool } = setup();
    await btn('Tool: Paint').click();
    expect(ontool).toHaveBeenLastCalledWith('erase');
    await expect.element(btn('Tool: Erase')).toBeVisible();
    await btn('Tool: Erase').click();
    expect(ontool).toHaveBeenLastCalledWith('paint');
    await expect.element(btn('Tool: Paint')).toBeVisible();
  });

  it('the swatch opens the palette; choosing 6 stories sets the brush and closes it', async () => {
    const { brush } = setup();
    brush.setStories(12);
    await expect.element(swatch()).toHaveAttribute('aria-expanded', 'false');
    await swatch().click();
    await expect.element(swatch()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(palette()).toBeVisible();
    await btn('6 stories').click();
    expect(brush.stories).toBe(6);
    await expect.element(palette()).not.toBeInTheDocument();
    await expect.element(swatch()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(swatch()).toHaveTextContent('6');
  });

  it('Escape closes the palette and returns focus to the swatch', async () => {
    setup();
    await swatch().click();
    await btn('More stories').click();
    await expect.element(palette()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(palette()).not.toBeInTheDocument();
    await expect.element(swatch()).toHaveFocus();
  });

  it('is keyboard-operable: Enter on the swatch opens it, Tab reaches the palette', async () => {
    setup();
    swatch().element().focus();
    await userEvent.keyboard('{Enter}');
    await expect.element(swatch()).toHaveAttribute('aria-expanded', 'true');
    await userEvent.tab();
    await expect.element(btn('2 stories')).toHaveFocus();
  });

  it('opening the size closes the palette', async () => {
    setup();
    await swatch().click();
    await btn('Brush size: 30 m').click();
    await expect.element(btn('Brush size: 30 m')).toHaveAttribute('aria-expanded', 'true');
    await expect.element(swatch()).toHaveAttribute('aria-expanded', 'false');
    await expect
      .element(page.getByRole('group', { name: 'Brush size', exact: true }))
      .toBeVisible();
  });

  it('Erase disables the swatch and gives it the hint', async () => {
    setup('erase');
    await expect.element(btn('Tool: Erase')).toBeVisible();
    await expect.element(swatch()).toBeDisabled();
    await expect.element(swatch()).toHaveAccessibleDescription(HINT);
    await expect.element(btn('Brush size: 30 m')).toBeEnabled();
  });

  it('Done chooses Move, then reports done', async () => {
    const { calls } = setup();
    await btn('Done').click();
    expect(calls).toEqual(['tool:move', 'done']);
  });

  it('focus() focuses the first control', async () => {
    const { focus } = setup();
    focus();
    await expect.element(btn('Tool: Paint')).toHaveFocus();
  });
});
