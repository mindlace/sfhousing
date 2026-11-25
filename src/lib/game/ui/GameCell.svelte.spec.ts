/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { GameStore, openGame } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import { FakeGame, entry, type FakeGameInit } from './test/fake-game.svelte';
import CellHost from './test/CellHost.svelte';

vi.mock('./reload', () => ({ reloadGame: vi.fn() }));
vi.mock('$lib/sharing/storage', async (orig) => ({
  ...(await orig<typeof import('$lib/sharing/storage')>()),
  getStorage: () => localStorage
}));

let colors: 'light' | 'dark' = 'light';
let motionPref: 'no-preference' | 'reduce' = 'no-preference';

/** Emulated media replace one another, so each call sends both features. */
async function emulate(): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: colors },
      { name: 'prefers-reduced-motion', value: motionPref }
    ]
  });
}

async function scheme(value: 'light' | 'dark') {
  colors = value;
  await emulate();
}

async function motion(value: 'no-preference' | 'reduce') {
  motionPref = value;
  await emulate();
}

beforeEach(() => localStorage.clear());

afterEach(async () => {
  colors = 'light';
  motionPref = 'no-preference';
  await emulate();
});

const cell = () => page.getByTestId('header-units');
const box = () => page.getByTestId('header-game-panel');
const rect = (el: Element) => el.getBoundingClientRect();
const units = (n: number) => ({ home: n });
/** What the cell shows: its aria-hidden spans (the mark, then the rolling count). */
const shown = () =>
  [...cell().element().querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent).join('');

async function mount(init: FakeGameInit = {}, inMenu = false) {
  const game = new FakeGame(init);
  const onescape = vi.fn();
  const view = await render(CellHost, { props: { game: game.asStore(), inMenu, onescape } });
  await expect.element(cell()).toBeVisible();
  return { game, onescape, view };
}

