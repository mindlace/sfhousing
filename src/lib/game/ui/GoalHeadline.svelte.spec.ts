/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushSync, type ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { GameStore, openGame } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import type GoalHeadline from './GoalHeadline.svelte';
import { MET_MS, ROLL_MS } from './motion';
import HeadlineHost from './test/HeadlineHost.svelte';
import { sideEntry, sideGoal } from './test/fixtures';
import {
  GOAL_MET,
  HOMES_WORD,
  LAST_GOAL,
  MET,
  NO_SIDE_GOALS,
  goalLine,
  goalMetLive,
  priceText,
  progressText,
  sideMetLive,
  sideMetText,
  unitsName,
  unlocksText
} from './words';

/** Both media features at once: each Emulation.setEmulatedMedia call replaces the last. */
async function emulate(scheme: 'light' | 'dark', motion: 'reduce' | 'no-preference' = 'reduce') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: motion }
    ]
  });
}

// Svelte runs every tween on one shared frame loop. A tween left pending on real frames (a hidden
// page pauses them) or on faked ones (gone once real timers return) stalls every later roll, so
// no test starts with motion on and every faked frame runs out before the clock is restored.
beforeAll(() => emulate('light', 'reduce'));

afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runAllTimersAsync();
  vi.useRealTimers();
  await emulate('light', 'reduce');
});

type Props = ComponentProps<typeof GoalHeadline>;

const DEADLINE = 'Dec 2055';
const UNLOCKS = 'Height near transit';
const realStore = () =>
  new GameStore({
    storage: new MemoryStorage(),
    sync: new FakeSync(),
    now: () => new Date(2026, 10, 25)
  });

const props = (over: Partial<Props> = {}): Props => ({
  homes: 40_000,
  amount: 80_000,
  deadline: DEADLINE,
  unlocks: UNLOCKS,
  met: false,
  side: [],
  ...over
});

function mount(over: Partial<Props> = {}, onescape?: () => void) {
  return render(HeadlineHost, { props: { store: realStore(), headline: props(over), onescape } });
}

const box = () => page.getByTestId('goal-box');
const button = () => page.getByTestId('goal-headline-button');
const line2 = () => page.getByTestId('goal-line2');
const pop = () => page.getByTestId('side-goals');
const el = (testid: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testid}"]`) as HTMLElement;
/** Line 1 as drawn (the rolling count); the button's sr-only copy carries the true count. */
const shown = () => el('goal-headline-button').querySelector('[aria-hidden="true"]')?.textContent;
const named = () => el('goal-headline-button').querySelector('.sr-only')?.textContent;

const towers = sideGoal('towers', 'Ten towers', 500);
const added = sideGoal('added', '1,000 homes added', 300);

