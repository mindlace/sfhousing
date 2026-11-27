/// <reference types="@vitest/browser-playwright" />
// The explainers: one modal dialog per new policy, Accept goes to the next.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import type { GiftItem } from '../round-panel';
import GiftDialog from './GiftDialog.svelte';

const ITEMS: GiftItem[] = [
  { title: 'Alpha', line: 'The first line.', rules: '75 ft within 402 m.' },
  { title: 'Beta', line: 'The second line.', rules: '' },
  { title: 'Gamma', line: 'The third line.', rules: '' }
];

afterEach(async () => {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });
});

const dialog = () => page.getByTestId('gift-dialog');
const accept = () => page.getByTestId('gift-accept');
const step = () => page.getByTestId('gift-step');
const title = () => page.getByRole('heading', { level: 2 });

async function mount(items: GiftItem[] = ITEMS) {
  const onclose = vi.fn();
  const r = await render(GiftDialog, { props: { items, onclose } });
  await expect.element(dialog()).toBeVisible();
  return { onclose, r };
}

describe('GiftDialog', () => {
  it('opens as a modal dialog named by the first title, with its step, line and rules', async () => {
    await mount();
    expect(dialog().element().matches(':modal')).toBe(true);
    await expect.element(page.getByRole('dialog', { name: 'Alpha' })).toBeVisible();
    await expect.element(title()).toHaveTextContent('Alpha');
    await expect.element(step()).toHaveTextContent('1 of 3');
    await expect.element(page.getByText('The first line.')).toBeVisible();
    await expect.element(page.getByText('75 ft within 402 m.')).toBeVisible();
    await expect.element(accept()).toHaveTextContent('Accept');
  });

  it('focuses Accept and holds focus there, Tab and Shift+Tab included', async () => {
    await mount();
    await expect.element(accept()).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect.element(accept()).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(accept()).toHaveFocus();
  });

  it('Accept shows the next in order; after the last it closes and calls onclose once', async () => {
    const { onclose } = await mount();
    await accept().click();
    await expect.element(title()).toHaveTextContent('Beta');
    await expect.element(step()).toHaveTextContent('2 of 3');
    expect(document.querySelector('[data-testid=gift-rules]')).toBeNull();
    await expect.element(accept()).toHaveFocus();
    expect(onclose).not.toHaveBeenCalled();
    await accept().click();
    await expect.element(title()).toHaveTextContent('Gamma');
    await expect.element(step()).toHaveTextContent('3 of 3');
    await accept().click();
    expect(dialog().element().hasAttribute('open')).toBe(false);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('Escape acts as Accept: it goes to the next, and after the last it closes', async () => {
    const { onclose } = await mount(ITEMS.slice(0, 2));
    await userEvent.keyboard('{Escape}');
    await expect.element(title()).toHaveTextContent('Beta');
    expect(dialog().element().hasAttribute('open')).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(dialog().element().hasAttribute('open')).toBe(false);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('one policy reads 1 of 1', async () => {
    await mount([
      { title: 'Every policy', line: 'Every lever is yours to add and edit.', rules: '' }
    ]);
    await expect.element(step()).toHaveTextContent('1 of 1');
  });

  it('passes axe in light and dark', async () => {
    await mount();
    for (const value of ['light', 'dark'] as const) {
      await cdp().send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value }]
      });
      expect((await axe.run(dialog().element())).violations).toEqual([]);
    }
  });

  it('Accept is a target of at least 24 px', async () => {
    await mount();
    const box = accept().element().getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });
});
