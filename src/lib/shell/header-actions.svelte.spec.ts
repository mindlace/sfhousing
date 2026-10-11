import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Host from './test/Host.svelte';

describe('header actions slot', () => {
  it('shows the snippet while the child is mounted and clears it on unmount', async () => {
    const { rerender } = await render(Host);
    await expect.element(page.getByRole('button', { name: 'A' })).toBeInTheDocument();
    await rerender({ showA: false });
    await expect.element(page.getByTestId('slot')).toBeEmptyDOMElement();
  });

  it('keeps a replacing snippet when the first child unmounts', async () => {
    const { rerender } = await render(Host);
    await rerender({ showA: true, showB: true });
    await expect.element(page.getByRole('button', { name: 'B' })).toBeInTheDocument();
    await rerender({ showA: false, showB: true });
    await expect.element(page.getByRole('button', { name: 'B' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'A' })).not.toBeInTheDocument();
  });
});
