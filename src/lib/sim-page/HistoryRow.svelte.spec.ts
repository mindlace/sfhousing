/// <reference types="@vitest/browser-playwright" />
// Undo and Redo named by the change they would undo or redo.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import HistoryRow from './HistoryRow.svelte';
import { DEFAULT_POLICY } from './policy';
import { PolicyStore } from './policy-store.svelte';

describe('HistoryRow', () => {
  it('both are disabled with no history and unnamed', async () => {
    const store = new PolicyStore(DEFAULT_POLICY);
    render(HistoryRow, { props: { store, onundo: () => {}, onredo: () => {} } });
    await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  });

  it('names Undo and Redo by the change and calls the handlers', async () => {
    const store = new PolicyStore(DEFAULT_POLICY);
    store.apply(
      (p) => ({
        ...p,
        custom: [
          {
            id: 'b1',
            kind: 'paint',
            strokes: [{ path: [[-122.4, 37.7]], radiusM: 30 }],
            stories: 8
          }
        ]
      }),
      'Allowed 8 stories'
    );
    const onundo = vi.fn(() => store.undo());
    const onredo = vi.fn(() => store.redo());
    render(HistoryRow, { props: { store, onundo, onredo } });
    const undo = page.getByRole('button', { name: 'Undo: Allowed 8 stories' });
    await expect.element(undo).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    await undo.click();
    expect(onundo).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole('button', { name: 'Redo: Allowed 8 stories' }))
      .toBeEnabled();
    await page.getByRole('button', { name: 'Redo: Allowed 8 stories' }).click();
    expect(onredo).toHaveBeenCalledOnce();
  });
});