describe('GoalHeadline', () => {
  it('line 1 with homes and with null', async () => {
    await page.viewport(1280, 800);
    const a = await mount();
    await expect.element(button()).toHaveAccessibleName(goalLine(40_000, 80_000, DEADLINE));
    expect(shown()).toBe(goalLine(40_000, 80_000, DEADLINE));
    await a.unmount();
    await mount({ homes: null });
    await expect.element(button()).toHaveAccessibleName(goalLine(null, 80_000, DEADLINE));
    expect(shown()).toBe(goalLine(null, 80_000, DEADLINE));
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '0');
  });

  it('below sm the word homes is hidden and the name is unchanged', async () => {
    await page.viewport(375, 812);
    await mount();
    await expect.element(button()).toHaveAccessibleName(goalLine(40_000, 80_000, DEADLINE));
    const word = el('goal-headline-button').querySelector('[aria-hidden="true"] > span');
    expect(word?.textContent).toBe(HOMES_WORD);
    // Visually hidden: clipped to at most a pixel.
    const r = word!.getBoundingClientRect();
    expect(r.width).toBeLessThanOrEqual(1);
    const drawn = el('goal-headline-button').querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(drawn.offsetWidth).toBeGreaterThan(0);
    await page.viewport(1280, 800);
    await expect.poll(() => word!.getBoundingClientRect().width).toBeGreaterThan(1);
  });

  it('line 2 for unlocks, met and the last goal, with the side count', async () => {
    await page.viewport(1280, 800);
    const cases: [Partial<Props>, string][] = [
      [{}, unlocksText(UNLOCKS)],
      [{ met: true }, GOAL_MET],
      [{ unlocks: null }, LAST_GOAL],
      [
        { side: [sideEntry(towers, 10, 10), sideEntry(added, 600, 1000)] },
        `${unlocksText(UNLOCKS)} · ${sideMetText(1)}`
      ]
    ];
    for (const [over, text] of cases) {
      const r = await mount(over);
      await expect.element(line2()).toHaveTextContent(text, { normalizeWhitespace: true });
      expect(line2().element().textContent?.trim()).toBe(text);
      await expect.element(button()).toHaveAccessibleDescription(text);
      await r.unmount();
    }
  });

  it('line 2 is hidden below sm, its description whole', async () => {
    await page.viewport(375, 812);
    await mount({ side: [sideEntry(towers, 10, 10)] });
    await expect.element(button()).toBeVisible();
    await expect.element(line2()).not.toBeVisible();
    await expect
      .element(button())
      .toHaveAccessibleDescription(`${unlocksText(UNLOCKS)} · ${sideMetText(1)}`);
  });

  it('the bar and the side mark', async () => {
    await page.viewport(1280, 800);
    const half = await mount();
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '50');
    await expect.element(page.getByTestId('goal-side-mark')).not.toBeInTheDocument();
    await half.unmount();
    const over = await mount({ homes: 90_000, side: [sideEntry(added, 600, 1000)] });
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '100');
    await expect.element(page.getByTestId('goal-side-mark')).not.toBeInTheDocument();
    await over.rerender({ headline: props({ side: [sideEntry(added, 1000, 1000)] }) });
    await expect.element(page.getByTestId('goal-side-mark')).toBeInTheDocument();
    await over.rerender({ headline: props({ side: [sideEntry(added, 1000, 1000, false)] }) });
    await expect.element(page.getByTestId('goal-side-mark')).not.toBeInTheDocument();
  });

  it('the pop-over opens and closes', async () => {
    await page.viewport(1280, 800);
    const announced: string[] = [];
    const onopen = (e: Event) => announced.push((e as CustomEvent<string>).detail);
    window.addEventListener('sfh-header-overlay-open', onopen);
    try {
      await mount({ side: [sideEntry(added, 600, 1000)] });
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
      // By the button.
      await button().click();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'true');
      await expect.element(pop()).toBeVisible();
      expect(button().element().getAttribute('aria-controls')).toBe(pop().element().id);
      expect(document.activeElement).toBe(button().element());
      expect(announced).toEqual(['goal-side']);
      await button().click();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(pop()).not.toBeInTheDocument();

      // Escape closes it and focuses the button.
      await button().click();
      await expect.element(pop()).toBeVisible();
      (document.activeElement as HTMLElement).blur();
      await userEvent.keyboard('{Escape}');
      await expect.element(pop()).not.toBeInTheDocument();
      await expect.element(button()).toHaveFocus();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');

      // An Escape already handled leaves it open.
      await button().click();
      await expect.element(pop()).toBeVisible();
      const handled = (e: KeyboardEvent) => e.preventDefault();
      window.addEventListener('keydown', handled, { capture: true });
      try {
        await userEvent.keyboard('{Escape}');
      } finally {
        window.removeEventListener('keydown', handled, { capture: true });
      }
      await expect.element(pop()).toBeVisible();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'true');

      // A press outside closes it; left of the pop-over, which sits under the box.
      await page.getByTestId('outside').click({ position: { x: 40, y: 100 } });
      await expect.element(pop()).not.toBeInTheDocument();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');

      // A press inside the pop-over keeps it open.
      await button().click();
      await expect.element(pop()).toBeVisible();
      await pop().click();
      await expect.element(pop()).toBeVisible();

      // Another header overlay opening closes it.
      window.dispatchEvent(new CustomEvent('sfh-header-overlay-open', { detail: 'other' }));
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(pop()).not.toBeInTheDocument();
    } finally {
      window.removeEventListener('sfh-header-overlay-open', onopen);
    }
  });

  for (const [w, h] of [
    [375, 812],
    [1280, 800]
  ] as const)
    it(`the pop-over lies inside the viewport at ${w} px`, async () => {
      await page.viewport(w, h);
      await mount({ side: [sideEntry(added, 600, 1000), sideEntry(towers, 3, 10)] });
      await button().click();
      await expect.element(pop()).toBeVisible();
      const r = pop().element().getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(innerWidth);
      const header = page.getByRole('banner').element().getBoundingClientRect();
      expect(r.top).toBeGreaterThanOrEqual(header.bottom);
    });

  it('each side entry', async () => {
    await page.viewport(1280, 800);
    const r = await mount({ side: [sideEntry(added, 600, 1000), sideEntry(towers, 10, 10)] });
    await button().click();
    await expect.element(pop()).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Side goals' })).toBeVisible();
    const entries = page.getByTestId('side-goal');
    await expect.poll(() => entries.all().length).toBe(2);
    const [a, b] = entries.elements();
    expect(a.getAttribute('data-goal')).toBe('added');
    expect(a.hasAttribute('data-met')).toBe(false);
    expect(a.textContent).toContain('1,000 homes added');
    expect(a.textContent).toContain(progressText(600, 1000));
    expect(a.textContent).toContain(priceText(300));
    expect(a.querySelector('.sr-only')?.textContent).toBe(unitsName(300));
    expect(a.querySelector('[data-fill]')?.getAttribute('data-fill')).toBe('60');
    expect(a.textContent).not.toContain(MET);
    expect(b.getAttribute('data-goal')).toBe('towers');
    expect(b.hasAttribute('data-met')).toBe(true);
    expect(b.textContent).toContain(MET);
    expect(b.querySelector('.sr-only')?.textContent).toBe(unitsName(500));
    expect(b.querySelector('[data-fill]')?.getAttribute('data-fill')).toBe('100');
    await r.unmount();

    await mount({ side: [] });
    await button().click();
    await expect.element(pop()).toHaveTextContent(NO_SIDE_GOALS);
    expect(pop().element().querySelector('ul')).toBeNull();
  });

  it('the live region speaks a goal met and a side goal met after mount, and nothing at mount', async () => {
    await page.viewport(1280, 800);
    const live = page.getByTestId('goal-live');
    const at = await mount({ met: true, side: [sideEntry(towers, 10, 10)] });
    await expect.element(box()).toBeVisible();
    expect(live.element().textContent).toBe('');
    await at.unmount();

    const side = [sideEntry(towers, 3, 10), sideEntry(added, 600, 1000)];
    const r = await mount({ side });
    await expect.element(box()).toBeVisible();
    expect(live.element().textContent).toBe('');
    await r.rerender({ headline: props({ met: true, side }) });
    await expect.element(live).toHaveTextContent(goalMetLive(80_000, DEADLINE));
    await r.rerender({
      headline: props({
        met: true,
        side: [sideEntry(towers, 10, 10), sideEntry(added, 1000, 1000)]
      })
    });
    await expect
      .element(live)
      .toHaveTextContent(`${sideMetLive('Ten towers')} · ${sideMetLive('1,000 homes added')}`);
    expect(live.element().getAttribute('aria-live')).toBe('polite');
  });

  // Fake setTimeout before the render: the flash's timer starts on the rerender. No
  // expect.element while faked: its retries wait on timers.
  it('data-flash lasts MET_MS', async () => {
    await page.viewport(1280, 800);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = await mount();
    flushSync();
    expect(el('goal-box').hasAttribute('data-flash')).toBe(false);
    await r.rerender({ headline: props({ met: true }) });
    flushSync();
    expect(el('goal-box').hasAttribute('data-flash')).toBe(true);
    expect(el('goal-box').hasAttribute('data-met')).toBe(true);
    await vi.advanceTimersByTimeAsync(MET_MS - 1);
    flushSync();
    expect(el('goal-box').hasAttribute('data-flash')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    flushSync();
    expect(el('goal-box').hasAttribute('data-flash')).toBe(false);
  });

  it('with reduced motion the flash does not animate', async () => {
    await page.viewport(1280, 800);
    const still = await mount();
    await expect.element(box()).toBeVisible();
    await still.rerender({ headline: props({ met: true }) });
    await expect.element(box()).toHaveAttribute('data-flash');
    expect(getComputedStyle(box().element()).animationName).toBe('none');
    expect(getComputedStyle(box().element()).outlineStyle).toBe('solid');
    await still.unmount();

    await emulate('light', 'no-preference');
    const moving = await mount();
    await expect.element(box()).toBeVisible();
    await moving.rerender({ headline: props({ met: true }) });
    await expect.element(box()).toHaveAttribute('data-flash');
    expect(getComputedStyle(box().element()).animationName).toContain('goal-met');
  });

  it('the count rolls, and jumps with reduced motion', async () => {
    await page.viewport(1280, 800);
    // Reduced motion (the default context): the new count at once.
    const jump = await mount();
    await expect.element(box()).toBeVisible();
    await jump.rerender({ headline: props({ homes: 44_000 }) });
    await expect.element(button()).toHaveAccessibleName(goalLine(44_000, 80_000, DEADLINE));
    expect(shown()).toBe(goalLine(44_000, 80_000, DEADLINE));
    await jump.unmount();

    // Without it, a roll over ROLL_MS on the faked animation clock. No expect.element below.
    await emulate('light', 'no-preference');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const roll = await mount();
    flushSync();
    await roll.rerender({ headline: props({ homes: 44_000 }) });
    flushSync();
    expect(shown()).not.toBe(goalLine(44_000, 80_000, DEADLINE));
    expect(named()).toBe(goalLine(44_000, 80_000, DEADLINE));
    await vi.advanceTimersByTimeAsync(ROLL_MS + 50);
    flushSync();
    expect(shown()).toBe(goalLine(44_000, 80_000, DEADLINE));
    expect(el('goal-bar').getAttribute('data-fill')).toBe('55');
    await roll.unmount();

    // From null: at once.
    const fromNull = await mount({ homes: null });
    flushSync();
    await fromNull.rerender({ headline: props({ homes: 40_000 }) });
    flushSync();
    expect(shown()).toBe(goalLine(40_000, 80_000, DEADLINE));
    expect(el('goal-bar').getAttribute('data-fill')).toBe('50');
  });

  it('renders nothing for the open game', async () => {
    await page.viewport(1280, 800);
    await render(HeadlineHost, { props: { store: openGame(), headline: props() } });
    await expect.element(page.getByTestId('outside')).toBeInTheDocument();
    await expect.element(box()).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="goal-live"]')).toBeNull();
  });

  it('the box is at most 44 px tall at 1280 px', async () => {
    await page.viewport(1280, 800);
    await mount({ side: [sideEntry(towers, 10, 10)] });
    await expect.element(line2()).toBeVisible();
    expect(box().element().getBoundingClientRect().height).toBeLessThanOrEqual(44);
  });

  // The button's target is the box: its ::before covers it.
  it('the button is at least 24 px', async () => {
    for (const [w, h] of [
      [1280, 800],
      [375, 812]
    ] as const) {
      await page.viewport(w, h);
      const r = await mount();
      await expect.element(box()).toBeVisible();
      const b = box().element().getBoundingClientRect();
      expect(b.width).toBeGreaterThanOrEqual(24);
      expect(b.height).toBeGreaterThanOrEqual(24);
      const before = getComputedStyle(button().element(), '::before');
      expect(before.position).toBe('absolute');
      await r.unmount();
    }
  });

  it('axe finds no violation in light and dark, with the pop-over open', async () => {
    await page.viewport(1280, 800);
    await mount({ side: [sideEntry(added, 600, 1000), sideEntry(towers, 10, 10)] });
    await button().click();
    await expect.element(pop()).toBeVisible();
    for (const s of ['light', 'dark'] as const) {
      await emulate(s);
      expect((await axe.run(page.getByRole('banner').element())).violations).toEqual([]);
    }
  });
});
