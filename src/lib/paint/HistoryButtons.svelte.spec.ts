/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
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

  it('still offers Keyboard shortcuts after Undo and Redo on a fine pointer', async () => {
    render(HistoryButtons, { props: props() });
    const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await expect.element(shortcuts).toBeVisible();
    const undo = page.getByRole('button', { name: /^Undo/ }).element();
    const redo = page.getByRole('button', { name: /^Redo/ }).element();
    const sc = shortcuts.element();
    expect(undo.compareDocumentPosition(redo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(redo.compareDocumentPosition(sc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
