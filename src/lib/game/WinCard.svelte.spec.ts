/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { GameStore, openGame } from './store.svelte';
import { FakeSync } from './test/fake-sync.svelte';
import StoreHost from './test/StoreHost.svelte';

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

afterEach(async () => {
  await scheme('light');
});

const TITLE = 'Goal reached in Mar 2049';
const card = () => page.getByTestId('win-card');
const levelUp = () => page.getByRole('button', { name: 'Level up' });
const keep = () => page.getByRole('button', { name: 'Keep playing' });
const realStore = () =>
  new GameStore({
    storage: new MemoryStorage(),
    sync: new FakeSync(),
    now: () => new Date(2026, 10, 22)
  });

function mount(
  over: {
    unlocks?: string | null;
    onlevelup?: () => void;
    onkeep?: () => void;
    onescape?: () => void;
  } = {}
) {
  const { onescape, unlocks = 'Permitting', ...rest } = over;
  return render(StoreHost, {
    props: {
      store: realStore(),
      show: 'card',
      card: { title: TITLE, unlocks, onlevelup: () => {}, onkeep: () => {}, ...rest },
      onescape
    }
  });
}

describe('WinCard', () => {
  it('shows the title, the unlock line and both buttons', async () => {
    await mount();
    await expect.element(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect.element(page.getByText('Unlocks: Permitting')).toBeVisible();
    await expect.element(levelUp()).toBeVisible();
    await expect.element(keep()).toBeVisible();
  });

  it('Level up has focus on mount', async () => {
    await mount();
    await expect.element(levelUp()).toBeVisible();
    expect(document.activeElement).toBe(levelUp().element());
  });

  it('each button calls its callback once', async () => {
    const onlevelup = vi.fn();
    const onkeep = vi.fn();
    await mount({ onlevelup, onkeep });
    await levelUp().click();
    expect(onlevelup).toHaveBeenCalledTimes(1);
    expect(onkeep).not.toHaveBeenCalled();
    await keep().click();
    expect(onkeep).toHaveBeenCalledTimes(1);
    expect(onlevelup).toHaveBeenCalledTimes(1);
  });

  it('Escape inside calls onkeep and stops there', async () => {
    const onkeep = vi.fn();
    const onescape = vi.fn();
    await mount({ onkeep, onescape });
    await expect.element(levelUp()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(onkeep).toHaveBeenCalledTimes(1);
    expect(onescape).not.toHaveBeenCalled();
  });

  it('a complete round', async () => {
    await mount({ unlocks: null });
    await expect.element(page.getByText('Round complete')).toBeVisible();
    await expect.element(levelUp()).not.toBeInTheDocument();
    await expect.element(keep()).toBeVisible();
    expect(document.activeElement).toBe(keep().element());
  });

  it('a non-modal dialog named by its title', async () => {
    await mount();
    const dialog = page.getByRole('dialog', { name: TITLE });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().getAttribute('aria-modal')).toBe('false');
  });

  it('renders nothing under the open game', async () => {
    await render(StoreHost, {
      props: {
        store: openGame(),
        show: 'card',
        card: { title: TITLE, unlocks: 'Permitting', onlevelup: () => {}, onkeep: () => {} }
      }
    });
    await expect.element(card()).not.toBeInTheDocument();
  });

  it('every control is at least 24 px', async () => {
    await mount();
    for (const b of [levelUp(), keep()]) {
      const r = b.element().getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
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
