import { flushSync, type ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { dayFromUtc } from './time';
import TimeScrubberHarness from './TimeScrubberHarness.svelte';
import type { Marker } from './types';

const ASOF = dayFromUtc(2026, 10, 15);
const HORIZON = dayFromUtc(2050, 12, 31);
const MONTH_DAYS = 30.436875;
const MARKERS: Marker[] = [
  {
    day: dayFromUtc(2031, 1, 31),
    label: 'RHNA deadline',
    name: 'Jump to RHNA deadline, January 2031'
  },
  { day: dayFromUtc(2045, 1, 1), label: '2045', name: 'Jump to 2045' }
];

/** A manual frame queue: the tests drive frames at chosen timestamps, no real timers. */
function manualRaf() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    raf: (cb: FrameRequestCallback) => {
      const h = next++;
      queue.set(h, cb);
      return h;
    },
    cancelRaf: (h: number) => {
      queue.delete(h);
    },
    pending: () => queue.size,
    /** Run the callbacks queued now (those queued while running wait for the next call). */
    frame(ts: number) {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(ts);
      flushSync();
    }
  };
}

type HarnessProps = ComponentProps<typeof TimeScrubberHarness>;

const stateText = () => page.getByTestId('state').element().textContent;
const stateDay = () => Number(stateText()!.split('|')[0]);
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });

async function setup(props: Partial<HarnessProps> = {}) {
  await page.viewport(1280, 800);
  const q = manualRaf();
  const onday = vi.fn();
  await render(TimeScrubberHarness, {
    props: {
      asOf: ASOF,
      horizon: HORIZON,
      markers: MARKERS,
      onday,
      raf: q.raf,
      cancelRaf: q.cancelRaf,
      reducedMotion: () => false,
      ...props
    }
  });
  return { q, onday };
}

describe('slider', () => {
  it('is a native range with min, max, step and a month-year value text', async () => {
    await setup();
    const el = slider().element() as HTMLInputElement;
    expect(el.type).toBe('range');
    expect(Number(el.min)).toBe(ASOF);
    expect(Number(el.max)).toBe(HORIZON);
    expect(el.step).toBe('1');
    expect(Number(el.value)).toBe(ASOF);
    await expect.element(slider()).toHaveAttribute('aria-valuetext', 'October 2026');
  });
});

describe('keys', () => {
  const start = dayFromUtc(2027, 3, 17);
  // PageDown's 2026-03-01 is before asOf, so that key clamps to asOf.
  const cases: [string, number][] = [
    ['{ArrowLeft}', dayFromUtc(2027, 3, 1)],
    ['{ArrowDown}', dayFromUtc(2027, 3, 1)],
    ['{ArrowRight}', dayFromUtc(2027, 4, 1)],
    ['{ArrowUp}', dayFromUtc(2027, 4, 1)],
    ['{PageDown}', ASOF],
    ['{PageUp}', dayFromUtc(2028, 3, 1)],
    ['{Home}', ASOF],
    ['{End}', HORIZON]
  ];
  it.each(cases)('%s from 2027-03-17 pauses and calls onday once', async (key, want) => {
    const { onday } = await setup({ startDay: start, startPlaying: true });
    slider().element().focus();
    await userEvent.keyboard(key);
    expect(onday).toHaveBeenCalledTimes(1);
    expect(onday).toHaveBeenCalledWith(want);
    expect(stateText()).toBe(`${want}|false|year`);
  });

  it('prevents the default of a handled key', async () => {
    await setup({ startDay: start });
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    slider().element().dispatchEvent(ev);
    flushSync();
    expect(ev.defaultPrevented).toBe(true);
    expect(stateText()).toBe(`${dayFromUtc(2027, 4, 1)}|false|year`);
  });

  it('leaves unhandled keys and modified keys alone', async () => {
    const { onday } = await setup({ startDay: start });
    const el = slider().element();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const alt = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    el.dispatchEvent(tab);
    el.dispatchEvent(alt);
    expect(tab.defaultPrevented).toBe(false);
    expect(alt.defaultPrevented).toBe(false);
    expect(onday).not.toHaveBeenCalled();
  });

  it('does not call onday when the key lands on the current day', async () => {
    const { onday } = await setup();
    slider().element().focus();
    await userEvent.keyboard('{Home}');
    expect(onday).not.toHaveBeenCalled();
  });
});

