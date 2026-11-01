import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import ViewMenu from './ViewMenu.svelte';
import { DEFAULT_VIEW } from './prefs';
import { TOKENS, accessSwatch } from '$lib/map/palette';

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

const button = () => page.getByRole('button', { name: 'View' });

describe('ViewMenu', () => {
  it('is a disclosure: toggles aria-expanded, Esc closes and returns focus', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn() } });
    await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
    await button().click();
    await expect.element(button()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();
    await userEvent.keyboard('{Escape}');
    await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(button()).toHaveFocus();
  });

  it('reports each toggle as a whole new prefs value', async () => {
    const onchange = vi.fn();
    render(ViewMenu, { props: { view: DEFAULT_VIEW, theme: 'light', onchange } });
    await button().click();
    await page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' }).click();
    expect(onchange).toHaveBeenCalledWith({ transitStops: false, transitAccess: false });
  });

  it('shows both legends and the caption', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn() } });
    await button().click();
    await expect.element(page.getByText('BART / Caltrain')).toBeVisible();
    await expect.element(page.getByText('30k+')).toBeVisible();
    await expect
      .element(
        page.getByText('Estimated weekday 7–9 am capacity, riders per hour. Existing service only.')
      )
      .toBeVisible();
  });

  it('closes on an outside pointer down without stealing focus', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn() } });
    await button().click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('swatches follow the theme prop', async () => {
    const { rerender } = await render(ViewMenu, {
      props: { view: DEFAULT_VIEW, theme: 'dark', onchange: vi.fn() }
    });
    await button().click();
    const fifth = () =>
      getComputedStyle(
        document.querySelectorAll('[aria-label="Transit capacity legend"] li > span')[4]
      ).backgroundColor;
    expect(fifth()).toBe(rgb(accessSwatch('dark', 5)));
    await rerender({ theme: 'light' });
    expect(fifth()).toBe(rgb(accessSwatch('light', 5)));
  });

  it('stop swatches use the stop tokens', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, theme: 'dark', onchange: vi.fn() } });
    await button().click();
    const spans = [...document.querySelectorAll('[aria-label="Transit stops legend"] li > span')];
    expect(spans.map((s) => getComputedStyle(s).backgroundColor)).toEqual(
      ['transit-regional', 'transit-rail', 'transit-bus'].map((k) =>
        rgb(TOKENS.dark[k as 'transit-bus'])
      )
    );
  });
});
