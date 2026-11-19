/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { SHORTCUTS } from '$lib/brush/shortcuts';
import ShortcutsButton from './ShortcutsButton.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShortcutsButton', () => {
  it('renders nothing on a coarse pointer', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('(pointer: coarse)'),
      media: q,
      addEventListener() {},
      removeEventListener() {}
    }));
    render(ShortcutsButton);
    await expect
      .element(page.getByRole('button', { name: 'Keyboard shortcuts' }))
      .not.toBeInTheDocument();
    expect(document.querySelector('[data-testid=shortcuts]')).toBeNull();
  });

  const shortcuts = () => page.getByRole('button', { name: 'Keyboard shortcuts' });
  const table = () => page.getByRole('table', { name: 'Keyboard shortcuts' });
  const panel = () => document.querySelector<HTMLElement>('[data-testid=shortcuts]')!;
  const rect = (el: Element) => el.getBoundingClientRect();

  it('lists every shortcut in a popover named Keyboard shortcuts', async () => {
    render(ShortcutsButton);
    await shortcuts().click();
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(table()).toBeVisible();
    for (const s of SHORTCUTS) {
      await expect.element(page.getByText(s.keys, { exact: true })).toBeVisible();
    }
    expect(panel().matches(':popover-open')).toBe(true);
  });

  it('opens over a 288 px scroll box and moves nothing', async () => {
    const { container } = await render(ShortcutsButton);
    container.style.width = '288px';
    container.style.height = '120px';
    container.style.overflow = 'auto';
    const els = () => [shortcuts().element()];
    const before = els().map((e) => rect(e));
    const sw = container.scrollWidth;
    const sh = container.scrollHeight;
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    els().forEach((e, i) => {
      const r = rect(e);
      for (const k of ['left', 'top', 'width', 'height'] as const)
        expect(Math.abs(r[k] - before[i][k]), `${i} ${k}`).toBeLessThanOrEqual(0.5);
    });
    expect(container.scrollWidth).toBe(sw);
    expect(container.scrollHeight).toBe(sh);
    const t = rect(panel());
    expect(t.left).toBeGreaterThanOrEqual(0);
    expect(t.right).toBeLessThanOrEqual(window.innerWidth);
    expect(t.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(t.top).toBeGreaterThanOrEqual(rect(shortcuts().element()).bottom);
  });

  it('closes on Escape and on a second press; focus stays on the control', async () => {
    render(ShortcutsButton);
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(page.getByTestId('shortcuts')).not.toBeVisible();
    await expect.element(shortcuts()).toHaveFocus();
    await shortcuts().click();
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'true');
    await shortcuts().click();
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'false');
  });

  it('at 375 px, last in a tab 16 px in, the list is on screen and focus returns on close', async () => {
    await page.viewport(375, 700);
    const { container } = await render(ShortcutsButton);
    container.style.display = 'flex';
    container.style.marginTop = '300px';
    container.style.marginLeft = '8px';
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    const t = rect(panel());
    expect(t.left).toBeGreaterThanOrEqual(0);
    expect(t.right).toBeLessThanOrEqual(375);
    expect(t.bottom).toBeLessThanOrEqual(700);
    await userEvent.keyboard('{Escape}');
    await expect.element(shortcuts()).toHaveFocus();
  });

  it('closes when the window is resized', async () => {
    render(ShortcutsButton);
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    await page.viewport(900, 700);
    await expect.element(page.getByTestId('shortcuts')).not.toBeVisible();
  });

  it('in a short window the list scrolls inside itself', async () => {
    await page.viewport(1024, 200);
    render(ShortcutsButton);
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    expect(panel().scrollHeight).toBeGreaterThan(panel().clientHeight);
    expect(rect(panel()).bottom).toBeLessThanOrEqual(200);
    // Scrolling inside the list leaves it open.
    const scrolled = new Promise<void>((done) =>
      panel().addEventListener('scroll', () => done(), { once: true })
    );
    panel().scrollTop = 20;
    await scrolled;
    expect(panel().scrollTop).toBeGreaterThan(0);
    expect(panel().matches(':popover-open')).toBe(true);
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes when the box around it scrolls', async () => {
    await page.viewport(1024, 700);
    const { container } = await render(ShortcutsButton);
    container.style.height = '40px';
    container.style.overflow = 'auto';
    const spacer = document.createElement('div');
    spacer.style.height = '400px';
    container.appendChild(spacer);
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    container.scrollTop = 30;
    await expect.element(page.getByTestId('shortcuts')).not.toBeVisible();
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'false');
  });
});
