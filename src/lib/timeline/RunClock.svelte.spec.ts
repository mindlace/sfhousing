import { flushSync } from 'svelte';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { formatShortMonthYear } from '$lib/fzp/format';
import { runRate } from '$lib/fzp/playback';
import type { Day } from '$lib/timelapse/time';
import RunClockHost, { type RunClockCtl } from './test/RunClockHost.svelte';

const A = fixtureCalibration().asOf;
const STOP = A + 3650;

/** A manual frame queue: the tests drive frames at 16 ms steps, no real timers. */
let queue = new Map<number, FrameRequestCallback>();
let nextHandle = 1;
let ts = 0;
const raf = (cb: FrameRequestCallback) => {
  const h = nextHandle++;
  queue.set(h, cb);
  return h;
};
const cancelRaf = (h: number) => {
  queue.delete(h);
};
function frames(ms: number) {
  for (let t = 0; t < ms; t += 16) {
    ts += 16;
    const cbs = [...queue.values()];
    queue.clear();
    for (const cb of cbs) cb(ts);
    flushSync();
  }
}

const clock = () => page.getByTestId('run-clock').element() as HTMLElement;

function mount(props: { end: Day; rate: number; onday?: (d: Day) => void }) {
  queue = new Map();
  ts = 0;
  const ctl: RunClockCtl = {};
  const view = render(RunClockHost, {
    props: { asOf: A, stop: STOP, ctl, raf, cancelRaf, ...props }
  });
  return {
    unmount: async () => (await view).unmount(),
    day: () => ctl.day!(),
    running: () => ctl.running!(),
    setEnd: (d: Day) => {
      ctl.setEnd!(d);
      flushSync();
    }
  };
}

it('reaches the stop day after 20 s of frames and turns running false', async () => {
  const h = mount({ end: STOP, rate: runRate(A, STOP) });
  frames(20_032);
  await expect.poll(() => h.day()).toBe(STOP);
  expect(h.running()).toBe(false);
  expect(clock().getAttribute('data-day')).toBe(String(STOP));
});

it('waits at an end before the stop with running true, and goes on when it grows', async () => {
  const h = mount({ end: A + 100, rate: runRate(A, STOP) });
  frames(2000);
  expect(h.day()).toBe(A + 100);
  expect(h.running()).toBe(true);
  h.setEnd(STOP);
  frames(20_032);
  await expect.poll(() => h.running()).toBe(false);
  expect(h.day()).toBe(STOP);
});

it('calls onday once per change', () => {
  const days: number[] = [];
  mount({ end: STOP, rate: runRate(A, STOP), onday: (d) => days.push(d) });
  frames(20_032);
  expect(days.length).toBeGreaterThan(0);
  expect(days.every((d, i) => i === 0 || d > days[i - 1])).toBe(true);
  expect(days.at(-1)).toBe(STOP);
});

it('cancels its pending frame when unmounted', async () => {
  const h = mount({ end: STOP, rate: runRate(A, STOP) });
  frames(64);
  expect(queue.size).toBe(1);
  await h.unmount();
  flushSync();
  expect(queue.size).toBe(0);
});

it('draws the month, hidden from assistive tech', () => {
  mount({ end: STOP, rate: runRate(A, STOP) });
  expect(clock().getAttribute('aria-hidden')).toBe('true');
  expect(clock().textContent).toContain(formatShortMonthYear(A));
});