describe('markers and ends', () => {
  it('marker buttons carry the accessible name, jump and pause', async () => {
    const { onday } = await setup({ startPlaying: true });
    const btn = page.getByRole('button', { name: 'Jump to RHNA deadline, January 2031' });
    await expect.element(btn).toHaveTextContent('RHNA deadline');
    await btn.click();
    expect(onday).toHaveBeenCalledWith(MARKERS[0].day);
    expect(stateText()).toBe(`${MARKERS[0].day}|false|year`);
    await page.getByRole('button', { name: 'Jump to 2045' }).click();
    expect(onday).toHaveBeenLastCalledWith(MARKERS[1].day);
  });

  it('labels both ends of the track', async () => {
    await setup();
    await expect.element(page.getByText('Oct 2026', { exact: true })).toBeVisible();
    await expect.element(page.getByText('2050', { exact: true })).toBeVisible();
  });
});

describe('readout', () => {
  it('shows the Simulation pill and the month, and is not a live region', async () => {
    await setup({ startDay: dayFromUtc(2031, 3, 9) });
    const readout = page.getByTestId('fzp-readout');
    await expect.element(readout).toHaveTextContent('Simulation');
    await expect.element(readout).toHaveTextContent('March 2031');
    const el = readout.element();
    expect(el.closest('[aria-live]')).toBeNull();
    expect(el.querySelector('[aria-live]')).toBeNull();
    expect(el.getAttribute('role')).toBeNull();
  });
});

