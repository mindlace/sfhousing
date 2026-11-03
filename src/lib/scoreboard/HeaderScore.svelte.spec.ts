/// <reference types="@vitest/browser-playwright" />
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { vsFzpText } from '$lib/fzp/score-view';
import { M1_TARGETS } from './targets';
import HeaderScore from './HeaderScore.svelte';
import type { TargetProgress } from './types';

const rhna = M1_TARGETS.find((t) => t.id === 'rhna')!;
const target = (fraction: number): TargetProgress => ({ target: rhna, fraction });

type Props = ComponentProps<typeof HeaderScore>;
const props = (over: Partial<Props> = {}): Props => ({
  total: 12345,
  target: target(0.15),
  expanded: false,
  controls: 'dock',
  onclick: () => {},
  live: '',
  quiet: false,
  ...over
});

const bar = () => page.getByTestId('score-bar');
const live = () => page.getByTestId('score-live').element().textContent;

afterEach(() => {
  vi.useRealTimers();
});

describe('HeaderScore', () => {
  it('shows the count as "{n} homes added", the word kept in the name at 768 px', async () => {
    await page.viewport(768, 768);
    await render(HeaderScore, { props: props() });
    await expect.element(bar()).toHaveTextContent('12,345 homes added');
    await expect
      .element(page.getByRole('button', { name: /12,345 homes added/ }))
      .toBeInTheDocument();
    // Visually hidden below lg, but still in the name.
    expect(bar().element().textContent).toContain('added');
  });

  it('shows the pending text before the first score, and a custom one', async () => {
    await page.viewport(1024, 768);
    const s = await render(HeaderScore, { props: props({ total: null }) });
    await expect.element(bar()).toHaveTextContent('Simulating…');
    await s.rerender(props({ total: null, pending: 'Waiting' }));
    await expect.element(bar()).toHaveTextContent('Waiting');
  });

  it('the bar is a meter whose text is the share of RHNA', async () => {
    await page.viewport(1024, 768);
    await render(HeaderScore, { props: props({ target: target(0.15) }) });
    const meter = page.getByRole('meter');
    await expect.element(meter).toHaveAttribute('aria-valuetext', '15% of RHNA 2023–2031');
    const r = meter.element().getBoundingClientRect();
    expect(r.height).toBe(4);
  });

  it('fills the bar in proportion to the target', async () => {
    await page.viewport(1024, 768);
    await render(HeaderScore, { props: props({ target: target(0.5) }) });
    const meter = page.getByRole('meter').element();
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });

  it('hides the bar without a target', async () => {
    await page.viewport(1024, 768);
    await render(HeaderScore, { props: props({ target: null }) });
    expect(page.getByRole('meter').elements()).toEqual([]);
  });

  it('shows the delta as "vs FZP", and hides it when absent or null', async () => {
    await page.viewport(1024, 768);
    const s = await render(HeaderScore, { props: props({ delta: 1234 }) });
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent(vsFzpText(1234));
    await s.rerender(props({ delta: -56 }));
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent('vs FZP −56');
    await s.rerender(props({ delta: null }));
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    await s.rerender(props());
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
  });

  it('names the button by the count alone; the delta describes it and the meter sits outside', async () => {
    await page.viewport(1024, 768);
    const onclick = vi.fn();
    const s = await render(HeaderScore, { props: props({ delta: 1234, onclick }) });
    await expect.element(bar()).toHaveAccessibleName('12,345 homes added');
    await expect.element(bar()).toHaveAccessibleDescription(vsFzpText(1234));
    const meter = page.getByRole('meter');
    await expect.element(meter).toHaveAccessibleName(rhna.label);
    expect(bar().element().contains(meter.element())).toBe(false);
    const delta = page.getByTestId('score-delta');
    expect(bar().element().contains(delta.element())).toBe(false);
    // The whole box is the target: a press on the delta or the meter lands on the button.
    for (const el of [delta.element(), meter.element()]) {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      expect(hit).toBe(bar().element());
    }
    await bar().click();
    expect(onclick).toHaveBeenCalledTimes(1);
    await s.rerender(props({ total: null, delta: null }));
    await expect.element(bar()).toHaveAccessibleName('Simulating…');
    expect(bar().element().getAttribute('aria-describedby')).toBeNull();
  });

  it('is one button that reports expanded, controls and busy, and calls onclick', async () => {
    await page.viewport(1024, 768);
    const onclick = vi.fn();
    const s = await render(HeaderScore, { props: props({ onclick, expanded: true, busy: true }) });
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(bar()).toHaveAttribute('aria-controls', 'dock');
    await expect.element(bar()).toHaveAttribute('aria-busy', 'true');
    await bar().click();
    expect(onclick).toHaveBeenCalledTimes(1);
    await s.rerender(props({ onclick, expanded: false, busy: false }));
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(bar()).toHaveAttribute('aria-busy', 'false');
  });

  describe('live region', () => {
    it('is not the button text: the button holds no live region', async () => {
      await page.viewport(1024, 768);
      await render(HeaderScore, { props: props() });
      expect(bar().element().closest('[aria-live]')).toBeNull();
      expect(bar().element().querySelector('[aria-live]')).toBeNull();
      expect(page.getByTestId('score-live').element().getAttribute('aria-live')).toBe('polite');
    });

    it('stays empty at mount, then speaks a new text 1,000 ms after it last changed', async () => {
      vi.useFakeTimers();
      await page.viewport(1024, 768);
      const s = await render(HeaderScore, { props: props({ live: 'A' }) });
      vi.advanceTimersByTime(3000);
      expect(live()).toBe('');

      await s.rerender(props({ live: 'B' }));
      vi.advanceTimersByTime(900);
      expect(live()).toBe('');
      await s.rerender(props({ live: 'C' }));
      vi.advanceTimersByTime(900);
      expect(live()).toBe('');
      vi.advanceTimersByTime(200);
      await expect.poll(live).toBe('C');
    });

    it('stays empty while quiet, and speaks once quiet ends', async () => {
      vi.useFakeTimers();
      await page.viewport(1024, 768);
      const s = await render(HeaderScore, { props: props({ live: 'A', quiet: true }) });
      await s.rerender(props({ live: 'B', quiet: true }));
      vi.advanceTimersByTime(3000);
      expect(live()).toBe('');

      await s.rerender(props({ live: 'B', quiet: false }));
      vi.advanceTimersByTime(900);
      expect(live()).toBe('');
      vi.advanceTimersByTime(200);
      await expect.poll(live).toBe('B');
    });
  });
});
