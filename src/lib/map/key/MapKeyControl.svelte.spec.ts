/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { timelineTokenCss } from '$lib/map/palette';
import KeyHost from './test/KeyHost.svelte';

const control = () => page.getByTestId('map-key-control');
const keyToggle = () => page.getByRole('button', { name: 'Map key' });
const layersToggle = () => page.getByRole('button', { name: 'Map layers' });
const keyPanel = () => page.getByRole('group', { name: 'Map key' });
const layersPanel = () => page.getByRole('group', { name: 'Map layers' });
const rect = (el: Element) => el.getBoundingClientRect();

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

/**
 * Resizes the frame and returns once it has rendered at the new size: when the width crosses md,
 * after the `(min-width: 768px)` change event (a listener added before the resize); otherwise
 * after the next animation frame (the rendering update in which media query changes are
 * reported). Then Svelte has applied it. `page.viewport` alone resolves before that: the change
 * event lagged it in 78 of 80 resizes (#131).
 */
async function atViewport(width: number, height: number): Promise<void> {
  const mq = matchMedia('(min-width: 768px)');
  const crosses = mq.matches !== width >= 768;
  const rendered = crosses
    ? new Promise((res) => mq.addEventListener('change', res, { once: true }))
    : null;
  await page.viewport(width, height);
  await (rendered ?? new Promise((res) => requestAnimationFrame(res)));
  await tick();
  expect(innerWidth).toBe(width);
  expect(mq.matches).toBe(width >= 768);
}

beforeEach(async () => {
  await atViewport(1024, 768);
});

afterEach(async () => {
  await scheme('light');
  await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
  document.documentElement.style.removeProperty('--map-controls-br-block-size');
});

