/// <reference types="@vitest/browser-playwright" />
import type { ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { CALCULATING } from '$lib/fzp/score-view';
import type { HeadlineText } from './results';
import TimelineHeaderScore from './TimelineHeaderScore.svelte';

const TEXT: HeadlineText = {
  main: '47,335 homes by Apr 2040',
  effect: '+1,817 from your policy',
  goal: '68% of the goal',
  goalName: 'State target: 82,069 homes by Jan 2031'
};

type Props = ComponentProps<typeof TimelineHeaderScore>;
const props = (over: Partial<Props> = {}): Props => ({
  text: TEXT,
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
const box = () => page.getByTestId('score-box');

describe('TimelineHeaderScore', () => {
  it('has no aria-expanded when expanded is undefined', async () => {
    await page.viewport(1024, 768);
    await render(TimelineHeaderScore, { props: props({ expanded: undefined }) });
    await expect.element(bar()).toHaveAttribute('aria-controls', 'dock');
    expect(bar().element().hasAttribute('aria-expanded')).toBe(false);
  });

  it('shows calculating with no text', async () => {
    await page.viewport(1280, 768);
    await render(TimelineHeaderScore, { props: props({ text: null }) });
    await expect.element(bar()).toHaveTextContent(CALCULATING);
    expect(page.getByTestId('score-detail').elements()).toEqual([]);
    expect(bar().element().getAttribute('aria-describedby')).toBeNull();
  });

  it('line 1 is the button; line 2 describes it', async () => {
    await page.viewport(1280, 768);
    await render(TimelineHeaderScore, { props: props() });
    await expect.element(bar()).toHaveAccessibleName(TEXT.main);
    await expect
      .element(bar())
      .toHaveAccessibleDescription('+1,817 from your policy · 68% of the goal');
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent(TEXT.effect!);
    await expect.element(page.getByTestId('score-goal')).toHaveTextContent(TEXT.goal!);
    await expect.element(page.getByTestId('score-detail')).toBeVisible();
  });

  it('no effect: line 2 is the goal alone, with no separator', async () => {
    await page.viewport(1280, 768);
    await render(TimelineHeaderScore, { props: props({ text: { ...TEXT, effect: null } }) });
    await expect.element(bar()).toHaveAccessibleDescription('68% of the goal');
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    expect(page.getByTestId('score-detail').element().textContent).toBe('68% of the goal');
  });

  it('no meter and no RHNA anywhere in the box', async () => {
    await page.viewport(1280, 768);
    await render(TimelineHeaderScore, { props: props() });
    await expect.element(bar()).toHaveTextContent(TEXT.main);
    expect(page.getByRole('meter').elements()).toEqual([]);
    expect(box().element().textContent).not.toMatch(/RHNA/);
  });

  it('hover and focus name the goal; Escape closes it; the box keeps its height', async () => {
    await page.viewport(1280, 768);
    await render(TimelineHeaderScore, { props: props() });
    await expect.element(bar()).toBeVisible();
    const before = box().element().getBoundingClientRect().height;
    (bar().element() as HTMLElement).focus();
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toHaveTextContent(TEXT.goalName!);
    expect(Math.abs(box().element().getBoundingClientRect().height - before)).toBeLessThanOrEqual(
      0.5
    );
    // Under the box, not beside it.
    const t = tip.element().getBoundingClientRect();
    expect(t.top).toBeGreaterThanOrEqual(box().element().getBoundingClientRect().bottom - 0.5);
    expect(bar().element().getAttribute('aria-describedby')).toContain(tip.element().id);
    await userEvent.keyboard('{Escape}');
    await expect.element(tip).not.toBeInTheDocument();
    await userEvent.hover(bar());
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(TEXT.goalName!);
  });

  it('focus holds on the button as the numbers come and go; no goal, no name', async () => {
    await page.viewport(1280, 768);
    const s = await render(TimelineHeaderScore, { props: props({ text: null }) });
    const button = bar().element() as HTMLElement;
    button.focus();
    await expect.element(button).toHaveFocus();
    expect(page.getByRole('tooltip').elements()).toEqual([]);
    await s.rerender(props());
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(TEXT.goalName!);
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    expect(bar().element()).toBe(button);
    expect(document.activeElement).toBe(button);
    await s.rerender(props({ text: null }));
    await expect.element(bar()).toHaveTextContent(CALCULATING);
    expect(document.activeElement).toBe(button);
  });

  const DETAIL = '+1,817 from your policy · 68% of the goal';

  it('a focus begun while calculating leaves the description whole after blur', async () => {
    await page.viewport(1280, 768);
    const s = await render(TimelineHeaderScore, { props: props({ text: null }) });
    const button = bar().element() as HTMLElement;
    button.focus();
    await expect.element(button).toHaveFocus();
    await s.rerender(props());
    await expect.element(bar()).toHaveTextContent(TEXT.main);
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    button.blur();
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    const detailId = document.querySelector('[id$="-detail"]')!.id;
    expect(detailId).toMatch(/-detail$/);
    expect(button.getAttribute('aria-describedby')).toBe(detailId);
    await expect.element(bar()).toHaveAccessibleDescription(DETAIL);
  });

  it('a hover begun while calculating leaves the description whole after the pointer leaves', async () => {
    await page.viewport(1280, 768);
    const s = await render(TimelineHeaderScore, { props: props({ text: null }) });
    await userEvent.hover(bar());
    await s.rerender(props());
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(TEXT.goalName!);
    await userEvent.unhover(bar());
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    const detailId = document.querySelector('[id$="-detail"]')!.id;
    expect(bar().element().getAttribute('aria-describedby')).toBe(detailId);
    await expect.element(bar()).toHaveAccessibleDescription(DETAIL);
  });

  it('below sm only line 1 shows', async () => {
    await page.viewport(375, 700);
    await render(TimelineHeaderScore, { props: props() });
    await expect.element(bar()).toBeVisible();
    await expect.element(page.getByTestId('score-detail')).not.toBeVisible();
    await expect
      .element(bar())
      .toHaveAccessibleDescription('+1,817 from your policy · 68% of the goal');
  });

  it('from lg to xl the goal drops while the effect shows', async () => {
    await page.viewport(1100, 768);
    const s = await render(TimelineHeaderScore, { props: props() });
    await expect.element(page.getByTestId('score-delta')).toBeVisible();
    await expect.element(page.getByTestId('score-goal')).not.toBeVisible();
    // The dropped part stays in the description.
    await expect
      .element(bar())
      .toHaveAccessibleDescription('+1,817 from your policy · 68% of the goal');
    await s.rerender(props({ text: { ...TEXT, effect: null } }));
    await expect.element(page.getByTestId('score-goal')).toBeVisible();
  });

  it('dims when stale, reports its state and calls onclick', async () => {
    await page.viewport(1024, 768);
    const onclick = vi.fn();
    const s = await render(TimelineHeaderScore, {
      props: props({ stale: true, busy: true, expanded: true, onclick })
    });
    // Muted ink, not opacity: the button keeps AA contrast.
    expect(box().element().getAttribute('data-stale')).toBe('true');
    expect(getComputedStyle(bar().element()).color).toBe('rgb(75, 85, 99)');
    expect(getComputedStyle(box().element()).opacity).toBe('1');
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(bar()).toHaveAttribute('aria-controls', 'dock');
    await expect.element(bar()).toHaveAttribute('aria-busy', 'true');
    await bar().click();
    expect(onclick).toHaveBeenCalledTimes(1);
    await s.rerender(props({ stale: false }));
    expect(box().element().hasAttribute('data-stale')).toBe(false);
    expect(getComputedStyle(bar().element()).color).not.toBe('rgb(75, 85, 99)');
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
