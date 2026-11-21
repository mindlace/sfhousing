// The map's layer switches (map-on-screen slice 5, Task 6): the rows that were the header View
// menu's, now inside MapKeyControl's Layers panel. Rows only: the panel (the group "Map layers"),
// its toggle, Escape and outside presses are MapKeyControl's (MapKeyControl.svelte.spec.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import LayerSwitches, { LIMITS_CAPTION } from './LayerSwitches.svelte';
import { DEFAULT_VIEW } from './prefs';
import { TOKENS, accessSwatch } from '$lib/map/palette';

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

afterEach(async () => {
  await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
});

describe('LayerSwitches', () => {
  it('renders rows only: no button of its own', async () => {
    render(LayerSwitches, { props: { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn() } });
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeVisible();
    expect(page.getByRole('button').elements()).toEqual([]);
    expect(page.getByRole('group').elements()).toEqual([]);
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });

  it('reports each toggle as a whole new prefs value', async () => {
    const onchange = vi.fn();
    render(LayerSwitches, { props: { view: DEFAULT_VIEW, theme: 'light', onchange } });
    await page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' }).click();
    expect(onchange).toHaveBeenCalledWith({
      transitStops: false,
      transitAccess: true,
      heightLimits: true
    });
  });

  it("rows: the default has no height-limits row; /sim's lists all three in order", async () => {
    const a = await render(LayerSwitches, {
      view: DEFAULT_VIEW,
      theme: 'light',
      onchange: vi.fn()
    });
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeVisible();
    expect(page.getByRole('checkbox', { name: 'Zoning height limits' }).query()).toBeNull();
    await a.unmount();
    render(LayerSwitches, {
      view: DEFAULT_VIEW,
      theme: 'light',
      onchange: vi.fn(),
      rows: ['transitStops', 'transitAccess', 'heightLimits']
    });
    await expect
      .element(page.getByRole('checkbox', { name: 'Zoning height limits' }))
      .toBeVisible();
    const names = page
      .getByRole('checkbox')
      .elements()
      .map((e) => e.closest('label')!.textContent!.trim());
    expect(names).toEqual([
      'Transit stops',
      'Transit capacity within a 10-minute walk',
      'Zoning height limits'
    ]);
  });

  it('the Zoning height limits row toggles heightLimits only, with its caption', async () => {
    const onchange = vi.fn();
    render(LayerSwitches, {
      view: DEFAULT_VIEW,
      theme: 'light',
      onchange,
      rows: ['heightLimits']
    });
    await expect
      .element(page.getByRole('checkbox', { name: 'Zoning height limits' }))
      .toBeChecked();
    await page.getByRole('checkbox', { name: 'Zoning height limits' }).click();
    expect(onchange).toHaveBeenCalledWith({ ...DEFAULT_VIEW, heightLimits: false });
    // Under 12 words (the rest-text rule), shortened from the View menu's caption.
    expect(LIMITS_CAPTION).toBe(
      'Glass lids at the height zoning allows. Zoomed out, contour lines.'
    );
    await expect.element(page.getByText(LIMITS_CAPTION)).toBeVisible();
  });

  it('shows both legends and the caption', async () => {
    render(LayerSwitches, { props: { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn() } });
    await expect.element(page.getByText('BART / Caltrain')).toBeVisible();
    await expect.element(page.getByText('30k+')).toBeVisible();
    await expect
      .element(
        page.getByText('Estimated weekday 7–9 am capacity, riders per hour. Existing service only.')
      )
      .toBeVisible();
  });

  it('swatches follow the theme prop', async () => {
    const { rerender } = await render(LayerSwitches, {
      props: { view: DEFAULT_VIEW, theme: 'dark', onchange: vi.fn() }
    });
    const fifth = () =>
      getComputedStyle(
        document.querySelectorAll('[aria-label="Transit capacity legend"] li > span')[4]
      ).backgroundColor;
    expect(fifth()).toBe(rgb(accessSwatch('dark', 5)));
    await rerender({ theme: 'light' });
    expect(fifth()).toBe(rgb(accessSwatch('light', 5)));
  });

  it('stop swatches use the stop tokens', async () => {
    render(LayerSwitches, { props: { view: DEFAULT_VIEW, theme: 'dark', onchange: vi.fn() } });
    await expect.element(page.getByText('BART / Caltrain')).toBeVisible();
    const spans = [...document.querySelectorAll('[aria-label="Transit stops legend"] li > span')];
    expect(spans.map((s) => getComputedStyle(s).backgroundColor)).toEqual(
      ['transit-regional', 'transit-rail', 'transit-bus'].map((k) =>
        rgb(TOKENS.dark[k as 'transit-bus'])
      )
    );
  });

  it('each switch is 24 px tall on every pointer, and toggles by keyboard', async () => {
    const onchange = vi.fn();
    render(LayerSwitches, {
      view: DEFAULT_VIEW,
      theme: 'light',
      onchange,
      rows: ['transitStops', 'transitAccess', 'heightLimits']
    });
    const labels = () =>
      page
        .getByRole('checkbox')
        .elements()
        .map((e) => e.closest('label')!);
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeVisible();
    for (const l of labels()) expect(l.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await expect.poll(() => matchMedia('(pointer: coarse)').matches).toBe(true);
    for (const l of labels()) expect(l.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    // Space on a focused switch toggles it, as a click does.
    (page.getByRole('checkbox', { name: 'Transit stops' }).element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    expect(onchange).toHaveBeenCalledWith({ ...DEFAULT_VIEW, transitStops: true });
  });
});
