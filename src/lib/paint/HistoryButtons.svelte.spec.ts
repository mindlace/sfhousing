/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { SHORTCUTS } from '$lib/brush/shortcuts';
import HistoryButtons from './HistoryButtons.svelte';

const props = (over: Record<string, unknown> = {}) => ({
  canUndo: true,
  canRedo: true,
  undoLabel: 'Allowed 8 stories' as string | null,
  redoLabel: 'Erased custom zoning' as string | null,
  onundo: vi.fn(),
  onredo: vi.fn(),
  ...over
});

describe('HistoryButtons', () => {
  it('names the buttons by the change and calls the handlers', async () => {
    const p = props();
    render(HistoryButtons, { props: p });
    const undo = page.getByRole('button', { name: 'Undo: Allowed 8 stories' });
    const redo = page.getByRole('button', { name: 'Redo: Erased custom zoning' });
    await expect.element(undo).toHaveAttribute('title', 'Undo: Allowed 8 stories');
    await undo.click();
    await redo.click();
    expect(p.onundo).toHaveBeenCalledOnce();
    expect(p.onredo).toHaveBeenCalledOnce();
  });

  it('is unnamed and disabled when there is nothing to undo or redo', async () => {
    render(HistoryButtons, {
      props: props({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null })
    });
    await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  });

  const shortcuts = () => page.getByRole('button', { name: 'Keyboard shortcuts' });
  const table = () => page.getByRole('table', { name: 'Keyboard shortcuts' });
  const panel = () => document.querySelector<HTMLElement>('[data-testid=shortcuts]')!;
  const rect = (el: Element) => el.getBoundingClientRect();

  it('lists every shortcut in a popover named Keyboard shortcuts', async () => {
    render(HistoryButtons, { props: props() });
    await shortcuts().click();
    await expect.element(shortcuts()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(table()).toBeVisible();
    for (const s of SHORTCUTS) {
      await expect.element(page.getByText(s.keys, { exact: true })).toBeVisible();
    }
    expect(panel().matches(':popover-open')).toBe(true);
  });

  it('opens over a 288 px scroll box and moves nothing', async () => {
    const { container } = await render(HistoryButtons, { props: props() });
    container.style.width = '288px';
    container.style.height = '120px';
    container.style.overflow = 'auto';
    const els = () => [
      page.getByRole('button', { name: /^Undo/ }).element(),
      page.getByRole('button', { name: /^Redo/ }).element(),
      shortcuts().element()
    ];
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
    render(HistoryButtons, { props: props() });
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

  it('closes when the window is resized', async () => {
    render(HistoryButtons, { props: props() });
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    await page.viewport(900, 700);
    await expect.element(page.getByTestId('shortcuts')).not.toBeVisible();
  });

  it('in a short window the list scrolls inside itself', async () => {
    await page.viewport(1024, 200);
    render(HistoryButtons, { props: props() });
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    expect(panel().scrollHeight).toBeGreaterThan(panel().clientHeight);
    expect(rect(panel()).bottom).toBeLessThanOrEqual(200);
  });
});
