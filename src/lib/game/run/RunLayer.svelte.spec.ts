/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp } from 'vitest/browser';
import { flushSync, type ComponentProps } from 'svelte';
import axe from 'axe-core';
import '../../../routes/layout.css';
import { BASE_HANDS } from '../limits';
import type { RunTake } from '../run-result';
import type { Sound } from './sound';
import { runOverText } from './words';
import RunLayer from './RunLayer.svelte';
import { FakeFeed } from './test/fake-feed.svelte';

const clock = vi.hoisted(() => ({
  t: 1000,
  next: 1,
  asked: 0,
  pending: new Map<number, FrameRequestCallback>()
}));

vi.mock('./clock', async (orig) => ({
  ...(await orig<typeof import('./clock')>()),
  now: () => clock.t,
  raf: (cb: FrameRequestCallback) => {
    const h = clock.next++;
    clock.pending.set(h, cb);
    clock.asked++;
    return h;
  },
  cancelRaf: (h: number) => {
    clock.pending.delete(h);
  }
}));

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

const motion = (value: 'reduce' | 'no-preference') =>
  cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }]
  });

/** Runs the pending frame callbacks after moving the clock `ms` on. */
function frame(ms = 16): void {
  flushSync();
  clock.t += ms;
  const cbs = [...clock.pending.values()];
  clock.pending.clear();
  for (const cb of cbs) cb(clock.t);
  flushSync();
}

interface Recording extends Sound {
  calls: { pop: number; collect: number; goal: number; buy: number };
}

function recording(): Recording {
  const calls = { pop: 0, collect: 0, goal: 0, buy: 0 };
  return {
    calls,
    pop: () => void calls.pop++,
    collect: () => void calls.collect++,
    goal: () => void calls.goal++,
    buy: () => void calls.buy++
  };
}

type Props = ComponentProps<typeof RunLayer>;

async function mount(over: Partial<Props> = {}) {
  const box = document.createElement('div');
  box.style.cssText = 'position:relative;width:800px;height:600px';
  const map = document.createElement('div');
  map.dataset.testid = 'map';
  map.style.cssText = 'position:absolute;inset:0';
  box.appendChild(map);
  document.body.appendChild(box);
  const feed = new FakeFeed({ w: 800, h: 600 });
  const sound = recording();
  const ontake = vi.fn<(t: RunTake) => void>();
  const screen = await render(RunLayer, {
    target: box,
    props: { feed, hands: BASE_HANDS, collectForMe: false, sound, ontake, ...over }
  });
  const root = box.querySelector<HTMLElement>('[data-testid="run-layer"]')!;
  const canvas = root.querySelector('canvas')!;
  const live = box.querySelector<HTMLElement>('[data-testid="run-live"]')!;
  await expect.poll(() => canvas.width).toBe(Math.round(800 * Math.min(devicePixelRatio, 2)));
  return { box, map, feed, sound, ontake, screen, root, canvas, live };
}

function start(feed: FakeFeed): void {
  feed.running = true;
  frame();
}

const lastTake = (ontake: ReturnType<typeof vi.fn>) => ontake.mock.calls.at(-1)?.[0] as RunTake;

beforeEach(() => {
  clock.t = 1000;
  clock.pending.clear();
  clock.asked = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await motion('reduce');
});

