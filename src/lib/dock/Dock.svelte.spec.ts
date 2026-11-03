/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { flushSync } from 'svelte';
import '../../routes/layout.css';
import { DockState } from './dock-state.svelte';
import DockHost from './test/DockHost.svelte';

type Props = {
  state: DockState;
  onflip?: () => void;
  onclose?: () => void;
  onsheetheight?: (px: number) => void;
  resultsOnly?: boolean;
  focusOnOpen?: boolean;
};

async function setup(state: DockState, extra: Partial<Props> = {}) {
  const props = { state, ...extra };
  const view = await render(DockHost, { props });
  return view;
}

const map = () => page.getByTestId('map').element() as HTMLElement;
const dockW = () => getComputedStyle(map()).getPropertyValue('--dock-w').trim();
const tab = (name: string) => page.getByRole('tab', { name });
const inDock = () =>
  document.querySelector('[data-testid="dock"]')!.contains(document.activeElement);

afterEach(() => {
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('Dock, desktop', () => {
  it('shows one tablist named by the label; the arrow keys move selection and focus', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'transit' }));
    const lists = page.getByRole('tablist');
    await expect.element(lists).toBeVisible();
    expect(lists.elements()).toHaveLength(1);
    expect(lists.element().getAttribute('aria-label')).toBe('Policy');
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
    (tab('Transit').element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(tab('Zoning')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab('Zoning').element());
    await userEvent.keyboard('{End}');
    await expect.element(tab('Permits')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(tab('Permits')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    await expect.element(tab('Transit')).toHaveAttribute('aria-selected', 'true');
  });

  it('uses a roving tabindex, and the tabpanel is labelled by the selected tab', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'paint' }));
    expect(tab('Zoning').element().getAttribute('tabindex')).toBe('0');
    expect(tab('Transit').element().getAttribute('tabindex')).toBe('-1');
    const panel = page.getByRole('tabpanel', { name: 'Zoning' });
    await expect.element(panel).toBeVisible();
    expect(panel.element().id).toBe(tab('Zoning').element().getAttribute('aria-controls'));
    await expect.element(panel.getByText('paint body')).toBeVisible();
    // Undo sits above the panel, inside the face.
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  it('is a section 320 px wide with the dock root named by the label', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'transit' }));
    const root = page.getByTestId('dock').element();
    expect(root.id).toBe('host-dock');
    expect(root.getAttribute('aria-label')).toBe('Policy');
    expect(root.classList.contains('sfh-dock')).toBe(true);
    const panel = document.querySelector('.sfh-dock-panel') as HTMLElement;
    expect(panel.tagName).toBe('SECTION');
    expect(panel.getBoundingClientRect().width).toBe(320);
    expect(page.getByRole('button', { name: 'Collapse Policy' }).query()).not.toBeNull();
  });

  it('on Results: no tablist; the flip button comes first and calls onflip', async () => {
    await page.viewport(1024, 768);
    const state = new DockState({ tab: 'transit' });
    state.face = 'results';
    const onflip = vi.fn();
    await setup(state, { onflip });
    expect(page.getByRole('tablist').query()).toBeNull();
    const flip = page.getByTestId('dock-flip');
    await expect.element(flip).toBeVisible();
    expect(flip.element().textContent?.trim()).toBe('Edit policy');
    const panel = document.querySelector('.sfh-dock-panel')!;
    const focusables = panel.querySelectorAll<HTMLElement>('button, [href], input, [tabindex="0"]');
    expect(focusables[0]).toBe(flip.element());
    const details = page.getByTestId('score-details');
    expect(details.element().getAttribute('role')).toBe('region');
    expect(details.element().getAttribute('aria-label')).toBe('Results');
    await expect.element(details.getByText('Results body')).toBeVisible();
    await flip.click();
    expect(onflip).toHaveBeenCalledOnce();
  });

  it('collapsed: a rail with a button per tab plus Results; Permits opens the panel there and focuses its tab', async () => {
    await page.viewport(1024, 768);
    const state = new DockState({ tab: 'transit', open: false });
    await setup(state);
    const rail = page.getByTestId('dock-rail');
    await expect.element(rail).toBeVisible();
    expect(rail.element().tagName).toBe('NAV');
    expect(rail.element().getAttribute('aria-label')).toBe('Policy');
    expect(rail.element().getBoundingClientRect().width).toBe(48);
    const names = rail
      .getByRole('button')
      .elements()
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Transit', 'Zoning', 'Permits', 'Results']);
    expect(page.getByRole('tablist').query()).toBeNull();
    await rail.getByRole('button', { name: 'Permits' }).click();
    await expect.element(page.getByRole('tablist')).toBeVisible();
    await expect.element(tab('Permits')).toHaveAttribute('aria-selected', 'true');
    await vi.waitFor(() => expect(document.activeElement).toBe(tab('Permits').element()));
    expect(page.getByTestId('dock-rail').query()).toBeNull();
  });

  it('the rail Results button opens the panel on Results', async () => {
    await page.viewport(1024, 768);
    const state = new DockState({ tab: 'transit', open: false });
    await setup(state);
    await page.getByTestId('dock-rail').getByRole('button', { name: 'Results' }).click();
    await expect.element(page.getByTestId('score-details')).toBeVisible();
    expect(state.face).toBe('results');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(page.getByTestId('dock-flip').element())
    );
  });

  it('with resultsOnly the rail shows the Results button alone', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'transit', open: false }), { resultsOnly: true });
    const buttons = page.getByTestId('dock-rail').getByRole('button').elements();
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Results']);
  });

  it('the collapse button folds the panel to the rail and calls onclose', async () => {
    await page.viewport(1024, 768);
    const onclose = vi.fn();
    const state = new DockState({ tab: 'transit' });
    await setup(state, { onclose });
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    expect(state.open).toBe(false);
    await expect.element(page.getByTestId('dock-rail')).toBeVisible();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  });

  it('with no onclose the collapse leaves focus on the rail, not on the body', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'paint' }));
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        page.getByTestId('dock-rail').getByRole('button', { name: 'Zoning' }).element()
      )
    );
  });

  it('Escape with focus inside collapses it and calls onclose', async () => {
    await page.viewport(1024, 768);
    const onclose = vi.fn();
    const state = new DockState({ tab: 'transit' });
    await setup(state, { onclose });
    await page.getByRole('button', { name: 'transit control' }).click();
    expect(inDock()).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(state.open).toBe(false);
    await expect.element(page.getByTestId('dock-rail')).toBeVisible();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  });

  it('Escape with focus outside the dock does nothing', async () => {
    await page.viewport(1024, 768);
    const onclose = vi.fn();
    const state = new DockState({ tab: 'transit' });
    await setup(state, { onclose });
    (document.activeElement as HTMLElement).blur();
    expect(inDock()).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(state.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('Escape while a modal dialog is open does nothing', async () => {
    await page.viewport(1024, 768);
    const onclose = vi.fn();
    const state = new DockState({ tab: 'transit' });
    await setup(state, { onclose });
    const control = page.getByRole('button', { name: 'transit control' }).element() as HTMLElement;
    const d = document.createElement('dialog');
    const b = document.createElement('button');
    b.textContent = 'in dialog';
    d.appendChild(b);
    document.body.appendChild(d);
    d.showModal();
    expect(d.matches(':modal')).toBe(true);
    // The modal moves focus out of the dock; report it still in the dock, as it is when the
    // dialog is opened from a dock control and has not taken focus yet.
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(control);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    spy.mockRestore();
    expect(e.defaultPrevented).toBe(false);
    expect(state.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('publishes --dock-w: 320px open, 48px as a rail, and moves the map control with it', async () => {
    await page.viewport(1024, 768);
    const state = new DockState({ tab: 'transit' });
    await setup(state);
    const ctrl = () => page.getByTestId('ctrl').element().getBoundingClientRect().left;
    expect(dockW()).toBe('320px');
    expect(ctrl() - map().getBoundingClientRect().left).toBe(320);
    state.open = false;
    flushSync();
    await expect.element(page.getByTestId('dock-rail')).toBeVisible();
    expect(dockW()).toBe('48px');
    expect(ctrl() - map().getBoundingClientRect().left).toBe(48);
  });

  it('opening with focusOnOpen moves focus in; the default open (false) does not', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'transit' }), { focusOnOpen: false });
    await expect.element(page.getByRole('tablist')).toBeVisible();
    expect(inDock()).toBe(false);
  });

  it('with focusOnOpen the panel takes focus when it mounts', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'transit' }), { focusOnOpen: true });
    await vi.waitFor(() => expect(inDock()).toBe(true));
  });
});