describe('GameCell', () => {
  it('the count and its name', async () => {
    await page.viewport(1280, 800);
    await mount({ state: { units: units(1240) } });
    await expect.element(cell()).toHaveAccessibleName('1,240 units');
    expect(shown()).toBe('◆1,240');
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the count rolls to a new total; with reduced motion it jumps', async () => {
    await page.viewport(1280, 800);
    const { game } = await mount({ state: { units: units(100) } });
    expect(shown()).toBe('◆100');
    game.state = { ...game.state, units: units(1100) };
    await tick();
    await expect.element(cell()).toHaveAccessibleName('1,100 units'); // true count at once
    expect(shown()).not.toBe('◆1,100'); // still rolling
    await expect.poll(shown).toBe('◆1,100'); // ends at the total
    // The page's media query reports the change by event, the cell's listener first; wait for it.
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = new Promise((res) => mq.addEventListener('change', res, { once: true }));
    await motion('reduce');
    await changed;
    await tick();
    game.state = { ...game.state, units: units(2100) };
    await tick();
    expect(shown()).toBe('◆2,100'); // no roll
  });

  it('a new total while rolling ends at the latest', async () => {
    await page.viewport(1280, 800);
    const { game } = await mount({ state: { units: units(100) } });
    game.state = { ...game.state, units: units(1100) };
    await tick();
    game.state = { ...game.state, units: units(2100) };
    await expect.element(cell()).toHaveAccessibleName('2,100 units');
    await expect.poll(shown).toBe('◆2,100');
    await tick();
    expect(shown()).toBe('◆2,100');
  });

  it("from lg the panel is a pop-over at the cell's left edge inside the viewport", async () => {
    await page.viewport(1280, 800);
    const saves = Array.from({ length: 12 }, (_, i) => entry(`Game ${i + 1}`));
    await mount({ saves });
    await cell().click();
    await expect.element(box()).toBeVisible();
    expect(box().element().id).toBe(cell().element().getAttribute('aria-controls'));
    expect(box().element().querySelector('[data-testid="game-panel"]')).not.toBeNull();
    const banner = rect(page.getByRole('banner').element());
    const p = rect(box().element());
    expect(p.top).toBeGreaterThanOrEqual(banner.bottom);
    expect(Math.abs(p.left - rect(cell().element()).left)).toBeLessThan(1);
    expect(p.width).toBe(320);
    expect(p.right).toBeLessThanOrEqual(1280);
    await cell().click();
    await expect.element(box()).not.toBeInTheDocument();

    await page.viewport(1280, 500);
    await cell().click();
    await expect.element(box()).toBeVisible();
    const el = box().element() as HTMLElement;
    expect(rect(el).height).toBeLessThanOrEqual(500 - 64);
    expect(getComputedStyle(el).overflowY).toBe('auto');
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
  });

  it('out of the Menu opening announces the overlay; in the Menu it opens in place and announces nothing', async () => {
    await page.viewport(1280, 800);
    const heard: unknown[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener('sfh-header-overlay-open', listen);
    try {
      const { game, view } = await mount();
      await cell().click();
      await expect.element(box()).toBeVisible();
      expect(heard).toEqual([box().element().id]);
      await view.unmount();

      heard.length = 0;
      await page.viewport(375, 812);
      await render(CellHost, { props: { game: game.asStore(), inMenu: true } });
      await cell().click();
      await expect.element(box()).toBeVisible();
      expect(heard).toEqual([]);
      const menuBox = page.getByTestId('menu-box').element();
      expect(menuBox.contains(box().element())).toBe(true);
      expect(rect(box().element()).top).toBeGreaterThanOrEqual(rect(cell().element()).bottom);
      expect(box().element().classList.contains('absolute')).toBe(false);
    } finally {
      window.removeEventListener('sfh-header-overlay-open', listen);
    }
  });

  it('opening does not move focus', async () => {
    await page.viewport(1280, 800);
    await mount();
    (cell().element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    await expect.element(box()).toBeVisible();
    expect(document.activeElement).toBe(cell().element());
  });

  it('Escape closes and refocuses; a press outside closes', async () => {
    await page.viewport(1280, 800);
    const { onescape } = await mount();
    await cell().click();
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(box()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(box()).not.toBeInTheDocument();
    await expect.element(cell()).toHaveFocus();
    expect(onescape).toHaveBeenCalled();
    await cell().click();
    await expect.element(box()).toBeVisible();
    // Right of the pop-over, which covers the area's left part.
    await page.getByTestId('outside').click({ position: { x: 1200, y: 200 } });
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(box()).not.toBeInTheDocument();
  });

  it('Escape in the rename field leaves the panel open', async () => {
    await page.viewport(1280, 800);
    await mount();
    await cell().click();
    await expect.element(box()).toBeVisible();
    await page.getByRole('button', { name: 'Rename Mission' }).click();
    const field = page.getByRole('textbox', { name: 'Name' });
    await expect.element(field).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(field).not.toBeInTheDocument();
    await expect.element(box()).toBeVisible();
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('button', { name: 'Rename Mission' })).toHaveFocus();
  });

  it('Escape leaves the panel while a modal dialog is open or the key was handled', async () => {
    await page.viewport(1280, 800);
    await mount();
    await cell().click();
    await expect.element(box()).toBeVisible();

    const dialog = document.createElement('dialog');
    dialog.textContent = 'Modal';
    document.body.appendChild(dialog);
    dialog.showModal();
    try {
      await userEvent.keyboard('{Escape}');
      await expect.element(box()).toBeVisible();
    } finally {
      dialog.remove();
    }

    const take = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', take, true);
    try {
      await userEvent.keyboard('{Escape}');
      await expect.element(box()).toBeVisible();
    } finally {
      window.removeEventListener('keydown', take, true);
    }

    await userEvent.keyboard('{Escape}');
    await expect.element(box()).not.toBeInTheDocument();
  });

  for (const width of [1280, 375])
    it(`at ${width}px following a link in the panel closes it`, async () => {
      await page.viewport(width, 800);
      const sync = new FakeSync();
      sync.state = 'sign-in';
      await mount({ sync }, width < 1024);
      await cell().click();
      await expect.element(box()).toBeVisible();
      // The header outlives a client navigation (it is the root layout's): keep the frame here.
      const stay = (e: MouseEvent) => e.preventDefault();
      window.addEventListener('click', stay);
      try {
        await box().getByRole('link').click();
      } finally {
        window.removeEventListener('click', stay);
      }
      await expect.element(box()).not.toBeInTheDocument();
      await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    });

  it('another header overlay opening closes it', async () => {
    await page.viewport(1280, 800);
    await mount();
    await cell().click();
    await expect.element(box()).toBeVisible();
    window.dispatchEvent(new CustomEvent('sfh-header-overlay-open', { detail: 'other' }));
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(box()).not.toBeInTheDocument();
  });

  for (const inMenu of [false, true])
    it(`the root carries data-header-keep-open (inMenu ${inMenu})`, async () => {
      await page.viewport(inMenu ? 375 : 1280, 800);
      await mount({}, inMenu);
      const root = cell().element().closest('[data-header-keep-open]');
      expect(root).not.toBeNull();
      await cell().click();
      await expect.element(box()).toBeVisible();
      expect(root!.contains(box().element())).toBe(true);
    });

  it('nothing renders for the open game', async () => {
    await page.viewport(1280, 800);
    await render(CellHost, { props: { game: openGame(), inMenu: false } });
    await tick();
    await expect.element(cell()).not.toBeInTheDocument();
    await expect.element(box()).not.toBeInTheDocument();
  });

  it('against the real store', async () => {
    await page.viewport(1280, 800);
    const store = new GameStore({ storage: new MemoryStorage(), sync: new FakeSync() });
    await render(CellHost, { props: { game: store, inMenu: false } });
    await expect.element(cell()).toHaveAccessibleName('0 units');
    await cell().click();
    await expect.element(box()).toBeVisible();
    await expect
      .element(box().getByRole('heading', { level: 2 }))
      .toHaveTextContent(store.saves[0].name);
  });

  it('every control is at least 24 px; axe in light and dark', async () => {
    await page.viewport(1280, 800);
    await mount();
    await cell().click();
    await expect.element(box()).toBeVisible();
    const banner = page.getByRole('banner');
    for (const el of banner.element().querySelectorAll('button, a, input')) {
      const r = rect(el);
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
    await cell().click();
    await expect.element(box()).not.toBeInTheDocument();
    for (const s of ['light', 'dark'] as const) {
      await scheme(s);
      expect((await axe.run(banner.element())).violations).toEqual([]);
      await cell().click();
      await expect.element(box()).toBeVisible();
      expect((await axe.run(banner.element())).violations).toEqual([]);
      await cell().click();
      await expect.element(box()).not.toBeInTheDocument();
    }
  });
});
