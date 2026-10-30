/// <reference types="@vitest/browser-playwright" />
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { makeTimelineScore } from '$lib/fzp/fixtures/timeline-score';
import { dayFromUtc } from '$lib/fzp/time';
import type { TimelineScore } from '$lib/sim/protocol';
import ScoreBar from './ScoreBar.svelte';

/** Month 0 of the fixture (October 2026) adds nothing to the baseline, so the total is 1,234. */
function score1234(): TimelineScore {
  const s = makeTimelineScore();
  return { ...s, baseline: { ...s.baseline, completedNet: 1234 } };
}
const OCT = dayFromUtc(2026, 10, 20);
const panel = createRawSnippet(() => ({
  render: () => '<div><p>Score details here</p><button type="button">Inside</button></div>'
}));

type Over = Partial<{ score: TimelineScore | null; day: number; playing: boolean; busy: boolean }>;
const props = (over: Over = {}) => ({
  score: score1234(),
  day: OCT,
  playing: false,
  panel,
  ...over
});

const bar = () => page.getByRole('button', { name: /homes added|Simulating/ });
const live = () => page.getByTestId('score-live').element().textContent;

afterEach(() => {
  vi.useRealTimers();
});

describe('ScoreBar', () => {
  it('shows "{n} homes added" at the scrubbed day', async () => {
    await page.viewport(1024, 768);
    await render(ScoreBar, { props: props() });
    await expect.element(bar()).toHaveTextContent('1,234 homes added');
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows "Simulating…" before the first score', async () => {
    await page.viewport(1024, 768);
    await render(ScoreBar, { props: props({ score: null }) });
    await expect.element(bar()).toHaveTextContent('Simulating…');
  });

  it('pressing it shows the details; Escape closes them and focuses the button', async () => {
    await page.viewport(1024, 768);
    await render(ScoreBar, { props: props() });
    await expect.element(page.getByText('Score details here')).not.toBeInTheDocument();
    await bar().click();
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(bar().element().getAttribute('aria-controls')!);
    expect(details).not.toBeNull();
    await expect.element(page.getByText('Score details here')).toBeVisible();
    expect(details!.contains(page.getByText('Score details here').element())).toBe(true);
    (page.getByRole('button', { name: 'Inside' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(page.getByText('Score details here')).not.toBeInTheDocument();
    await expect.element(bar()).toHaveFocus();
  });

  it('the button toggles the details closed', async () => {
    await page.viewport(1024, 768);
    await render(ScoreBar, { props: props() });
    await bar().click();
    await bar().click();
    await expect.element(bar()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(page.getByText('Score details here')).not.toBeInTheDocument();
  });

  it('Escape inside a modal dialog leaves the details open', async () => {
    await page.viewport(1024, 768);
    const dlg = document.createElement('dialog');
    dlg.innerHTML = '<button type="button">In dialog</button>';
    document.body.appendChild(dlg);
    try {
      await render(ScoreBar, { props: props() });
      await bar().click();
      dlg.showModal();
      await userEvent.keyboard('{Escape}');
      expect(dlg.open).toBe(false);
      await expect.element(page.getByText('Score details here')).toBeVisible();
    } finally {
      dlg.remove();
    }
  });

  it('carries busy as aria-busy on the button and the details', async () => {
    await page.viewport(1024, 768);
    const screen = await render(ScoreBar, { props: props({ busy: true }) });
    await expect.element(bar()).toHaveAttribute('aria-busy', 'true');
    await bar().click();
    const details = document.getElementById(bar().element().getAttribute('aria-controls')!)!;
    expect(details.getAttribute('aria-busy')).toBe('true');
    await screen.rerender(props({ busy: false }));
    await expect.element(bar()).toHaveAttribute('aria-busy', 'false');
  });

  it('is a popover 384 px wide at the top right from 768 px', async () => {
    await page.viewport(1024, 768);
    await render(ScoreBar, { props: props() });
    await bar().click();
    const details = document.getElementById(bar().element().getAttribute('aria-controls')!)!;
    expect(details.getBoundingClientRect().width).toBe(384);
  });

  it('is full width at 375 px with no horizontal scroll, and the button is 24x24 or more', async () => {
    await page.viewport(375, 812);
    await render(ScoreBar, { props: props() });
    const r = bar().element().getBoundingClientRect();
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(r.height).toBeGreaterThanOrEqual(24);
    await bar().click();
    const details = document.getElementById(bar().element().getAttribute('aria-controls')!)!;
    expect(details.getBoundingClientRect().width).toBe(375);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  describe('live region', () => {
    it('is silent while playing, then speaks 1 s after playback pauses', async () => {
      vi.useFakeTimers();
      await page.viewport(1024, 768);
      const screen = await render(ScoreBar, { props: props({ playing: true }) });
      const day2 = dayFromUtc(2026, 10, 25);
      await screen.rerender(props({ playing: true, day: day2 }));
      vi.advanceTimersByTime(3000);
      expect(live()).toBe('');

      await screen.rerender(props({ playing: false, day: day2 }));
      vi.advanceTimersByTime(900);
      expect(live()).toBe('');
      vi.advanceTimersByTime(200);
      await expect.poll(live).toBe('1,234 homes added by October 2026');
    });

    it('does not announce the state it loaded in', async () => {
      vi.useFakeTimers();
      await page.viewport(1024, 768);
      await render(ScoreBar, { props: props() });
      vi.advanceTimersByTime(3000);
      expect(live()).toBe('');
    });

    it('is not the button text: the button is not a live region', async () => {
      await page.viewport(1024, 768);
      await render(ScoreBar, { props: props() });
      expect(bar().element().closest('[aria-live]')).toBeNull();
      expect(page.getByTestId('score-live').element().getAttribute('aria-live')).toBe('polite');
    });
  });
});
