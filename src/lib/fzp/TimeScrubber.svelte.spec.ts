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
const todayCalls = () => Number(page.getByTestId('today-calls').element().textContent);
const play = () => page.getByTestId('fzp-play');
const faster = () => page.getByTestId('fzp-faster');
const pause = () => page.getByTestId('fzp-pause');

async function setup(props: Partial<HarnessProps> = {}) {
  await page.viewport(1280, 800);
  const q = manualRaf();
  const onday = vi.fn();
  const view = await render(TimeScrubberHarness, {
    props: {
      asOf: ASOF,
      horizon: HORIZON,
      markers: MARKERS,
      onday,
      raf: q.raf,
      cancelRaf: q.cancelRaf,
      ...props
    }
  });
  return { q, onday, unmount: view.unmount };
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

describe('ontoday', () => {
  const from = dayFromUtc(2026, 10, 20);

  it('Home, the start marker and an arrow clamped to asOf call ontoday once each', async () => {
    const first = await setup({ startDay: dayFromUtc(2030, 5, 5) });
    slider().element().focus();
    await userEvent.keyboard('{Home}');
    expect(todayCalls()).toBe(1);
    first.unmount();

    const second = await setup({ startDay: dayFromUtc(2030, 5, 5) });
    await page.getByTestId('fzp-start').click();
    expect(todayCalls()).toBe(1);
    expect(stateDay()).toBe(ASOF);
    second.unmount();

    // ArrowLeft from 2026-10-20: the previous month start is before asOf, so it clamps.
    const third = await setup({ startDay: from });
    slider().element().focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(stateDay()).toBe(ASOF);
    expect(todayCalls()).toBe(1);
    third.unmount();

    // PageDown clamps the same way.
    await setup({ startDay: dayFromUtc(2027, 3, 17) });
    slider().element().focus();
    await userEvent.keyboard('{PageDown}');
    expect(todayCalls()).toBe(1);
  });

  it('keys that land elsewhere do not call ontoday', async () => {
    await setup({ startDay: dayFromUtc(2027, 3, 17) });
    slider().element().focus();
    await userEvent.keyboard('{ArrowRight}{End}');
    expect(todayCalls()).toBe(0);
  });

  it('a drag released at asOf calls ontoday; input events at asOf mid-drag do not', async () => {
    await setup({ startDay: dayFromUtc(2030, 1, 1) });
    const r = slider().element() as HTMLInputElement;
    r.value = String(ASOF);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(stateDay()).toBe(ASOF);
    expect(todayCalls()).toBe(0);
    r.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(todayCalls()).toBe(1);
  });

  it('a drag released after asOf does not call ontoday', async () => {
    await setup();
    const r = slider().element() as HTMLInputElement;
    r.value = String(ASOF + 400);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(todayCalls()).toBe(0);
  });

  it('Replay at the horizon restarts from asOf without calling ontoday', async () => {
    const { onday } = await setup({ startDay: HORIZON });
    await expect.element(page.getByTestId('fzp-play-label')).toHaveTextContent(/^Replay$/);
    await play().click();
    expect(stateText()).toBe(`${ASOF}|true|year`);
    expect(onday).toHaveBeenLastCalledWith(ASOF);
    expect(todayCalls()).toBe(0);
  });

  it('the frame loop never calls ontoday', async () => {
    const { q } = await setup({ startDay: ASOF + 1, startPlaying: true });
    q.frame(0);
    q.frame(100);
    expect(todayCalls()).toBe(0);
  });

  it('in setup ontoday never fires', async () => {
    await setup({ setup: true });
    const r = slider().element() as HTMLInputElement;
    r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(todayCalls()).toBe(0);
    await expect.element(page.getByTestId('fzp-start')).toBeDisabled();
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

  it('clamps a marker outside [asOf, horizon] to the range', async () => {
    const outside: Marker[] = [
      { day: ASOF - 400, label: 'Early', name: 'Jump early' },
      { day: HORIZON + 400, label: 'Late', name: 'Jump late' }
    ];
    const { onday } = await setup({ markers: outside, startDay: ASOF + 1000 });
    await page.getByRole('button', { name: 'Jump early' }).click();
    expect(onday).toHaveBeenLastCalledWith(ASOF);
    expect(stateDay()).toBe(ASOF);
    await page.getByRole('button', { name: 'Jump late' }).click();
    expect(onday).toHaveBeenLastCalledWith(HORIZON);
    expect(stateDay()).toBe(HORIZON);
    const left = (name: string) =>
      (page.getByRole('button', { name }).element() as HTMLElement).style.left;
    expect(left('Jump early')).toBe('0%');
    expect(left('Jump late')).toBe('100%');
  });

  it('the start marker shows startLabel; the end marker the horizon year', async () => {
    await setup();
    const start = page.getByTestId('fzp-start');
    await expect.element(start).toHaveTextContent(/^Oct 2026$/);
    await expect.element(start).toHaveAccessibleName('Jump to Oct 2026, October 2026');
    const end = page.getByTestId('fzp-end');
    await expect.element(end).toHaveTextContent(/^2050$/);
    await expect.element(end).toHaveAccessibleName('Jump to 2050');
  });

  it('startLabel replaces the start marker text and its name', async () => {
    await setup({ startLabel: 'Today' });
    const start = page.getByTestId('fzp-start');
    await expect.element(start).toHaveTextContent(/^Today$/);
    await expect.element(start).toHaveAccessibleName('Jump to Today, October 2026');
  });

  it('the end marker jumps to the horizon and pauses, without ontoday', async () => {
    const { onday } = await setup({ startPlaying: true });
    await page.getByTestId('fzp-end').click();
    expect(stateText()).toBe(`${HORIZON}|false|year`);
    expect(onday).toHaveBeenLastCalledWith(HORIZON);
    expect(todayCalls()).toBe(0);
  });
});

describe('readout', () => {
  it('shows the month alone, with no Simulation pill, and is not a live region', async () => {
    await setup({ startDay: dayFromUtc(2031, 3, 9) });
    const readout = page.getByTestId('fzp-readout');
    expect(readout.element().textContent).not.toMatch(/Simulation/);
    await expect.element(page.getByTestId('fzp-readout-label')).toHaveTextContent(/^March 2031$/);
    const el = readout.element();
    expect(el.closest('[aria-live]')).toBeNull();
    expect(el.querySelector('[aria-live]')).toBeNull();
    expect(el.getAttribute('role')).toBeNull();
  });

  it('hides the sizing copies from assistive tech', async () => {
    await setup({ startDay: dayFromUtc(2031, 3, 9) });
    const hidden = page.getByTestId('fzp-readout').element().querySelectorAll('[aria-hidden]');
    expect(hidden.length).toBeGreaterThanOrEqual(11);
    expect(
      page.getByTestId('fzp-readout-label').element().closest('[aria-hidden="true"]')
    ).toBeNull();
  });

  it('the play button and the readout keep their width across labels and months', async () => {
    const width = (id: string) => page.getByTestId(id).element().getBoundingClientRect().width;
    const first = await setup({ startDay: dayFromUtc(2027, 5, 1) });
    const w0 = width('fzp-play');
    const o0 = width('fzp-readout');
    first.unmount();
    const second = await setup({ startDay: dayFromUtc(2027, 9, 1), setup: true });
    await expect.element(page.getByTestId('fzp-play-label')).toHaveTextContent(/^Run$/);
    expect(width('fzp-play')).toBe(w0);
    expect(width('fzp-readout')).toBe(o0);
    second.unmount();
    await setup({ startDay: HORIZON });
    await expect.element(page.getByTestId('fzp-play-label')).toHaveTextContent(/^Replay$/);
    expect(width('fzp-play')).toBe(w0);
  });

  it('the readout keeps its width across years (2026 and 2040)', async () => {
    const width = () => page.getByTestId('fzp-readout').element().getBoundingClientRect().width;
    const first = await setup({ startDay: dayFromUtc(2026, 11, 1) });
    await expect.element(page.getByTestId('fzp-readout-label')).toHaveTextContent('November 2026');
    const w2026 = width();
    first.unmount();
    await setup({ startDay: dayFromUtc(2040, 11, 1) });
    await expect.element(page.getByTestId('fzp-readout-label')).toHaveTextContent('November 2040');
    expect(width()).toBe(w2026);
  });

  it('in setup Play reads Run, Pause and Faster are hidden, the track and markers are disabled', async () => {
    await setup({ setup: true });
    await expect.element(page.getByTestId('fzp-play-label')).toHaveTextContent(/^Run$/);
    for (const el of [pause(), faster()]) {
      const e = el.element() as HTMLElement;
      expect(getComputedStyle(e).visibility).toBe('hidden');
      expect(e.getBoundingClientRect().width).toBeGreaterThan(0);
    }
    expect(page.getByRole('button', { name: 'Pause' }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Faster' }).elements()).toHaveLength(0);
    await expect.element(slider()).toBeDisabled();
    await expect.element(page.getByTestId('fzp-start')).toBeDisabled();
    await expect.element(page.getByTestId('fzp-end')).toBeDisabled();
    for (const m of MARKERS) {
      await expect.element(page.getByRole('button', { name: m.name })).toBeDisabled();
    }
  });

  it('in setup the button runs and the track is disabled', async () => {
    const onrun = vi.fn();
    const { q } = await setup({ setup: true, onrun });
    await page.getByRole('button', { name: 'Run' }).click();
    expect(onrun).toHaveBeenCalledOnce();
    expect(q.pending()).toBe(0);
    await expect.element(slider()).toBeDisabled();
    for (const m of MARKERS) {
      await expect.element(page.getByRole('button', { name: m.name })).toBeDisabled();
    }
  });

  it('in setup Run takes the app accent; Play does not', async () => {
    await setup({ setup: true });
    const run = page.getByRole('button', { name: 'Run' }).element();
    expect(getComputedStyle(run).backgroundColor).toBe('rgb(163, 71, 44)');
    expect(getComputedStyle(run).color).toBe('rgb(255, 255, 255)');
    await setup();
    const play = page.getByRole('button', { name: 'Play' }).element();
    expect(getComputedStyle(play).backgroundColor).toBe('rgb(255, 255, 255)');
  });
});

describe('play, pause, replay', () => {
  it('Play starts the frame loop; Pause stops it', async () => {
    const { q } = await setup();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.element(play()).toHaveAttribute('aria-pressed', 'true');
    expect(q.pending()).toBe(1);
    await page.getByRole('button', { name: 'Pause' }).click();
    expect(q.pending()).toBe(0);
    await expect.element(play()).toHaveAttribute('aria-pressed', 'false');
    expect(stateText()).toBe(`${ASOF}|false|year`);
  });

  it('Play plays at 1 year/s, Faster at 3 years/s, Pause stops', async () => {
    await setup();
    await expect.element(play()).toHaveAttribute('aria-pressed', 'false');
    await expect.element(faster()).toHaveAttribute('aria-pressed', 'false');
    await faster().click();
    expect(stateText()).toBe(`${ASOF}|true|threeYears`);
    await expect.element(faster()).toHaveAttribute('aria-pressed', 'true');
    await expect.element(play()).toHaveAttribute('aria-pressed', 'false');
    await play().click();
    expect(stateText()).toBe(`${ASOF}|true|year`);
    await expect.element(play()).toHaveAttribute('aria-pressed', 'true');
    await expect.element(faster()).toHaveAttribute('aria-pressed', 'false');
    await pause().click();
    expect(stateText()).toBe(`${ASOF}|false|year`);
    await expect.element(play()).toHaveAttribute('aria-pressed', 'false');
    await expect.element(faster()).toHaveAttribute('aria-pressed', 'false');
  });

  it('Faster has the accessible name Faster and a title naming 3 years per second', async () => {
    await setup();
    await expect.element(faster()).toHaveAccessibleName('Faster');
    await expect.element(faster()).toHaveAttribute('title', '3 years per second');
    await expect.element(pause()).toHaveAccessibleName('Pause');
  });

  it('Faster at the horizon restarts from asOf at 3 years/s', async () => {
    await setup({ startDay: HORIZON });
    await faster().click();
    expect(stateText()).toBe(`${ASOF}|true|threeYears`);
    expect(todayCalls()).toBe(0);
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
  it('there is no speed select', async () => {
    await setup();
    expect(page.getByRole('combobox').elements()).toHaveLength(0);
  });

  it('Faster changes the advance per frame', async () => {
    const { q } = await setup({ startPlaying: true });
    await faster().click();
    expect(stateText()).toBe(`${ASOF}|true|threeYears`);
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBe(Math.floor(ASOF + 0.1 * 36 * MONTH_DAYS));
  });

  it('Play after Faster returns to 1 year/s', async () => {
    const { q } = await setup();
    await faster().click();
    await play().click();
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBe(Math.floor(ASOF + 0.1 * 12 * MONTH_DAYS));
  });
});

describe('playback start', () => {
  it('does not play on mount, even without reduced motion', async () => {
    const { q, onday } = await setup();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await expect.element(page.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(q.pending()).toBe(0);
    q.frame(0);
    q.frame(100);
    expect(stateText()).toBe(`${ASOF}|false|year`);
    expect(onday).not.toHaveBeenCalled();
  });

  it('plays when Play is pressed', async () => {
    const { q } = await setup();
    await page.getByRole('button', { name: 'Play' }).click();
    expect(q.pending()).toBe(1);
    q.frame(0);
    q.frame(100);
    expect(stateDay()).toBeGreaterThan(ASOF);
  });

  it('unmounting while playing cancels the pending frame', async () => {
    const { q, unmount } = await setup({ startPlaying: true });
    expect(q.pending()).toBe(1);
    unmount();
    expect(q.pending()).toBe(0);
  });
});

describe('per frame work', () => {
  it('setTime called at most once per frame: onday fires only when the day changed', async () => {
    const { q, onday } = await setup({ startPlaying: true });
    await faster().click();
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
    q.frame(0);
    q.frame(1); // 1 ms at about 365 days/s is 0.37 day
    expect(onday).not.toHaveBeenCalled();
    expect(stateText()).toBe(`${ASOF}|true|year`);
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

  it('the transport order is Pause, Play, Faster, then the readout', async () => {
    await setup();
    const x = (id: string) => page.getByTestId(id).element().getBoundingClientRect().left;
    expect(x('fzp-pause')).toBeLessThan(x('fzp-play'));
    expect(x('fzp-play')).toBeLessThan(x('fzp-faster'));
    expect(x('fzp-faster')).toBeLessThan(x('fzp-readout'));
  });

  it('the bar keeps its height and the readout its place between setup and run', async () => {
    const first = await setup({ setup: true });
    const h0 = page.getByTestId('fzp-scrubber').element().getBoundingClientRect().height;
    const x0 = page.getByTestId('fzp-readout').element().getBoundingClientRect().left;
    first.unmount();
    await setup();
    expect(page.getByTestId('fzp-scrubber').element().getBoundingClientRect().height).toBe(h0);
    expect(page.getByTestId('fzp-readout').element().getBoundingClientRect().left).toBe(x0);
  });
});

describe('control contrast (WCAG 1.4.11)', () => {
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('the Pause, Play and Faster button borders are at least 3:1 against white', async () => {
    await setup();
    const white = luminance([255, 255, 255]);
    for (const el of [pause().element(), play().element(), faster().element()]) {
      const rgb = getComputedStyle(el).borderTopColor.match(/\d+/g)!.slice(0, 3).map(Number);
      expect((white + 0.05) / (luminance(rgb) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });
});
