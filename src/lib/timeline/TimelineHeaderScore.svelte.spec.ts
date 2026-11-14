/// <reference types="@vitest/browser-playwright" />
import type { ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { vsFzpText } from '$lib/fzp/score-view';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import type { TargetProgress } from '$lib/scoreboard/types';
import TimelineHeaderScore from './TimelineHeaderScore.svelte';

const rhna = M1_TARGETS.find((t) => t.id === 'rhna')!;
const target = (fraction: number): TargetProgress => ({ target: rhna, fraction });

type Props = ComponentProps<typeof TimelineHeaderScore>;
const props = (over: Partial<Props> = {}): Props => ({
  total: 12345,
  year: 2047,
  target: target(0.15),
  delta: 1234,
  busy: false,
  stale: false,
  expanded: false,
  controls: 'dock',
  onclick: () => {},
  live: '',
  quiet: false,
  ...over
});

const bar = () => page.getByTestId('score-bar');

describe('TimelineHeaderScore', () => {
  it('reads "{n} homes by {year}" and carries the year in name and description', async () => {
    await page.viewport(1024, 768);
    await render(TimelineHeaderScore, { props: props() });
    await expect.element(bar()).toHaveTextContent('12,345 homes by 2047');
    await expect.element(bar()).toHaveAccessibleName('12,345 homes by 2047');
    await expect.element(bar()).toHaveAccessibleDescription(`${vsFzpText(1234)} by 2047`);
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent(vsFzpText(1234));
    await expect
      .element(page.getByRole('meter'))
      .toHaveAttribute('aria-valuetext', '15% of RHNA 2023–2031');
  });

  it('reads calculating until filled, hiding the delta and the meter', async () => {
    await page.viewport(1024, 768);
    await render(TimelineHeaderScore, { props: props({ total: null, delta: null }) });
    await expect.element(bar()).toHaveTextContent('calculating…');
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    expect(page.getByRole('meter').elements()).toEqual([]);
    expect(bar().element().getAttribute('aria-describedby')).toBeNull();
  });

  it('reads calculating while provisional, whatever the fill state', async () => {
    await page.viewport(1024, 768);
    const s = await render(TimelineHeaderScore, { props: props({ provisional: true }) });
    await expect.element(bar()).toHaveTextContent('calculating…');
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    await s.rerender(props({ provisional: false }));
    await expect.element(bar()).toHaveTextContent('12,345 homes by 2047');
  });

  it('dims when stale, reports its state and calls onclick', async () => {
    await page.viewport(1024, 768);
    const onclick = vi.fn();
    const s = await render(TimelineHeaderScore, {
      props: props({ stale: true, busy: true, expanded: true, onclick })
    });
    expect(bar().element().parentElement!.classList.contains('opacity-60')).toBe(true);
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(bar()).toHaveAttribute('aria-controls', 'dock');
    await expect.element(bar()).toHaveAttribute('aria-busy', 'true');
    await bar().click();
    expect(onclick).toHaveBeenCalledTimes(1);
    await s.rerender(props({ stale: false }));
    expect(bar().element().parentElement!.classList.contains('opacity-60')).toBe(false);
  });

  it('speaks a new live text 1,000 ms after it settles, only while not quiet', async () => {
    vi.useFakeTimers();
    try {
      await page.viewport(1024, 768);
      const s = await render(TimelineHeaderScore, { props: props({ live: 'A' }) });
      vi.advanceTimersByTime(3000);
      expect(page.getByTestId('score-live').element().textContent).toBe('');
      await s.rerender(props({ live: 'B' }));
      vi.advanceTimersByTime(1000);
      await expect.poll(() => page.getByTestId('score-live').element().textContent).toBe('B');
      await s.rerender(props({ live: 'C', quiet: true }));
      vi.advanceTimersByTime(3000);
      expect(page.getByTestId('score-live').element().textContent).toBe('B');
    } finally {
      vi.useRealTimers();
    }
  });
});
