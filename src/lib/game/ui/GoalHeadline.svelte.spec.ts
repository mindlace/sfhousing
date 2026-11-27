// The pinned goal: pending, win or late (P19), the bar, the gift, and one line on a phone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, type ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { PENDING, type Verdict } from '../rounds';
import { GameStore, openGame } from '../store.svelte';
import { FakeSync } from '../test/fake-sync.svelte';
import type GoalHeadline from './GoalHeadline.svelte';
import GoalPinnedHeader from '$lib/shell/test/GoalPinnedHeader.svelte';
import { pinnedWords, type PinnedCtx } from './round-words';
import HeadlineHost from './test/HeadlineHost.svelte';

afterEach(async () => {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' }
    ]
  });
});

type Props = ComponentProps<typeof GoalHeadline>;

const CTX: PinnedCtx = {
  amount: 82_069,
  target: dayFromUtc(2060, 6, 1),
  legal: dayFromUtc(2066, 9, 30),
  round: 2,
  finished: false,
  next: 3
};
const WORDS = pinnedWords(PENDING, CTX);
const WIN: Verdict = { tag: 'win', goalMonth: dayFromUtc(2058, 3, 1) };
const LATE: Verdict = { tag: 'late', goalMonth: dayFromUtc(2062, 6, 1) };
const WIN_WORDS = pinnedWords(WIN, CTX);
const LATE_WORDS = pinnedWords(LATE, CTX);

const realStore = () =>
  new GameStore({
    storage: new MemoryStorage(),
    sync: new FakeSync(),
    now: () => new Date(2026, 10, 25)
  });

const props = (over: Partial<Props> = {}): Props => ({
  state: 'pending',
  words: WORDS,
  fill: 0.4,
  ...over
});
const win = (over: Partial<Props> = {}) => props({ state: 'win', words: WIN_WORDS, ...over });
const late = (over: Partial<Props> = {}) => props({ state: 'late', words: LATE_WORDS, ...over });

function mount(over: Partial<Props> = {}) {
  return render(HeadlineHost, { props: { store: realStore(), headline: props(over) } });
}

const box = () => page.getByTestId('goal-box');
const live = () => page.getByTestId('goal-live');
const giftEl = () => page.getByTestId('goal-gift');

