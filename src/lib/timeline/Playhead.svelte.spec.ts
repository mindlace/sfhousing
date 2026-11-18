/// <reference types="@vitest/browser-playwright" />
import { flushSync, type ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import PlayheadHost from './test/PlayheadHost.svelte';

const ASOF = dayFromUtc(2026, 10, 15);
const WINDOW_END = dayFromUtc(2066, 10, 31);
const END = dayFromUtc(2040, 12, 31);

/** A manual frame queue: the tests drive frames at chosen timestamps, no real timers. */
function manualRaf() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  let calls = 0;
  return {
    raf: (cb: FrameRequestCallback) => {
      calls += 1;
      const h = next++;
      queue.set(h, cb);
      return h;
    },
    cancelRaf: (h: number) => {
      queue.delete(h);
    },
    calls: () => calls,
    frame(ts: number) {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(ts);
      flushSync();
    }
  };
}

type HostProps = ComponentProps<typeof PlayheadHost>;
const stateText = () => page.getByTestId('state').element().textContent!;
const stateDay = () => Number(stateText().split('|')[0]);
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
const play = () => page.getByTestId('tl-play');

async function setup(props: Partial<HostProps> = {}) {
  await page.viewport(1280, 800);
  const q = manualRaf();
  const onday = vi.fn();
  const view = await render(PlayheadHost, {
    props: {
      asOf: ASOF,
      windowEnd: WINDOW_END,
      end: END,
      onday,
      raf: q.raf,
      cancelRaf: q.cancelRaf,
      ...props
    }
  });
  return { q, onday, view };
}

describe('Playhead markers', () => {
  it('a marker jump while playing pauses, clamps to the filled mark and moves the day', async () => {
    const rhna = dayFromUtc(2031, 1, 31);
    const far = dayFromUtc(2060, 1, 1);
    const { onday } = await setup({
      startPlaying: true,
      markers: [
        { day: rhna, label: 'RHNA deadline', name: 'Jump to RHNA deadline, January 2031' },
        { day: far, label: '2060', name: 'Jump to 2060' }
      ]
    });
    await page.getByRole('button', { name: 'Jump to RHNA deadline, January 2031' }).click();
    expect(stateText()).toBe(`${rhna}|false|year`);
    expect(onday).toHaveBeenCalledTimes(1);
    await page.getByRole('button', { name: 'Jump to 2060' }).click();
    expect(stateDay()).toBe(END);
  });
});

