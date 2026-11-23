/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import LevelCellHost from './test/LevelCellHost.svelte';
import { seededGame } from './test/seeded-game';

const cell = () => page.getByTestId('header-level');
const levelUp = () => page.getByTestId('header-level-up');
const panel = () => page.getByTestId('header-level-panel');
const menu = () => page.getByRole('button', { name: 'Menu' });
const offer = { on: 20000, datasetVersion: 'fixture-0' };
const rect = (el: Element) => el.getBoundingClientRect();

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

/**
 * Resizes the frame across lg and returns after the `(min-width: 1024px)` change event (a
 * listener added before the resize), then a Svelte tick, as MapKeyControl.svelte.spec.ts's
 * atViewport does for md.
 */
async function acrossLg(width: number, height: number): Promise<void> {
  const mq = matchMedia('(min-width: 1024px)');
  expect(mq.matches).not.toBe(width >= 1024);
  const changed = new Promise((res) => mq.addEventListener('change', res, { once: true }));
  await page.viewport(width, height);
  await changed;
  await tick();
  expect(mq.matches).toBe(width >= 1024);
}

/** The Menu's panel (the element the Menu button controls). */
const menuPanel = () =>
  document.getElementById(
    document.querySelector('[data-header-menu]')!.getAttribute('aria-controls')!
  )!;

afterEach(async () => {
  await scheme('light');
});