describe('GoalHeadline', () => {
  it('renders line 1, line 2 and a bar filled to fill', async () => {
    await page.viewport(1280, 800);
    await mount();
    await expect.element(page.getByTestId('goal-line1')).toHaveTextContent(WORDS.line1);
    await expect.element(page.getByTestId('goal-line2')).toHaveTextContent(WORDS.line2);
    await expect.element(page.getByTestId('goal-bar')).toHaveAttribute('data-fill', '40');
  });

  for (const [name, p, w] of [
    ['pending', props(), WORDS],
    ['win', win({ ongift: () => {} }), WIN_WORDS],
    ['late', late(), LATE_WORDS]
  ] as const) {
    it(`the ${name} state renders line 1, line 2 and the bar`, async () => {
      await page.viewport(1280, 800);
      await mount(p);
      await expect.element(page.getByTestId('goal-headline')).toHaveAttribute('data-state', name);
      await expect.element(page.getByTestId('goal-line1')).toHaveTextContent(w.line1);
      await expect.element(page.getByTestId('goal-line2')).toHaveTextContent(w.line2);
      await expect.element(page.getByTestId('goal-bar')).toBeVisible();
    });
  }

  it('the win says so in words: "early" in line 2 and a gift named by words.gift', async () => {
    await page.viewport(1280, 800);
    const ongift = vi.fn();
    await mount(win({ ongift }));
    await expect.element(page.getByTestId('goal-line2')).toHaveTextContent('2 yr 3 mo early');
    const g = page.getByRole('button', { name: WIN_WORDS.gift! });
    await expect.element(g).toBeVisible();
    expect(g.element()).toBe(giftEl().element());
    await g.click();
    expect(ongift).toHaveBeenCalledOnce();
  });

  it('no gift without ongift, nor in pending or late', async () => {
    await page.viewport(1280, 800);
    const r = await mount(win());
    await expect.element(page.getByTestId('goal-line1')).toBeVisible();
    expect(document.querySelector('[data-testid="goal-gift"]')).toBeNull();
    for (const p of [props({ ongift: () => {} }), late({ ongift: () => {} })]) {
      await r.rerender({ headline: p });
      await expect.element(page.getByTestId('goal-line2')).toHaveTextContent(p.words.line2);
      expect(document.querySelector('[data-testid="goal-gift"]')).toBeNull();
    }
  });

  it('without a panel the lines are plain text, not a control', async () => {
    await page.viewport(1280, 800);
    await mount();
    const lines = page.getByTestId('goal-headline-button').element();
    expect(lines.tagName).not.toBe('BUTTON');
    expect(lines.hasAttribute('aria-expanded')).toBe(false);
    expect(lines.hasAttribute('aria-controls')).toBe(false);
    expect(lines.hasAttribute('tabindex')).toBe(false);
    expect(lines.hasAttribute('role')).toBe(false);
  });

  it('with a panel the lines are a button that opens it', async () => {
    await page.viewport(1280, 800);
    const panel = createRawSnippet(() => ({ render: () => '<p>Round 2</p>' }));
    await mount({ panel });
    const b = page.getByTestId('goal-headline-button');
    expect(b.element().tagName).toBe('BUTTON');
    await expect.element(b).toHaveAttribute('aria-expanded', 'false');
    const id = b.element().getAttribute('aria-controls')!;
    expect(document.getElementById(id)).not.toBeNull();
    await b.click();
    await expect.element(b).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('Round 2')).toBeVisible();
  });

  describe('the panel closes by Escape and by a press outside', () => {
    const panelSnippet = () => createRawSnippet(() => ({ render: () => '<p>Round 2</p>' }));
    const button = () => page.getByTestId('goal-headline-button');

    it('Escape closes it and focus is on the button', async () => {
      await page.viewport(1280, 800);
      await mount({ panel: panelSnippet() });
      await button().click();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'true');
      await userEvent.keyboard('{Escape}');
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(button()).toHaveFocus();
    });

    it('a press outside closes it, focus on the button; a press inside keeps it open', async () => {
      await page.viewport(1280, 800);
      await mount({ panel: panelSnippet() });
      await button().click();
      await page.getByText('Round 2').click();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'true');
      await page.getByTestId('outside').click();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(button()).toHaveFocus();
    });

    it('another header overlay opening closes it', async () => {
      await page.viewport(1280, 800);
      await mount({ panel: panelSnippet() });
      await button().click();
      await expect.element(button()).toHaveAttribute('aria-expanded', 'true');
      window.dispatchEvent(new CustomEvent('sfh-header-overlay-open', { detail: 'menu' }));
      await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
    });

    it('opening it announces itself to the other overlays', async () => {
      await page.viewport(1280, 800);
      const seen: string[] = [];
      const on = (e: Event) => seen.push((e as CustomEvent<string>).detail);
      window.addEventListener('sfh-header-overlay-open', on);
      try {
        await mount({ panel: panelSnippet() });
        await button().click();
        expect(seen).toHaveLength(1);
      } finally {
        window.removeEventListener('sfh-header-overlay-open', on);
      }
    });

    it('Escape with the panel shut does nothing to the focus', async () => {
      await page.viewport(1280, 800);
      await mount({ panel: panelSnippet() });
      await userEvent.keyboard('{Escape}');
      await expect.element(button()).not.toHaveFocus();
    });
  });

  it('the state at mount is not announced; win and late arriving later are', async () => {
    await page.viewport(1280, 800);
    const r = await mount(win({ ongift: () => {} }));
    await expect.element(page.getByTestId('goal-line1')).toBeVisible();
    expect(live().element().getAttribute('aria-live')).toBe('polite');
    expect(live().element().textContent).toBe('');
    await r.rerender({ headline: props() });
    await expect
      .element(page.getByTestId('goal-headline'))
      .toHaveAttribute('data-state', 'pending');
    expect(live().element().textContent).toBe('');
    await r.rerender({ headline: late() });
    await expect.element(live()).toHaveTextContent(LATE_WORDS.live!);
    await r.rerender({ headline: win({ ongift: () => {} }) });
    await expect.element(live()).toHaveTextContent(WIN_WORDS.live!);
  });

  it('the win marks its box beyond the words: an accent border', async () => {
    await page.viewport(1280, 800);
    const r = await mount();
    const colour = () => getComputedStyle(box().element()).borderTopColor;
    await expect.element(box()).toBeVisible();
    const pending = colour();
    await r.rerender({ headline: win({ ongift: () => {} }) });
    await expect.poll(colour).not.toBe(pending);
  });

  it('the gift jiggles every 4 s, and is still under reduced motion', async () => {
    await page.viewport(1280, 800);
    await mount(win({ ongift: () => {} }));
    await expect.element(giftEl()).toBeVisible();
    const style = () => getComputedStyle(giftEl().element());
    expect(style().animationName).not.toBe('none');
    expect(style().animationDuration).toBe('4s');
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await expect.poll(() => style().animationName).toBe('none');
  });

  describe('on a phone', () => {
    const phone = () => page.getByTestId('goal-phone');
    const part = (c: string) => phone().element().querySelector<HTMLElement>(`.goal-${c}`)!;
    const shows = (el: HTMLElement) => el.getBoundingClientRect().width > 0;
    /** The phone line's visible words. */
    const read = () =>
      (['count', 'short', 'homes', 'rest'] as const)
        .map((c) => part(c))
        .filter(shows)
        .map((el, i, all) => (el === all.at(-1) ? ` ${el.textContent}` : el.textContent))
        .join('');

    for (const [name, p, rest] of [
      ['pending', props(), 'before Jun 2060'],
      ['win', win({ ongift: () => {} }), 'by Mar 2058 · 2 yr 3 mo early'],
      ['late', late(), 'by Jun 2062 · 2 years late']
    ] as const) {
      it(`at 320 px the ${name} state is one line from the bar's left, without overflow`, async () => {
        await page.viewport(320, 700);
        render(GoalPinnedHeader, { props: { game: realStore(), headline: p } });
        await expect.element(phone()).toBeVisible();
        await expect.element(page.getByTestId('goal-line1')).not.toBeVisible();
        await expect.element(page.getByTestId('goal-line2')).not.toBeVisible();
        await expect.element(page.getByTestId('goal-bar')).toBeVisible();
        expect(read()).toMatch(
          new RegExp(`^(82,069|82k)(${name === 'pending' ? ' homes' : ''})? ${rest}$`)
        );
        expect(shows(part('rest'))).toBe(true);
        const banner = page.getByRole('banner').element() as HTMLElement;
        const b = box().element().getBoundingClientRect();
        expect(b.left - banner.getBoundingClientRect().left).toBeLessThanOrEqual(16);
        expect(b.right).toBeLessThanOrEqual(
          page.getByRole('button', { name: 'Menu' }).element().getBoundingClientRect().left
        );
        expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
        const line = phone().element() as HTMLElement;
        expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
        if (name === 'win') {
          const g = giftEl().element().getBoundingClientRect();
          expect(g.width).toBeGreaterThanOrEqual(24);
          expect(g.height).toBeGreaterThanOrEqual(24);
          expect(g.right).toBeLessThanOrEqual(b.right);
        }
      });
    }

    it('narrowed, "homes" hides first and the short count comes last; the rest always shows', async () => {
      await page.viewport(320, 700);
      await mount();
      const root = page.getByTestId('goal-headline').element() as HTMLElement;
      root.style.flex = 'none';
      const at = async (rem: number) => {
        root.style.width = `${rem}rem`;
        await expect.poll(() => root.getBoundingClientRect().width).toBe(rem * 16);
        return (['count', 'short', 'homes', 'rest'] as const).map((c) => shows(part(c)));
      };
      expect(await at(19)).toEqual([true, false, true, true]);
      expect(await at(15)).toEqual([true, false, false, true]);
      expect(await at(11)).toEqual([false, true, false, true]);
    });
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