describe('Playhead', () => {
  it('is a slider named "Date in the simulation" with the month as value text', async () => {
    await setup();
    const el = slider();
    await expect.element(el).toHaveAttribute('aria-valuemin', String(ASOF));
    await expect.element(el).toHaveAttribute('aria-valuemax', String(WINDOW_END));
    await expect.element(el).toHaveAttribute('aria-valuenow', String(ASOF));
    await expect.element(el).toHaveAttribute('aria-valuetext', 'October 2026');
  });

  it('Left and Right move a month, Page keys a year, Home the dataset date, End the filled mark', async () => {
    const start = dayFromUtc(2030, 3, 17);
    const { onday } = await setup({ startDay: start });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stateDay()).toBe(dayFromUtc(2030, 4, 1));
    await userEvent.keyboard('{ArrowLeft}');
    expect(stateDay()).toBe(dayFromUtc(2030, 3, 1));
    await userEvent.keyboard('{PageUp}');
    expect(stateDay()).toBe(dayFromUtc(2031, 3, 1));
    await userEvent.keyboard('{PageDown}');
    expect(stateDay()).toBe(dayFromUtc(2030, 3, 1));
    await userEvent.keyboard('{End}');
    expect(stateDay()).toBe(END);
    await userEvent.keyboard('{ArrowRight}');
    expect(stateDay()).toBe(END);
    await userEvent.keyboard('{Home}');
    expect(stateDay()).toBe(ASOF);
    expect(onday).toHaveBeenCalledTimes(6);
  });

  it('leaves modified keys alone', async () => {
    const { onday } = await setup({ startDay: dayFromUtc(2030, 3, 17) });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Control>}{ArrowRight}{/Control}');
    await userEvent.keyboard('{Alt>}{Home}{/Alt}');
    expect(onday).not.toHaveBeenCalled();
    expect(stateDay()).toBe(dayFromUtc(2030, 3, 17));
  });

  it('does not move forward when the filled mark fell behind it', async () => {
    const start = dayFromUtc(2041, 6, 1);
    const { onday } = await setup({ startDay: start });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stateDay()).toBe(start);
    expect(onday).not.toHaveBeenCalled();
  });

  it('a key pauses playback', async () => {
    const { q } = await setup({ startPlaying: true, startDay: dayFromUtc(2030, 3, 17) });
    expect(stateText().split('|')[1]).toBe('true');
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stateText().split('|')[1]).toBe('false');
    expect(q.calls()).toBe(1);
  });

  it('a click on the track moves the playhead, clamped to the filled mark, and pauses', async () => {
    await setup({ startPlaying: true });
    const el = slider().element() as HTMLElement;
    const r = el.getBoundingClientRect();
    // The filled mark is at 14/40 of the window: a click at 90% clamps to it.
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: r.left + r.width * 0.9,
        clientY: r.top + 5,
        pointerId: 1,
        button: 0,
        bubbles: true
      })
    );
    flushSync();
    expect(stateDay()).toBe(END);
    expect(stateText().split('|')[1]).toBe('false');
  });

  it('nothing plays on mount', async () => {
    const { q } = await setup();
    expect(q.calls()).toBe(0);
    expect(stateText().split('|')[1]).toBe('false');
  });

  it('plays forward with Play', async () => {
    const { q } = await setup();
    await play().click();
    expect(stateText().split('|')[1]).toBe('true');
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBeGreaterThan(ASOF);
    expect(stateDay()).toBeLessThanOrEqual(END);
  });

  it('stops at the filled mark and resumes by itself when the mark moves on', async () => {
    const end1 = ASOF + 100;
    const { q, view } = await setup({ end: end1, startPlaying: true });
    let ts = 0;
    q.frame(ts);
    for (let i = 0; i < 10; i++) q.frame((ts += 100));
    expect(stateDay()).toBe(end1);
    expect(stateText().split('|')[1]).toBe('true');
    // Idle at the mark: frames keep coming and the day stays.
    q.frame((ts += 100));
    expect(stateDay()).toBe(end1);
    expect(stateText().split('|')[1]).toBe('true');
    await view.rerender({ end: ASOF + 400 });
    flushSync();
    q.frame((ts += 100));
    q.frame(ts + 100);
    expect(stateDay()).toBeGreaterThan(end1);
    expect(stateText().split('|')[1]).toBe('true');
  });

  it('stops playing at the window end', async () => {
    const { q } = await setup({ end: WINDOW_END, startDay: WINDOW_END - 10, startPlaying: true });
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBe(WINDOW_END);
    expect(stateText().split('|')[1]).toBe('false');
  });

  it('stops playing at last, not at the window end, and reads Replay there', async () => {
    const last = WINDOW_END - 20;
    const { q } = await setup({ last, end: last, startDay: last - 10, startPlaying: true });
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBe(last);
    expect(stateText().split('|')[1]).toBe('false');
    await expect.element(page.getByTestId('tl-play-label')).toHaveTextContent('Replay');
    await expect.element(slider()).toHaveAttribute('aria-valuemax', String(last));
  });

  it('Play is unavailable while not playable', async () => {
    const { q } = await setup({ playable: false });
    await expect.element(play()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(play()).toHaveAccessibleDescription(/forecast is filled/);
    await expect
      .element(page.getByTestId('tl-faster'))
      .toHaveAccessibleDescription(/forecast is filled/);
    (play().element() as HTMLElement).click();
    flushSync();
    expect(stateText().split('|')[1]).toBe('false');
    expect(q.calls()).toBe(0);
  });

  it('the readout keeps one width as the month changes', async () => {
    await setup({ startDay: dayFromUtc(2030, 5, 10) });
    const readout = page.getByTestId('tl-readout').element() as HTMLElement;
    const widths = new Set<number>();
    widths.add(readout.getBoundingClientRect().width);
    (slider().element() as HTMLElement).focus();
    for (let i = 0; i < 7; i++) {
      await userEvent.keyboard('{ArrowRight}');
      widths.add(readout.getBoundingClientRect().width);
    }
    expect(widths.size).toBe(1);
    await expect.element(page.getByTestId('tl-readout-label')).toHaveTextContent('December 2030');
  });
});
