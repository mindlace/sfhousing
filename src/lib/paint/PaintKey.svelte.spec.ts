/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { TOKENS } from '$lib/map/palette';
import type { PlanOp } from '$lib/plan';
import type { HeightLotsResult } from '$lib/sim/protocol';
import PaintKey from './PaintKey.svelte';

const path: [number, number][] = [[-122.42, 37.77]];
const paint = (id: string, stories: number): PlanOp => ({
  kind: 'paint',
  id,
  stories,
  radiusM: 10,
  path
});
const erase = (id: string): PlanOp => ({ kind: 'erase', id, radiusM: 10, path });
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('button[data-height]')];
const texts = () => rows().map((b) => b.textContent!.trim());

async function setup(ops: PlanOp[], result: HeightLotsResult | null = null) {
  const onshow = vi.fn<(s: number | null) => void>();
  const screen = await render(PaintKey, { ops, result, shown: null, onshow });
  return { onshow, screen };
}

afterEach(async () => {
  await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
});

describe('PaintKey', () => {
  it('names the six building types beside their colours', async () => {
    await setup([]);
    const list = page.getByRole('list', { name: 'New buildings' });
    await expect.element(list).toBeVisible();
    const items = list.getByRole('listitem').elements();
    expect(items.map((li) => li.textContent!.trim())).toEqual([
      'ADU',
      'House or plex',
      'Walk-up',
      '5-over-1',
      'Mid-rise',
      'Tower'
    ]);
    for (const li of items) {
      const sw = li.querySelector('[data-swatch="solid"] [data-token]');
      expect(sw?.getAttribute('data-token')).toMatch(/^gen-/);
    }
  });

  it('lists each painted height with its text, ascending; none with an empty plan', async () => {
    const empty = await setup([erase('e')]);
    expect(page.getByRole('list', { name: 'Painted' }).elements()).toEqual([]);
    expect(rows()).toEqual([]);
    await empty.screen.unmount();

    const ops = [paint('a', 8), paint('b', 3), paint('c', 8)];
    const { screen } = await setup(ops);
    await expect.element(page.getByRole('list', { name: 'Painted' })).toBeVisible();
    // Before the first answer: the height only, never a false zero.
    expect(texts()).toEqual(['3 stories · …', '8 stories · …']);
    await screen.rerender({
      result: {
        heights: [
          { stories: 3, lots: 1, rebuilt: 1 },
          { stories: 8, lots: 42, rebuilt: 30 }
        ],
        missing: 2,
        outline: null
      }
    });
    expect(texts()).toEqual([
      '3 stories · 1+ lots · 1 rebuilt',
      '8 stories · 42+ lots · 30 rebuilt'
    ]);
    await screen.rerender({
      result: {
        heights: [
          { stories: 3, lots: 1, rebuilt: 0 },
          { stories: 8, lots: 42, rebuilt: 30 }
        ],
        missing: 0,
        outline: null
      }
    });
    expect(texts()).toEqual(['3 stories · 1 lot · 0 rebuilt', '8 stories · 42 lots · 30 rebuilt']);
    // A height the answer does not hold yet (a stroke just added it) waits for its count.
    await screen.rerender({ ops: [...ops, paint('d', 12)] });
    expect(texts().at(-1)).toBe('12 stories · …');
  });

  it('hover and focus outline a height; leave and blur clear it; a press pins it', async () => {
    const { onshow, screen } = await setup([paint('a', 3), paint('b', 8)]);
    const last = () => onshow.mock.calls.at(-1)?.[0];
    const [three, eight] = rows();
    await userEvent.hover(three);
    await expect.poll(last).toBe(3);
    await userEvent.unhover(three);
    await expect.poll(last).toBeNull();
    // Keyboard focus.
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(three);
    await expect.poll(last).toBe(3);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(eight);
    await expect.poll(last).toBe(8);
    eight.blur();
    await expect.poll(last).toBeNull();
    // A press pins it past leave and blur.
    await userEvent.click(eight);
    await expect
      .element(page.getByRole('button', { name: /^8 stories/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(three.getAttribute('aria-pressed')).toBe('false');
    await userEvent.unhover(eight);
    eight.blur();
    await expect.poll(last).toBe(8);
    // Hovering another shows it for as long as the pointer stays; leaving goes back to the pin.
    await userEvent.hover(three);
    await expect.poll(last).toBe(3);
    await userEvent.unhover(three);
    await expect.poll(last).toBe(8);
    // Pressing another moves the pin; pressing it again clears it.
    await userEvent.click(three);
    expect(eight.getAttribute('aria-pressed')).toBe('false');
    expect(three.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(three);
    expect(three.getAttribute('aria-pressed')).toBe('false');
    await userEvent.unhover(three);
    await expect.poll(last).toBeNull();
    // A pinned row whose height leaves the plan clears its outline.
    await userEvent.click(eight);
    await userEvent.unhover(eight);
    await expect.poll(last).toBe(8);
    await screen.rerender({ ops: [paint('a', 3)] });
    await expect.poll(last).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('the shown height is marked on its row', async () => {
    const { screen } = await setup([paint('a', 3), paint('b', 8)]);
    expect(rows().map((b) => b.dataset.shown)).toEqual([undefined, undefined]);
    await screen.rerender({ shown: 8 });
    expect(rows().map((b) => b.dataset.shown)).toEqual([undefined, 'true']);
  });

  it('each height row is a 24 px button (44 coarse) with aria-pressed', async () => {
    await setup([paint('a', 3)]);
    const b = page.getByRole('button', { name: /^3 stories/ });
    await expect.element(b).toHaveAttribute('aria-pressed', 'false');
    expect(b.element().getAttribute('type')).toBe('button');
    expect(b.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await expect.poll(() => matchMedia('(pointer: coarse)').matches).toBe(true);
    await expect.poll(() => b.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it("each height row carries a dashed swatch in the map outline's colour", async () => {
    await setup([paint('a', 3)]);
    const sw = rows()[0].querySelector<HTMLElement>('[data-swatch="outline"]')!;
    expect(sw.closest('[aria-hidden="true"]')).not.toBeNull();
    const cs = getComputedStyle(sw);
    expect(cs.borderTopStyle).toBe('dashed');
    expect(cs.borderTopColor).toBe(hexToRgb(TOKENS.light['painted-outline']));
    // Pressed, the swatch fills: a cue besides the row's tint.
    expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await userEvent.click(rows()[0]);
    await expect.poll(() => getComputedStyle(sw).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
