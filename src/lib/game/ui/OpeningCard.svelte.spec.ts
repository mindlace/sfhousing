/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { GameStore } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import OpeningHost from './test/OpeningHost.svelte';
import { OPENING_LINES, roomMet } from './words';

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

afterEach(async () => {
  await scheme('light');
});

const card = () => page.getByTestId('opening-card');
const start = () => page.getByTestId('opening-start');
const realStore = () =>
  new GameStore({
    storage: new MemoryStorage(),
    sync: new FakeSync(),
    now: () => new Date(2026, 10, 25)
  });

function mount(over: { onstart?: () => void; onescape?: () => void } = {}) {
  const { onescape, onstart = () => {} } = over;
  return render(OpeningHost, {
    props: { store: realStore(), card: { amount: 82069, onstart }, onescape }
  });
}

describe('OpeningCard', () => {
  it('shows the title and the two lines', async () => {
    await mount();
    await expect.element(page.getByRole('heading', { name: roomMet(82069) })).toBeVisible();
    for (const line of OPENING_LINES) {
      await expect.element(page.getByText(line)).toBeVisible();
    }
  });

  it('a non-modal dialog named by its title', async () => {
    await mount();
    const dialog = page.getByRole('dialog', { name: roomMet(82069) });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().getAttribute('aria-modal')).toBe('false');
  });

  it('Start has focus at mount and each press calls onstart', async () => {
    const onstart = vi.fn();
    await mount({ onstart });
    await expect.element(start()).toBeVisible();
    expect(document.activeElement).toBe(start().element());
    await start().click();
    await start().click();
    expect(onstart).toHaveBeenCalledTimes(2);
  });

  it('takes no Escape', async () => {
    const onstart = vi.fn();
    const onescape = vi.fn();
    await mount({ onstart, onescape });
    await expect.element(start()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(onescape).toHaveBeenCalledTimes(1);
    expect(onstart).not.toHaveBeenCalled();
  });

  it('the account offer is inside the card', async () => {
    await mount();
    await expect.element(card()).toBeVisible();
    expect(card().element().querySelector('[data-testid="account-offer"]')).not.toBeNull();
  });

  it('Start is at least 24 px', async () => {
    await mount();
    const r = start().element().getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(r.height).toBeGreaterThanOrEqual(24);
  });

  it('axe finds no violation in light and dark', async () => {
    await mount();
    await expect.element(card()).toBeVisible();
    for (const s of ['light', 'dark'] as const) {
      await scheme(s);
      expect((await axe.run(card().element())).violations).toEqual([]);
    }
  });
});
