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

describe('header pinned slot', () => {
  it('shows the pinned snippet while the child is mounted and clears it on unmount', async () => {
    const { rerender } = await render(Host, { pinnedA: 'Score A' });
    await expect
      .element(page.getByTestId('pinned').getByRole('button', { name: 'Score A' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByTestId('slot').getByRole('button', { name: 'A' }))
      .toBeInTheDocument();
    await rerender({ showA: false });
    await expect.element(page.getByTestId('pinned')).toBeEmptyDOMElement();
  });

  it('a page without a pinned snippet replaces the previous one', async () => {
    const { rerender } = await render(Host, { pinnedA: 'Score A' });
    await rerender({ showA: true, showB: true, pinnedA: 'Score A' });
    await expect.element(page.getByTestId('pinned')).toBeEmptyDOMElement();
    await rerender({ showA: false, showB: true, pinnedA: 'Score A' });
    await expect.element(page.getByTestId('pinned')).toBeEmptyDOMElement();
    await expect.element(page.getByRole('button', { name: 'B' })).toBeInTheDocument();
  });
});

describe('header status slot', () => {
  it('shows the status snippet while the child is mounted and clears it on unmount', async () => {
    const { rerender } = await render(Host, { statusA: 'Saved' });
    await expect.element(page.getByTestId('status').getByText('Saved')).toBeInTheDocument();
    await expect.element(page.getByTestId('pinned')).toBeEmptyDOMElement();
    await rerender({ showA: false, statusA: 'Saved' });
    await expect.element(page.getByTestId('status')).toBeEmptyDOMElement();
  });

  it('a page without a status snippet replaces the previous one', async () => {
    const { rerender } = await render(Host, { statusA: 'Saved' });
    await rerender({ showA: true, showB: true, statusA: 'Saved' });
    await expect.element(page.getByTestId('status')).toBeEmptyDOMElement();
    await rerender({ showA: false, showB: true, statusA: 'Saved' });
    await expect.element(page.getByTestId('status')).toBeEmptyDOMElement();
  });
});