describe('RunLayer', () => {
  it('running and day past drops call ontake with the dropped totals and set data-dropped', async () => {
    const { feed, ontake, root } = await mount();
    feed.drops = [feed.dropAt(1, 100, 100, 10, 3), feed.dropAt(2, 700, 500, 20, 5)];
    start(feed);
    expect(root.dataset.state).toBe('running');
    expect(root.dataset.dropped).toBe('0');
    feed.day = 15;
    frame();
    expect(lastTake(ontake)).toEqual({ dropped: { home: 3 }, collected: {} });
    expect(root.dataset.dropped).toBe('3');
    expect(root.dataset.collected).toBe('0');
    feed.day = 25;
    frame();
    expect(lastTake(ontake)).toEqual({ dropped: { home: 8 }, collected: {} });
    expect(root.dataset.dropped).toBe('8');
  });

  it('with collectForMe every drop is collected as it appears and no ring is drawn', async () => {
    const arc = vi.spyOn(CanvasRenderingContext2D.prototype, 'arc');
    const { feed, ontake, root } = await mount({ collectForMe: true });
    feed.drops = [feed.dropAt(1, 100, 100, 10, 2), feed.dropAt(2, 700, 500, 20, 4)];
    start(feed);
    feed.day = 15;
    frame();
    expect(lastTake(ontake)).toEqual({ dropped: { home: 2 }, collected: { home: 2 } });
    feed.day = 25;
    frame();
    frame();
    expect(root.dataset.dropped).toBe('6');
    expect(root.dataset.collected).toBe('6');
    expect(arc.mock.calls.some((c) => c[2] === BASE_HANDS.radiusPx)).toBe(false);
  });

  it('collectForMe set true mid-run collects every live drop on the next frame; false shows the ring', async () => {
    const arc = vi.spyOn(CanvasRenderingContext2D.prototype, 'arc');
    const ringDrawn = () => arc.mock.calls.some((c) => c[2] === BASE_HANDS.radiusPx);
    const { feed, root, screen } = await mount();
    feed.drops = [feed.dropAt(1, 100, 100, 10, 2), feed.dropAt(2, 700, 500, 10, 4)];
    start(feed);
    feed.day = 15;
    frame();
    expect(root.dataset.dropped).toBe('6');
    expect(root.dataset.collected).toBe('0');
    expect(ringDrawn()).toBe(true);
    await screen.rerender({ collectForMe: true });
    arc.mockClear();
    frame();
    expect(root.dataset.collected).toBe('6');
    expect(ringDrawn()).toBe(false);
    await screen.rerender({ collectForMe: false });
    frame();
    expect(ringDrawn()).toBe(true);
  });

  it('replacing feed.drops mid-run counts no row twice and lowers neither data attribute', async () => {
    const { feed, ontake, root } = await mount();
    const a = feed.dropAt(1, 100, 100, 10);
    const b = feed.dropAt(2, 400, 300, 20);
    const c = feed.dropAt(3, 700, 500, 30);
    feed.drops = [a, b, c];
    start(feed);
    feed.day = 25;
    frame();
    expect(root.dataset.dropped).toBe('2');
    expect(root.dataset.collected).toBe('1');
    // Row 1 leaves, row 2 (shown and collected) moves later, row 3 moves before the day.
    feed.drops = [
      { ...c, day: 22 },
      { ...b, day: 40 }
    ];
    frame();
    expect(root.dataset.dropped).toBe('3');
    expect(root.dataset.collected).toBe('1');
    feed.day = 45;
    frame();
    frame();
    expect(root.dataset.dropped).toBe('3');
    expect(root.dataset.collected).toBe('1');
    const dropped = ontake.mock.calls.map(([t]) => t.dropped.home ?? 0);
    const collected = ontake.mock.calls.map(([t]) => t.collected.home ?? 0);
    expect(dropped).toEqual([...dropped].sort((x, y) => x - y));
    expect(collected).toEqual([...collected].sort((x, y) => x - y));
    expect(dropped.at(-1)).toBe(3);
  });

  it('running false calls ontake once and sets run-live to runOverText; the next start empties it', async () => {
    const { feed, ontake, live } = await mount();
    feed.drops = [feed.dropAt(1, 100, 100, 10, 2), feed.dropAt(2, 400, 300, 20, 5)];
    start(feed);
    feed.day = 25;
    frame();
    expect(live.textContent).toBe('');
    const before = ontake.mock.calls.length;
    feed.running = false;
    frame();
    frame();
    frame();
    expect(ontake.mock.calls.length).toBe(before + 1);
    const take = lastTake(ontake);
    expect(take).toEqual({ dropped: { home: 7 }, collected: { home: 5 } });
    expect(live.textContent).toBe(runOverText(take));
    expect(live.textContent).toBe('Run over. 5 of 7 homes collected.');
    feed.day = 0;
    start(feed);
    expect(live.textContent).toBe('');
  });

  it('a new run sends the zero take once when the last take sent was not zero', async () => {
    const { feed, ontake, root } = await mount();
    start(feed);
    frame();
    expect(ontake).not.toHaveBeenCalled();
    feed.drops = [feed.dropAt(1, 100, 100, 10, 2), feed.dropAt(2, 400, 300, 20, 5)];
    feed.day = 25;
    frame();
    feed.running = false;
    frame();
    expect(root.dataset.dropped).toBe('7');
    expect(root.dataset.collected).toBe('5');
    const before = ontake.mock.calls.length;
    feed.day = 0;
    start(feed);
    expect(ontake.mock.calls.length).toBe(before + 1);
    expect(lastTake(ontake)).toEqual({ dropped: {}, collected: {} });
    expect(root.dataset.dropped).toBe('0');
    expect(root.dataset.collected).toBe('0');
    frame();
    frame();
    expect(ontake.mock.calls.length).toBe(before + 1);
  });

  it('calls sound.collect once for a frame that collects, else sound.pop once if any appeared', async () => {
    const { feed, sound } = await mount();
    feed.drops = [
      feed.dropAt(1, 100, 100, 10),
      feed.dropAt(2, 120, 100, 10),
      feed.dropAt(3, 400, 300, 20),
      feed.dropAt(4, 700, 500, 20)
    ];
    start(feed);
    feed.day = 15;
    frame();
    expect(sound.calls).toEqual({ pop: 1, collect: 0, goal: 0, buy: 0 });
    feed.day = 25;
    frame();
    expect(sound.calls).toEqual({ pop: 1, collect: 1, goal: 0, buy: 0 });
    frame();
    expect(sound.calls).toEqual({ pop: 1, collect: 1, goal: 0, buy: 0 });
  });

  it('the element under the map box centre is not the canvas', async () => {
    const { feed, box, map, canvas } = await mount();
    start(feed);
    await expect.poll(() => getComputedStyle(canvas).visibility).toBe('visible');
    const r = box.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(hit).not.toBe(canvas);
    expect(hit).toBe(map);
  });

  it('once idle the loop asks for no further frame and the canvas is hidden', async () => {
    const { feed, canvas, root } = await mount();
    expect(getComputedStyle(canvas).visibility).toBe('hidden');
    feed.drops = [feed.dropAt(1, 100, 100, 10)];
    start(feed);
    expect(getComputedStyle(canvas).visibility).toBe('visible');
    feed.day = 15;
    frame();
    feed.running = false;
    frame();
    expect(root.dataset.state).toBe('idle');
    expect(clock.pending.size).toBe(0);
    const asked = clock.asked;
    frame();
    expect(clock.asked).toBe(asked);
    expect(getComputedStyle(canvas).visibility).toBe('hidden');
  });

  it('a resize sets the backing store to the box times the pixel ratio, capped at 2', async () => {
    const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      const { box, canvas } = await mount();
      expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
      box.style.width = '400px';
      box.style.height = '300px';
      await expect.poll(() => [canvas.width, canvas.height]).toEqual([800, 600]);
    } finally {
      if (own) Object.defineProperty(window, 'devicePixelRatio', own);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });

  it('no events reach the feed: its fields are unchanged by the layer', async () => {
    const { feed } = await mount();
    const drops = [feed.dropAt(1, 100, 100, 10), feed.dropAt(2, 400, 300, 20)];
    const copy = structuredClone(drops);
    feed.drops = drops;
    start(feed);
    feed.day = 25;
    frame();
    frame();
    expect(feed.drops).toBe(drops);
    expect(feed.drops).toEqual(copy);
    expect(feed.day).toBe(25);
    expect(feed.running).toBe(true);
    feed.running = false;
    frame();
    expect(feed.drops).toBe(drops);
    expect(feed.day).toBe(25);
    expect(feed.running).toBe(false);
  });

  it('axe finds no WCAG 2.2 AA violation during and after a run; canvas aria-hidden; live region polite', async () => {
    const { feed, box, canvas, live } = await mount();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(live.getAttribute('aria-live')).toBe('polite');
    feed.drops = [feed.dropAt(1, 100, 100, 10)];
    start(feed);
    feed.day = 15;
    frame();
    const during = await axe.run(box, { runOnly: TAGS });
    expect(during.violations).toEqual([]);
    feed.running = false;
    frame();
    expect(live.textContent).not.toBe('');
    const after = await axe.run(box, { runOnly: TAGS });
    expect(after.violations).toEqual([]);
  });

  it('with reduce, a frame with nothing new draws nothing; with no-preference a new drop draws over frames', async () => {
    const clear = vi.spyOn(CanvasRenderingContext2D.prototype, 'clearRect');
    await motion('reduce');
    const a = await mount();
    a.feed.drops = [a.feed.dropAt(1, 100, 100, 10), a.feed.dropAt(2, 700, 500, 100)];
    start(a.feed);
    a.feed.day = 15;
    frame();
    expect(clear).toHaveBeenCalled();
    clear.mockClear();
    frame();
    frame();
    expect(clear).not.toHaveBeenCalled();
    a.feed.running = false;
    frame();
    a.screen.unmount();

    await motion('no-preference');
    const b = await mount();
    b.feed.drops = [b.feed.dropAt(1, 100, 100, 10)];
    start(b.feed);
    frame();
    b.feed.day = 15;
    frame();
    clear.mockClear();
    let drawn = 0;
    for (let k = 0; k < 4; k++) {
      const n = clear.mock.calls.length;
      frame();
      if (clear.mock.calls.length > n) drawn++;
    }
    expect(drawn).toBe(4);
  });
});