describe('Dock, phone', () => {
  it('is a handle naming the active tab; pressing it opens a non-modal sheet and moves focus in', async () => {
    await page.viewport(375, 700);
    const onsheetheight = vi.fn();
    const state = new DockState({ tab: 'permits' });
    await setup(state, { onsheetheight, focusOnOpen: false });
    const handle = page.getByTestId('dock-handle');
    await expect.element(handle).toBeVisible();
    expect(handle.element().textContent?.trim()).toBe('Permits');
    expect(handle.element().getAttribute('aria-expanded')).toBe('false');
    expect(page.getByRole('tablist').query()).toBeNull();
    expect(dockW()).toBe('');
    await handle.click();
    await expect.element(handle).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('tablist')).toBeVisible();
    await vi.waitFor(() => expect(inDock()).toBe(true));
    expect(document.querySelector('dialog')).toBeNull();
    expect(page.getByRole('dialog').query()).toBeNull();
    await vi.waitFor(() =>
      expect(Math.max(0, ...onsheetheight.mock.calls.map((c) => c[0]))).toBeGreaterThan(0)
    );
    expect(state.sheet).toBe('full');
  });

  it('the handle on Results reads "Results"; a peek is about 40dvh and the body scrolls', async () => {
    await page.viewport(375, 700);
    const state = new DockState({ tab: 'transit' });
    state.face = 'results';
    state.sheet = 'peek';
    const onsheetheight = vi.fn();
    await setup(state, { onsheetheight, focusOnOpen: false });
    const handle = page.getByTestId('dock-handle');
    expect(handle.element().textContent?.trim()).toBe('Results');
    await vi.waitFor(() => expect(onsheetheight).toHaveBeenCalled());
    const last = () => onsheetheight.mock.calls.at(-1)![0] as number;
    expect(last()).toBeLessThanOrEqual(0.4 * 700 + 1);
    expect(last()).toBeGreaterThan(40);
    state.sheet = 'full';
    flushSync();
    await vi.waitFor(() => expect(last()).toBeGreaterThan(0.4 * 700));
    expect(last()).toBeLessThanOrEqual(0.85 * 700 + 1);
  });

  it('the Collapse button and Escape close the sheet', async () => {
    await page.viewport(375, 700);
    const state = new DockState({ tab: 'transit' });
    state.sheet = 'full';
    await setup(state);
    await page.getByRole('button', { name: 'Collapse Policy' }).click();
    expect(state.sheet).toBe('closed');
    state.sheet = 'full';
    flushSync();
    await page.getByRole('button', { name: 'transit control' }).click();
    await userEvent.keyboard('{Escape}');
    expect(state.sheet).toBe('closed');
  });

  it('the handle closes a full sheet and expands a peek', async () => {
    await page.viewport(375, 700);
    const state = new DockState({ tab: 'transit' });
    state.sheet = 'peek';
    await setup(state);
    await page.getByTestId('dock-handle').click();
    expect(state.sheet).toBe('full');
    await page.getByTestId('dock-handle').click();
    expect(state.sheet).toBe('closed');
  });

  it('a header overlay opening (the Menu) closes it; opening it announces itself', async () => {
    await page.viewport(375, 700);
    const state = new DockState({ tab: 'transit' });
    state.sheet = 'full';
    await setup(state);
    const seen: string[] = [];
    window.addEventListener('sfh-header-overlay-open', (e) =>
      seen.push((e as CustomEvent<string>).detail)
    );
    await expect.element(page.getByRole('tablist')).toBeVisible();
    window.dispatchEvent(new CustomEvent('sfh-header-overlay-open', { detail: 'menu' }));
    await vi.waitFor(() => expect(state.sheet).toBe('closed'));
    await expect.element(page.getByTestId('dock-handle')).toHaveAttribute('aria-expanded', 'false');
    state.sheet = 'peek';
    flushSync();
    await vi.waitFor(() => expect(seen.some((d) => d !== 'menu')).toBe(true));
  });
});

