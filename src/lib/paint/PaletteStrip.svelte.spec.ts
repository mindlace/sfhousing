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

function setup(tool: BrushTool = 'paint') {
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
      onready: (f: () => void) => (focus = f)
    }
  });
  return { brush, ontool, ondone, calls, focus: () => focus() };
}

const strip = () => page.getByRole('group', { name: 'Brush', exact: true });
const btn = (name: string) => page.getByRole('button', { name, exact: true });
const swatch = () => page.getByRole('button', { name: /^Height: / });
const palette = () => page.getByRole('group', { name: 'Height', exact: true });

describe('PaletteStrip at 375 px', () => {
  beforeEach(async () => {
    await page.viewport(375, 700);
  });

  it('is one row of tool, height, size and Done', async () => {
    setup();
    await expect.element(strip()).toBeVisible();
    await expect.element(page.getByTestId('palette-strip')).toBeVisible();
    const names = ['Tool: Paint', 'Height: 6 stories', 'Brush 30 m', 'Done'];
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
    await btn('Brush 30 m').click();
    await expect.element(btn('Brush 30 m')).toHaveAttribute('aria-expanded', 'true');
    await expect.element(swatch()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Erase disables the swatch and gives it the hint', async () => {
    setup('erase');
    await expect.element(btn('Tool: Erase')).toBeVisible();
    await expect.element(swatch()).toBeDisabled();
    await expect.element(swatch()).toHaveAccessibleDescription(HINT);
    await expect.element(btn('Brush 30 m')).toBeEnabled();
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
