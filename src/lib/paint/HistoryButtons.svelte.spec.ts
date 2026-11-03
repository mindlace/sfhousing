/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
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

  it('lists the keyboard shortcuts in a disclosure', async () => {
    render(HistoryButtons, { props: props() });
    await page.getByText('Keyboard shortcuts', { exact: true }).click();
    for (const s of SHORTCUTS) {
      await expect.element(page.getByText(s.keys, { exact: true })).toBeVisible();
    }
  });

  it('names the shortcuts table, and opened in the 288 px dock it takes the full width below the buttons', async () => {
    const { container } = await render(HistoryButtons, { props: props() });
    container.style.width = '288px';
    await page.getByText('Keyboard shortcuts', { exact: true }).click();
    const table = page.getByRole('table', { name: 'Keyboard shortcuts' });
    await expect.element(table).toBeVisible();
    const t = table.element().getBoundingClientRect();
    const undo = page.getByRole('button', { name: /^Undo/ }).element().getBoundingClientRect();
    expect(t.width).toBeGreaterThanOrEqual(280);
    expect(t.top).toBeGreaterThanOrEqual(undo.bottom);
  });
});