describe('Dock, face header', () => {
  /** Scrolls the nearest scrolling ancestor of the face header to its end. */
  function scrollBody(header: HTMLElement): HTMLElement {
    let el: HTMLElement | null = header.parentElement;
    while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement;
    expect(el).not.toBeNull();
    el!.scrollTop = el!.scrollHeight;
    expect(el!.scrollTop).toBeGreaterThan(0);
    return el!;
  }

  it('the tablist and collapse button stay in view when a tall tab body scrolls (panel)', async () => {
    await page.viewport(1024, 768);
    await setup(new DockState({ tab: 'transit' }), { focusOnOpen: false });
    const list = page.getByRole('tablist').element() as HTMLElement;
    const collapse = page.getByRole('button', { name: 'Collapse Policy' }).element();
    const panel = scrollBody(list.parentElement!);
    const top = panel.getBoundingClientRect().top;
    expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(top - 1);
    expect(list.getBoundingClientRect().top).toBeLessThan(top + 20);
    expect(collapse.getBoundingClientRect().top).toBeLessThan(top + 20);
  });

  it('the flip and collapse buttons stay in view on a tall Results body (panel)', async () => {
    await page.viewport(1024, 768);
    const state = new DockState({ tab: 'transit' });
    state.face = 'results';
    await setup(state, { focusOnOpen: false });
    const flip = page.getByTestId('dock-flip').element();
    const panel = scrollBody(flip.parentElement!.parentElement!);
    const top = panel.getBoundingClientRect().top;
    expect(flip.getBoundingClientRect().top).toBeLessThan(top + 20);
    expect(flip.getBoundingClientRect().top).toBeGreaterThanOrEqual(top - 1);
  });

  it('the tablist stays in view when the sheet body scrolls (phone)', async () => {
    await page.viewport(375, 700);
    const state = new DockState({ tab: 'transit' });
    state.sheet = 'full';
    await setup(state, { focusOnOpen: false });
    const list = page.getByRole('tablist').element() as HTMLElement;
    const body = scrollBody(list.parentElement!);
    const top = body.getBoundingClientRect().top;
    expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(top - 1);
    expect(list.getBoundingClientRect().top).toBeLessThan(top + 20);
  });
});

describe('Dock, resizing', () => {
  it('375 -> 1024 with the sheet open on Permits shows the panel on Permits and keeps focus inside', async () => {
    await page.viewport(375, 700);
    const state = new DockState({ tab: 'permits', open: false });
    await setup(state, { focusOnOpen: false });
    await page.getByTestId('dock-handle').click();
    await vi.waitFor(() => expect(inDock()).toBe(true));
    await page.viewport(1024, 768);
    await vi.waitFor(() => expect(document.querySelector('.sfh-dock-panel')).not.toBeNull());
    expect(document.querySelector('.sfh-dock-sheet')).toBeNull();
    await expect.element(tab('Permits')).toHaveAttribute('aria-selected', 'true');
    expect(state.open).toBe(true);
    await vi.waitFor(() => expect(inDock()).toBe(true));
  });
});