describe('play, pause, replay', () => {
  it('Play starts the frame loop and reads Pause; Pause stops it', async () => {
    const { q } = await setup();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.element(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(q.pending()).toBe(1);
    await page.getByRole('button', { name: 'Pause' }).click();
    expect(q.pending()).toBe(0);
    expect(stateText()).toBe(`${ASOF}|false|year`);
  });

  it('advances by the speed each frame and reports each day change once', async () => {
    const { q, onday } = await setup({ startPlaying: true });
    q.frame(1000); // the first frame only sets the time base
    q.frame(1100); // 100 ms at 1 year/s
    const d = stateDay();
    expect(d).toBe(Math.floor(ASOF + 0.1 * 12 * MONTH_DAYS));
    expect(onday).toHaveBeenCalledTimes(1);
    expect(onday).toHaveBeenCalledWith(d);
    await expect.element(slider()).toHaveAttribute('aria-valuetext', 'November 2026');
  });

  it('clamps a long frame to 100 ms', async () => {
    const { q } = await setup({ startPlaying: true });
    q.frame(0);
    q.frame(60_000);
    expect(stateDay()).toBe(Math.floor(ASOF + 0.1 * 12 * MONTH_DAYS));
  });

  it('stops at the horizon, reads Replay, and Replay restarts from asOf', async () => {
    const { q, onday } = await setup({ startDay: HORIZON - 5, startPlaying: true });
    q.frame(0);
    q.frame(100);
    expect(stateText()).toBe(`${HORIZON}|false|year`);
    expect(q.pending()).toBe(0);
    const replay = page.getByRole('button', { name: 'Replay' });
    await expect.element(replay).toBeVisible();
    await replay.click();
    expect(onday).toHaveBeenLastCalledWith(ASOF);
    expect(stateText()).toBe(`${ASOF}|true|year`);
    await expect.element(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(q.pending()).toBe(1);
  });
});

describe('speed', () => {
  it('is a select named Speed with the three options, 1 year/s selected', async () => {
    await setup();
    const sel = page.getByRole('combobox', { name: 'Speed' });
    await expect.element(sel).toHaveValue('year');
    const el = sel.element() as unknown as HTMLSelectElement;
    expect([...el.options].map((o) => o.text)).toEqual(['1 month/s', '1 year/s', '3 years/s']);
    expect(el.selectedOptions[0].text).toBe('1 year/s');
  });

  it('changing it changes the advance per frame', async () => {
    const { q } = await setup({ startPlaying: true });
    await page.getByRole('combobox', { name: 'Speed' }).selectOptions('threeYears');
    expect(stateText()).toBe(`${ASOF}|true|threeYears`);
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBe(Math.floor(ASOF + 0.1 * 36 * MONTH_DAYS));
  });
});

describe('autoplay', () => {
  it('starts playback when autoplay is true', async () => {
    const { q } = await setup({ autoplay: true });
    await expect.element(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(q.pending()).toBe(1);
  });

  it('stays paused under reduced motion, and Play still works', async () => {
    const { q, onday } = await setup({ autoplay: true, reducedMotion: () => true });
    await expect.element(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(q.pending()).toBe(0);
    q.frame(0);
    q.frame(100);
    expect(stateText()).toBe(`${ASOF}|false|year`);
    expect(onday).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Play' }).click();
    expect(q.pending()).toBe(1);
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBeGreaterThan(ASOF);
  });

  it('fires once per mount: pausing does not restart it', async () => {
    const { q } = await setup({ autoplay: true });
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect.element(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(q.pending()).toBe(0);
  });
});

describe('per frame work', () => {
  it('setTime called at most once per frame: onday fires only when the day changed', async () => {
    const { q, onday } = await setup({ startPlaying: true });
    await page.getByRole('combobox', { name: 'Speed' }).selectOptions('threeYears');
    q.frame(0);
    let ts = 0;
    let last = ASOF;
    for (let i = 0; i < 10; i++) {
      const before = onday.mock.calls.length;
      ts += 16;
      q.frame(ts);
      const d = stateDay();
      expect(onday.mock.calls.length - before).toBe(d === last ? 0 : 1);
      last = d;
    }
    expect(onday.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('a frame whose floor(t) is unchanged does not call onday', async () => {
    const { q, onday } = await setup({ startPlaying: true });
    await page.getByRole('combobox', { name: 'Speed' }).selectOptions('month');
    q.frame(0);
    q.frame(10); // 10 ms at about 30 days/s is 0.3 day
    expect(onday).not.toHaveBeenCalled();
    expect(stateText()).toBe(`${ASOF}|true|month`);
  });
});

describe('pointer input', () => {
  const drag = (to: number) => {
    const el = slider().element() as HTMLInputElement;
    el.value = String(to);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };

  it('while paused, calls onday with the input value', async () => {
    const { onday } = await setup();
    const to = dayFromUtc(2033, 6, 12);
    drag(to);
    expect(onday).toHaveBeenCalledTimes(1);
    expect(onday).toHaveBeenCalledWith(to);
    expect(stateText()).toBe(`${to}|false|year`);
  });

  it('while playing, pauses first', async () => {
    const { q, onday } = await setup({ startPlaying: true });
    const to = dayFromUtc(2040, 2, 3);
    drag(to);
    expect(stateText()).toBe(`${to}|false|year`);
    expect(onday).toHaveBeenCalledWith(to);
    expect(q.pending()).toBe(0);
  });
});

describe('reflow and targets', () => {
  it('reports its height', async () => {
    const onheight = vi.fn();
    await setup({ onheight });
    await expect.poll(() => onheight.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
    const root = page.getByTestId('fzp-scrubber').element() as HTMLElement;
    expect(onheight.mock.calls.at(-1)![0]).toBe(root.offsetHeight);
  });

  it('375 px: no horizontal scroll, every control at least 24x24, controls above the track', async () => {
    await page.viewport(375, 812);
    const q = manualRaf();
    await render(TimeScrubberHarness, {
      props: { asOf: ASOF, horizon: HORIZON, markers: MARKERS, raf: q.raf, cancelRaf: q.cancelRaf }
    });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    const controls = [
      ...page.getByTestId('fzp-scrubber').element().querySelectorAll('button, select, input')
    ];
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const c of controls) {
      const r = c.getBoundingClientRect();
      expect(r.width, c.outerHTML).toBeGreaterThanOrEqual(24);
      expect(r.height, c.outerHTML).toBeGreaterThanOrEqual(24);
    }
    const play = page.getByRole('button', { name: 'Play' }).element().getBoundingClientRect();
    const track = slider().element().getBoundingClientRect();
    expect(track.top).toBeGreaterThanOrEqual(play.bottom);
  });

  it('1280 px: one row, the track beside the controls', async () => {
    await setup();
    const play = page.getByRole('button', { name: 'Play' }).element().getBoundingClientRect();
    const track = slider().element().getBoundingClientRect();
    expect(track.left).toBeGreaterThanOrEqual(play.right);
    expect(Math.abs(track.top + track.height / 2 - (play.top + play.height / 2))).toBeLessThan(
      play.height
    );
  });

  it('the Speed label is visible from 640 px and screen-reader-only below', async () => {
    await setup();
    await expect.element(page.getByText('Speed', { exact: true })).toBeVisible();
    await page.viewport(500, 800);
    const label = page.getByText('Speed', { exact: true }).element().getBoundingClientRect();
    expect(label.width).toBeLessThanOrEqual(1);
  });
});