describe('MapKeyControl', () => {
  it('a Key toggle named Map key opens a group named Map key above it', async () => {
    await render(KeyHost, { props: {} });
    const t = keyToggle();
    await expect.element(t).toHaveAttribute('aria-expanded', 'false');
    expect(t.element().textContent!.trim()).toBe('Key');
    expect(t.element().getAttribute('data-testid')).toBe('map-key-toggle');
    await expect.element(keyPanel()).not.toBeInTheDocument();
    await t.click();
    await expect.element(t).toHaveAttribute('aria-expanded', 'true');
    await expect.element(keyPanel()).toBeVisible();
    const panel = keyPanel().element();
    expect(panel.getAttribute('data-testid')).toBe('map-key-panel');
    expect(t.element().getAttribute('aria-controls')).toBe(panel.id);
    expect(rect(panel).bottom).toBeLessThanOrEqual(rect(t.element()).top);
    // Right-aligned with the toolbar.
    expect(Math.abs(rect(panel).right - rect(t.element()).right)).toBeLessThan(1);
    expect(page.getByTestId('host-key-body').element()).toBeTruthy();
    const r = await axe.run(control().element());
    expect(r.violations).toEqual([]);
  });

  it('injects its token CSS into <head> once', async () => {
    await render(KeyHost, { props: { withLayers: true, openFromMd: true } });
    const css = timelineTokenCss('.sfh-map-key');
    const styles = [...document.head.querySelectorAll('style')].filter(
      (s) => s.textContent === css
    );
    expect(styles).toHaveLength(1);
    expect(control().element().classList.contains('sfh-map-key')).toBe(true);
  });

  it('going below md closes the key and moves focus from its panel to the toggle; going up keeps it closed', async () => {
    await atViewport(1024, 768);
    await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    (keyPanel().element() as HTMLElement).focus();
    expect(document.activeElement).toBe(keyPanel().element());
    await atViewport(375, 812);
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(keyPanel()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(keyToggle().element());
    await atViewport(1024, 768);
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(keyToggle().element());
    // The viewer opens it again at 1024: it holds.
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
  });

  it('a key the viewer closed at 1024 stays closed after going down and up', async () => {
    await atViewport(1024, 768);
    await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    await keyToggle().click();
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await atViewport(375, 812);
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await atViewport(1024, 768);
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(keyPanel()).not.toBeInTheDocument();
    // Focus was on the toggle throughout (it was clicked), not dropped to the body.
    expect(document.activeElement).toBe(keyToggle().element());
  });

  it('going up keeps a panel the viewer opened below md', async () => {
    await atViewport(375, 812);
    await render(KeyHost, { props: {} });
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
    await atViewport(1024, 768);
    await expect.element(keyPanel()).toBeVisible();
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('atViewport returns once the frame has rendered at the new size, crossing md or not', async () => {
    const mq = matchMedia('(min-width: 768px)');
    for (const width of [1024, 375, 320, 1024, 1280]) {
      const crosses = mq.matches !== width >= 768;
      let fired = false;
      const on = () => (fired = true);
      mq.addEventListener('change', on);
      await atViewport(width, 800);
      mq.removeEventListener('change', on);
      if (crosses) expect(fired).toBe(true);
      expect(innerWidth).toBe(width);
      expect(mq.matches).toBe(width >= 768);
    }
  });

  it('a press that lands after going below md, before the control hears of it, holds', async () => {
    // The size changes before the change event is reported (a rendering update later). A press in
    // between (rotate the phone, tap Key at once) must not be undone when the event arrives. This
    // listener is added before the control mounts, so it runs before the control's own: the press
    // lands after the crossing and before the control reacts to it.
    const mq = matchMedia('(min-width: 768px)');
    const press = () => (keyToggle().element() as HTMLButtonElement).click();
    mq.addEventListener('change', press, { once: true });
    await render(KeyHost, { props: {} });
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await atViewport(375, 812);
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(keyPanel()).toBeVisible();
  });

  it('no Layers toggle without layers; with it, opening one panel closes the other', async () => {
    const r = await render(KeyHost, { props: {} });
    expect(document.querySelector('[data-testid=map-layers-toggle]')).toBeNull();
    await r.rerender({ withLayers: true });
    await expect.element(layersToggle()).toBeVisible();
    expect(layersToggle().element().textContent!.trim()).toBe('Layers');
    expect(layersToggle().element().getAttribute('data-testid')).toBe('map-layers-toggle');
    // Layers first, then Key, 4 px apart.
    const l = rect(layersToggle().element());
    const k = rect(keyToggle().element());
    expect(l.right).toBeLessThan(k.left);
    expect(k.left - l.right).toBeCloseTo(4, 0);
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
    await layersToggle().click();
    await expect.element(layersPanel()).toBeVisible();
    expect(layersPanel().element().getAttribute('data-testid')).toBe('map-layers-panel');
    await expect.element(keyPanel()).not.toBeInTheDocument();
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await layersToggle().click();
    await expect.element(layersPanel()).not.toBeInTheDocument();
  });

  it('Escape closes the open panel and focuses its toggle', async () => {
    await render(KeyHost, { props: { withLayers: true } });
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
    // Focus inside the panel: Escape still closes it.
    (keyPanel().element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await expect.element(keyPanel()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(keyToggle().element());
    await layersToggle().click();
    (page.getByRole('checkbox').element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await expect.element(layersPanel()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(layersToggle().element());
  });

  it('Layers opens a group named Map layers; Escape closes it and focuses Layers', async () => {
    await render(KeyHost, { props: { withLayers: true, openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    const t = layersToggle();
    await expect.element(t).toHaveAttribute('aria-expanded', 'false');
    await expect.element(layersPanel()).not.toBeInTheDocument();
    await t.click();
    await expect.element(layersPanel()).toBeVisible();
    await expect.element(t).toHaveAttribute('aria-expanded', 'true');
    expect(t.element().getAttribute('aria-controls')).toBe(layersPanel().element().id);
    // The pressed toggle keeps focus; the key it replaced is closed.
    expect(document.activeElement).toBe(t.element());
    await expect.element(keyPanel()).not.toBeInTheDocument();
    await expect
      .element(layersPanel().getByRole('checkbox', { name: 'Transit stops' }))
      .toBeVisible();
    expect(rect(layersPanel().element()).bottom).toBeLessThanOrEqual(rect(t.element()).top);
    await userEvent.keyboard('{Escape}');
    await expect.element(layersPanel()).not.toBeInTheDocument();
    await expect.element(t).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(t.element());
    // Key, pressed with Layers open, takes over and keeps focus.
    await t.click();
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
    await expect.element(layersPanel()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(keyToggle().element());
  });

  it('a pointerdown outside the open Layers panel closes it without taking focus', async () => {
    await atViewport(375, 812);
    await render(KeyHost, { props: { withLayers: true, height: 400 } });
    await layersToggle().click();
    await expect.element(layersPanel()).toBeVisible();
    // A press inside the panel keeps it.
    layersPanel()
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(layersPanel()).toBeVisible();
    const before = page.getByTestId('host-before').element() as HTMLElement;
    before.focus();
    page
      .getByTestId('host-canvas')
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(layersPanel()).not.toBeInTheDocument();
    await expect.element(layersToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(before);
  });

  it('openFromMd: open at 1024 px, closed at 375 px', async () => {
    await atViewport(1024, 768);
    const a = await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    await a.unmount();
    await atViewport(375, 812);
    const b = await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await b.unmount();
    // Without openFromMd it starts closed at any width.
    await atViewport(1024, 768);
    await render(KeyHost, { props: {} });
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('onopenchange names the visible panel, and null while closed or hidden', async () => {
    const onopenchange = vi.fn<(open: 'key' | 'layers' | null) => void>();
    const screen = await render(KeyHost, { props: { withLayers: true, onopenchange } });
    const last = () => onopenchange.mock.calls.at(-1)?.[0];
    await expect.poll(last).toBeNull();
    await keyToggle().click();
    await expect.poll(last).toBe('key');
    await layersToggle().click();
    await expect.poll(last).toBe('layers');
    await keyToggle().click();
    await expect.poll(last).toBe('key');
    // Hidden (a sheet over the corner): nothing is visible, though the choice is kept.
    await screen.rerender({ hidden: true });
    await expect.poll(last).toBeNull();
    await screen.rerender({ hidden: false });
    await expect.poll(last).toBe('key');
    await keyToggle()
      .element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.poll(last).toBeNull();
  });

  it('toggles are 24 px on a fine pointer and 44 px on a coarse one', async () => {
    await render(KeyHost, { props: { withLayers: true } });
    for (const t of [keyToggle(), layersToggle()]) {
      const r = rect(t.element());
      expect(r.height).toBeGreaterThanOrEqual(24);
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeLessThan(44);
    }
    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await expect.poll(() => matchMedia('(pointer: coarse)').matches).toBe(true);
    for (const t of [keyToggle(), layersToggle()]) {
      await expect.poll(() => rect(t.element()).height).toBeGreaterThanOrEqual(44);
      expect(rect(t.element()).width).toBeGreaterThanOrEqual(44);
    }
  });

  it('below md a pointerdown on the map closes the panel; from md the key stays open', async () => {
    await atViewport(375, 812);
    const a = await render(KeyHost, { props: { height: 400 } });
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
    // A pointerdown inside the panel keeps it.
    keyPanel()
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(keyPanel()).toBeVisible();
    page
      .getByTestId('host-canvas')
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(keyPanel()).not.toBeInTheDocument();
    await a.unmount();

    await atViewport(1024, 768);
    await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    page
      .getByTestId('host-canvas')
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(keyPanel()).toBeVisible();
  });

  it('hidden: not shown and inert', async () => {
    const r = await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    await r.rerender({ hidden: true });
    await expect.element(control()).not.toBeVisible();
    expect(control().element().hasAttribute('inert')).toBe(true);
    expect(control().element().hasAttribute('hidden')).toBe(true);
    await r.rerender({ hidden: false });
    await expect.element(keyPanel()).toBeVisible();
    expect(control().element().hasAttribute('inert')).toBe(false);
  });

  it('sits right 8 px and 0.5rem above --map-controls-br-block-size, and follows it', async () => {
    await render(KeyHost, { props: { height: 600 } });
    const map = page.getByTestId('host-map').element();
    const root = document.documentElement;
    root.style.setProperty('--map-controls-br-block-size', '20px');
    const toolbarBottom = () => rect(keyToggle().element()).bottom;
    await expect.poll(() => rect(map).bottom - rect(control().element()).bottom).toBeCloseTo(28, 0);
    expect(rect(map).right - rect(control().element()).right).toBeCloseTo(8, 0);
    expect(rect(map).bottom - toolbarBottom()).toBeCloseTo(28, 0);
    root.style.setProperty('--map-controls-br-block-size', '104px');
    await expect.poll(() => rect(map).bottom - toolbarBottom()).toBeCloseTo(112, 0);
  });

  it('the open panel scrolls inside the room above the toolbar', async () => {
    document.documentElement.style.setProperty('--map-controls-br-block-size', '20px');
    // A 220 px map: the toolbar's top is 220 - 28 - 24 = 168 px down, less 8 px at the top and the
    // 4 px gap leaves about 160 px of room for the panel.
    await render(KeyHost, { props: { height: 220, openFromMd: true, lines: 30 } });
    await expect.element(keyPanel()).toBeVisible();
    const panel = keyPanel().element() as HTMLElement;
    const map = page.getByTestId('host-map').element();
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    expect(rect(panel).top).toBeGreaterThanOrEqual(rect(map).top + 8 - 0.5);
    expect(rect(panel).bottom).toBeLessThanOrEqual(rect(keyToggle().element()).top);
    expect(getComputedStyle(panel).overflowY).toBe('auto');
    panel.scrollTop = panel.scrollHeight;
    await expect.poll(() => panel.scrollTop).toBeGreaterThan(0);
  });

  it('stale: the panel text dims to the muted ink; the toggle keeps its colour', async () => {
    const r = await render(KeyHost, { props: { openFromMd: true, withLayers: true } });
    const body = page.getByTestId('host-key-body').element();
    const fresh = getComputedStyle(body).color;
    const toggleColour = getComputedStyle(keyToggle().element()).color;
    await r.rerender({ stale: true });
    await expect.element(keyPanel()).toHaveAttribute('data-stale', 'true');
    await expect.poll(() => getComputedStyle(body).color).not.toBe(fresh);
    expect(getComputedStyle(body).color).toBe('rgb(75, 85, 99)');
    expect(getComputedStyle(keyToggle().element()).color).toBe(toggleColour);
    // The layer switches are not numbers: their panel never dims.
    expect(
      document.querySelector('[data-testid="map-layers-panel"]')!.hasAttribute('data-stale')
    ).toBe(false);
  });

  it('panel width: 15 rem from md, min(18rem, 100vw - 1rem) below', async () => {
    const a = await render(KeyHost, { props: { openFromMd: true } });
    await expect.element(keyPanel()).toBeVisible();
    expect(rect(keyPanel().element()).width).toBeCloseTo(240, 0);
    await a.unmount();
    await atViewport(320, 700);
    await render(KeyHost, { props: {} });
    await keyToggle().click();
    await expect.element(keyPanel()).toBeVisible();
    expect(rect(keyPanel().element()).width).toBeCloseTo(288, 0);
    expect(rect(keyPanel().element()).left).toBeGreaterThanOrEqual(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });

  it('axe: clean open and closed, light and dark', async () => {
    await render(KeyHost, { props: { withLayers: true, openFromMd: true } });
    for (const s of ['light', 'dark'] as const) {
      await scheme(s);
      expect((await axe.run(control().element())).violations).toEqual([]);
      await layersToggle().click();
      await expect.element(layersPanel()).toBeVisible();
      expect((await axe.run(control().element())).violations).toEqual([]);
      await layersToggle().click();
      await expect.element(layersPanel()).not.toBeInTheDocument();
      // Both closed.
      expect((await axe.run(control().element())).violations).toEqual([]);
      await keyToggle().click();
      await expect.element(keyPanel()).toBeVisible();
    }
  });
});
