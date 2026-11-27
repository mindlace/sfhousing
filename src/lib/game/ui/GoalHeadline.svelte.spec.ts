// The pinned goal, interim: the round's words and a bar.
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { PENDING } from '../rounds';
import { GameStore, openGame } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import type GoalHeadline from './GoalHeadline.svelte';
import { pinnedWords } from './round-words';
import HeadlineHost from './test/HeadlineHost.svelte';

afterEach(async () => {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });
});

type Props = ComponentProps<typeof GoalHeadline>;

const WORDS = pinnedWords(PENDING, {
  amount: 82_069,
  target: dayFromUtc(2055, 12, 1),
  legal: dayFromUtc(2066, 9, 30),
  round: 2,
  finished: false,
  next: 3
});

const realStore = () =>
  new GameStore({
    storage: new MemoryStorage(),
    sync: new FakeSync(),
    now: () => new Date(2026, 10, 25)
  });

const props = (over: Partial<Props> = {}): Props => ({ words: WORDS, fill: 0.4, ...over });

function mount(over: Partial<Props> = {}) {
  return render(HeadlineHost, { props: { store: realStore(), headline: props(over) } });
}

const box = () => page.getByTestId('goal-box');

describe('GoalHeadline', () => {
  it('renders line 1, line 2 and a bar filled to fill', async () => {
    await page.viewport(1280, 800);
    await mount();
    await expect.element(page.getByTestId('goal-line1')).toHaveTextContent(WORDS.line1);
    await expect.element(page.getByTestId('goal-line2')).toHaveTextContent(WORDS.line2);
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '40');
  });

  it('clamps the bar to 0..1', async () => {
    await page.viewport(1280, 800);
    const r = await mount({ fill: 1.7 });
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '100');
    await r.rerender({ headline: props({ fill: -1 }) });
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '0');
  });

  it('has no side goals', async () => {
    await page.viewport(1280, 800);
    await mount();
    await expect.element(box()).toBeVisible();
    expect(document.querySelector('[data-testid="side-goals"]')).toBeNull();
    expect(document.querySelector('[data-testid="side-goal"]')).toBeNull();
    expect(document.querySelector('[data-testid="goal-headline-button"]')).toBeNull();
  });

  it('renders nothing for the open game', async () => {
    await page.viewport(1280, 800);
    await render(HeadlineHost, { props: { store: openGame(), headline: props() } });
    await expect.element(page.getByTestId('outside')).toBeInTheDocument();
    await expect.element(box()).not.toBeInTheDocument();
  });

  it('the box is at most 44 px tall at 1280 px', async () => {
    await page.viewport(1280, 800);
    await mount();
    await expect.element(page.getByTestId('goal-line2')).toBeVisible();
    expect(box().element().getBoundingClientRect().height).toBeLessThanOrEqual(44);
  });

  it('axe finds no violation in light and dark', async () => {
    await page.viewport(1280, 800);
    await mount();
    await expect.element(box()).toBeVisible();
    for (const s of ['light', 'dark'] as const) {
      await cdp().send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: s }]
      });
      expect((await axe.run(page.getByRole('banner').element())).violations).toEqual([]);
    }
  });
});