describe('LevelCell', () => {
  it('reads "Level 3"; with level 5 banked, "Round complete"', async () => {
    await page.viewport(1280, 800);
    const a = seededGame({ level: 3 });
    const first = await render(LevelCellHost, { game: a.game, routeId: '/sim' });
    await expect.element(cell()).toHaveTextContent('Level 3');
    await first.unmount();
    const b = seededGame({ level: 5, roundComplete: true });
    render(LevelCellHost, { game: b.game, routeId: '/sim' });
    await expect.element(cell()).toHaveTextContent('Round complete');
    b.game.setOffer(offer);
    await tick();
    expect(levelUp().elements()).toHaveLength(0);
  });

  it('"Level up" shows only while an offer is set; pressing it raises the level and focuses the cell', async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await expect.element(cell()).toHaveTextContent('Level 3');
    expect(levelUp().elements()).toHaveLength(0);
    game.setOffer(offer);
    await levelUp().click();
    expect(game.progress.level).toBe(4);
    await expect.element(cell()).toHaveTextContent('Level 4');
    await expect.element(cell()).toHaveFocus();
    expect(levelUp().elements()).toHaveLength(0);
  });

  it('from lg it sits after the steps and before the status', async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3 });
    const status = createRawSnippet(() => ({
      render: () => '<span data-testid="st">Saved</span>'
    }));
    render(LevelCellHost, { game, routeId: '/sim', status });
    await expect.element(cell()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Steps' }).element();
    const st = page.getByTestId('st').element();
    expect(rect(nav).right).toBeLessThanOrEqual(rect(cell().element()).left);
    expect(rect(cell().element()).right).toBeLessThanOrEqual(rect(st).left);
    game.setOffer(offer);
    await expect.element(levelUp()).toBeVisible();
    expect(rect(cell().element()).right).toBeLessThanOrEqual(rect(levelUp().element()).left);
    expect(rect(levelUp().element()).right).toBeLessThanOrEqual(rect(st).left);
    expect(rect(page.getByRole('banner').element()).height).toBe(48);
  });

  it('the button opens the panel; Escape closes it and focuses the button; a press outside closes it', async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await cell().click();
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(panel()).toBeVisible();
    expect(cell().element().getAttribute('aria-controls')).toBe(panel().element().id);
    expect(panel().element().querySelector('[data-testid="level-panel"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(cell()).toHaveFocus();
    await cell().click();
    await expect.element(panel()).toBeVisible();
    // Right of the pop-over, which covers the area's left part.
    await page.getByTestId('outside').click({ position: { x: 1200, y: 200 } });
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(panel()).not.toBeInTheDocument();
  });

  it("from lg the panel sits under the header at the cell's left edge, 20 rem wide, inside the viewport", async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3, saves: 12 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await cell().click();
    await expect.element(panel()).toBeVisible();
    const banner = rect(page.getByRole('banner').element());
    const p = rect(panel().element());
    expect(p.top).toBeGreaterThanOrEqual(banner.bottom);
    expect(Math.abs(p.left - rect(cell().element()).left)).toBeLessThan(1);
    expect(p.width).toBe(320);
    await cell().click();
    await expect.element(panel()).not.toBeInTheDocument();

    await page.viewport(1280, 500);
    await cell().click();
    await expect.element(panel()).toBeVisible();
    const el = panel().element() as HTMLElement;
    const q = rect(el);
    // At most the viewport's height less 4 rem, under the header's 48 px and the 4 px gap.
    expect(q.height).toBeLessThanOrEqual(500 - 64);
    expect(q.bottom).toBeLessThanOrEqual(500 - 12);
    expect(getComputedStyle(el).overflowY).toBe('auto');
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
  });

  it('another header overlay opening closes the panel', async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await cell().click();
    await expect.element(panel()).toBeVisible();
    window.dispatchEvent(new CustomEvent('sfh-header-overlay-open', { detail: 'other' }));
    await expect.element(cell()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(panel()).not.toBeInTheDocument();
  });

  it('below lg the cell is in the Menu after the steps; a press inside the panel keeps the Menu open', async () => {
    await page.viewport(375, 812);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await menu().click();
    await expect.element(cell()).toBeVisible();
    expect(menuPanel().contains(cell().element())).toBe(true);
    const nav = page.getByRole('navigation', { name: 'Steps' }).element();
    expect(nav.compareDocumentPosition(cell().element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    await cell().click();
    await expect.element(panel()).toBeVisible();
    await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
    // In place: under the cell, inside the Menu.
    expect(menuPanel().contains(panel().element())).toBe(true);
    expect(rect(panel().element()).top).toBeGreaterThanOrEqual(rect(cell().element()).bottom);
    await page.getByRole('button', { name: 'Rename Seeded game' }).click();
    await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
  });

  it('below lg the Menu is named "Menu, level up ready" with a dot while an offer is set', async () => {
    await page.viewport(375, 812);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await expect.element(menu()).toHaveAttribute('aria-label', 'Menu');
    expect(menu().element().querySelector('[data-level-dot]')).toBeNull();
    game.setOffer(offer);
    const ready = page.getByRole('button', { name: 'Menu, level up ready' });
    await expect.element(ready).toBeVisible();
    const dot = ready.element().querySelector('[data-level-dot]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('aria-hidden')).toBe('true');
    game.setOffer(null);
    await expect.element(menu()).toHaveAttribute('aria-label', 'Menu');
    expect(menu().element().querySelector('[data-level-dot]')).toBeNull();
  });

  it('below lg, Level up and Escape inside the Menu keep the Menu', async () => {
    await page.viewport(375, 812);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    game.setOffer(offer);
    await menu().click();
    await expect.element(levelUp()).toBeVisible();
    await levelUp().click();
    expect(game.progress.level).toBe(4);
    await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(cell()).toHaveFocus();
    await cell().click();
    await expect.element(panel()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(panel()).not.toBeInTheDocument();
    await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(cell()).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
  });

  it('crossing lg leaves one cell, closed', async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    await cell().click();
    await expect.element(panel()).toBeVisible();
    await acrossLg(768, 800);
    // The cell has moved into the Menu.
    await expect.poll(() => menuPanel().contains(cell().element())).toBe(true);
    expect(document.querySelectorAll('[data-testid="header-level"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="header-level-panel"]')).toHaveLength(0);
    expect(cell().element().getAttribute('aria-expanded')).toBe('false');
    await acrossLg(1280, 800);
    await expect.poll(() => menuPanel().contains(cell().element())).toBe(false);
    expect(document.querySelectorAll('[data-testid="header-level"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="header-level-panel"]')).toHaveLength(0);
    await expect.element(cell()).toBeVisible();
  });

  it('the cell and the open panel pass axe in light and dark', async () => {
    await page.viewport(1280, 800);
    const { game } = seededGame({ level: 3 });
    render(LevelCellHost, { game, routeId: '/sim' });
    game.setOffer(offer);
    await expect.element(levelUp()).toBeVisible();
    const banner = page.getByRole('banner');
    for (const s of ['light', 'dark'] as const) {
      await scheme(s);
      expect((await axe.run(banner.element())).violations).toEqual([]);
      await cell().click();
      await expect.element(panel()).toBeVisible();
      expect((await axe.run(banner.element())).violations).toEqual([]);
      await cell().click();
      await expect.element(panel()).not.toBeInTheDocument();
    }
  });
});
