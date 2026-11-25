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

/** Dispatches a pointer event on `on` at (x, y) in the box's own pixels. */
function point(
  box: HTMLElement,
  on: EventTarget,
  type: 'pointermove' | 'pointerdown',
  x: number,
  y: number,
  pointerType = 'mouse'
): void {
  const r = box.getBoundingClientRect();
  on.dispatchEvent(
    new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerType, bubbles: true })
  );
}

/** Dispatches a cancelable keydown on `target` and returns it. */
function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/** Spies on arc; `ring()` is the centre of the last ring drawn (radius BASE_HANDS.radiusPx). */
function ringSpy() {
  const arc = vi.spyOn(CanvasRenderingContext2D.prototype, 'arc');
  return () => {
    const c = arc.mock.calls.filter((a) => a[2] === BASE_HANDS.radiusPx).at(-1);
    return c ? [c[0], c[1]] : null;
  };
}

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

  describe('input', () => {
    it('a mouse pointermove over a drop collects it; data-collected and ontake follow', async () => {
      const { box, map, feed, ontake, root, sound } = await mount();
      feed.drops = [feed.dropAt(1, 100, 100, 10, 3)];
      start(feed);
      feed.day = 15;
      frame();
      expect(root.dataset.collected).toBe('0');
      point(box, map, 'pointermove', 100, 100);
      frame();
      expect(root.dataset.collected).toBe('3');
      expect(lastTake(ontake)).toEqual({ dropped: { home: 3 }, collected: { home: 3 } });
      expect(sound.calls.collect).toBe(1);
    });

    it('a touch pointerdown then pointermove collects a drop under the drag', async () => {
      const { box, map, feed, root } = await mount();
      feed.drops = [feed.dropAt(1, 400, 100, 10, 2)];
      start(feed);
      feed.day = 15;
      frame();
      expect(root.dataset.collected).toBe('0');
      point(box, map, 'pointerdown', 100, 100, 'touch');
      point(box, map, 'pointermove', 700, 100, 'touch');
      frame();
      expect(root.dataset.collected).toBe('2');
    });

    it('a touch elsewhere does not sweep the ground between', async () => {
      const { box, map, feed, root } = await mount();
      feed.drops = [feed.dropAt(1, 400, 100, 10, 2)];
      start(feed);
      feed.day = 15;
      frame();
      point(box, map, 'pointerdown', 100, 100, 'touch');
      point(box, map, 'pointerdown', 700, 100, 'touch');
      frame();
      expect(root.dataset.collected).toBe('0');
    });

    it('a pen pointermove moves the ring as a mouse does', async () => {
      const ring = ringSpy();
      const { box, map, feed, root } = await mount();
      feed.drops = [feed.dropAt(1, 600, 450, 10)];
      start(feed);
      expect(ring()).toEqual([400, 300]);
      point(box, map, 'pointermove', 250, 150, 'pen');
      frame();
      expect(ring()).toEqual([250, 150]);
      point(box, map, 'pointermove', 600, 450, 'pen');
      feed.day = 15;
      frame();
      expect(ring()).toEqual([600, 450]);
      expect(root.dataset.collected).toBe('1');
    });

    it('the first move back inside after leaving the box starts a fresh path', async () => {
      const { box, map, feed, root } = await mount();
      feed.drops = [feed.dropAt(1, 400, 100, 10, 2)];
      start(feed);
      feed.day = 15;
      frame();
      point(box, map, 'pointermove', 100, 100);
      point(box, map, 'pointermove', -50, 100);
      point(box, map, 'pointermove', 700, 100);
      frame();
      expect(root.dataset.collected).toBe('0');
      // A move inside after that one sweeps again.
      point(box, map, 'pointermove', 100, 100);
      frame();
      expect(root.dataset.collected).toBe('2');
    });

    it("with a mouse resting over the map, a run's first pointermove sweeps nothing from the centre", async () => {
      const ring = ringSpy();
      const { box, map, feed, root } = await mount();
      point(box, map, 'pointermove', 700, 100);
      // On the line from the centre (400, 300) to (700, 100), 180 px from either end.
      feed.drops = [feed.dropAt(1, 550, 200, 10, 2)];
      start(feed);
      feed.day = 15;
      frame();
      expect(root.dataset.dropped).toBe('2');
      point(box, map, 'pointermove', 700, 100);
      frame();
      expect(ring()).toEqual([700, 100]);
      expect(root.dataset.collected).toBe('0');
      // A later move sweeps.
      point(box, map, 'pointermove', 400, 300);
      frame();
      expect(root.dataset.collected).toBe('2');
    });

    it('pointer events while not running move nothing', async () => {
      await motion('reduce');
      const ring = ringSpy();
      const { box, map, feed, root, ontake } = await mount();
      point(box, map, 'pointermove', 100, 100);
      point(box, map, 'pointerdown', 100, 100, 'touch');
      expect(key(document.body, { key: 'ArrowRight' }).defaultPrevented).toBe(false);
      expect(clock.asked).toBe(0);
      expect(ring()).toBeNull();

      feed.drops = [feed.dropAt(1, 100, 100, 10)];
      start(feed);
      expect(ring()).toEqual([400, 300]);
      feed.day = 15;
      frame();
      feed.running = false;
      frame();
      expect(root.dataset.state).toBe('idle');
      expect(clock.pending.size).toBe(0);
      const asked = clock.asked;
      const takes = ontake.mock.calls.length;
      point(box, map, 'pointermove', 100, 100);
      point(box, map, 'pointerdown', 100, 100, 'pen');
      expect(key(document.body, { key: 'ArrowRight' }).defaultPrevented).toBe(false);
      frame();
      expect(clock.asked).toBe(asked);
      expect(ontake.mock.calls.length).toBe(takes);
      expect(root.dataset.collected).toBe('0');
      expect(ring()).toEqual([400, 300]);
    });

    it('ArrowRight moves the ring 16 px and Shift+ArrowRight 64 px, each prevented', async () => {
      const ring = ringSpy();
      const { feed } = await mount();
      start(feed);
      expect(ring()).toEqual([400, 300]);
      expect(key(document.body, { key: 'ArrowRight' }).defaultPrevented).toBe(true);
      frame();
      expect(ring()).toEqual([416, 300]);
      expect(key(document.body, { key: 'ArrowRight', shiftKey: true }).defaultPrevented).toBe(true);
      frame();
      expect(ring()).toEqual([480, 300]);
      expect(key(document.body, { key: 'ArrowUp' }).defaultPrevented).toBe(true);
      expect(key(document.body, { key: 'ArrowLeft', shiftKey: true }).defaultPrevented).toBe(true);
      frame();
      expect(ring()).toEqual([416, 284]);
      expect(key(document.body, { key: 'a' }).defaultPrevented).toBe(false);
    });

    it('an arrow key in an input, a contenteditable, or inside role=slider is left alone', async () => {
      const ring = ringSpy();
      const { box, feed } = await mount();
      const input = document.createElement('input');
      const area = document.createElement('textarea');
      const select = document.createElement('select');
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      box.appendChild(input);
      box.appendChild(area);
      box.appendChild(select);
      box.appendChild(editable);
      const targets: EventTarget[] = [input, area, select, editable];
      for (const role of [
        'slider',
        'menu',
        'menubar',
        'listbox',
        'radiogroup',
        'tablist',
        'tree',
        'grid'
      ]) {
        const widget = document.createElement('div');
        widget.setAttribute('role', role);
        const inner = document.createElement('span');
        widget.appendChild(inner);
        box.appendChild(widget);
        targets.push(inner);
      }
      start(feed);
      for (const t of targets) {
        expect(key(t, { key: 'ArrowRight' }).defaultPrevented).toBe(false);
        expect(key(t, { key: 'ArrowDown', shiftKey: true }).defaultPrevented).toBe(false);
      }
      frame();
      expect(ring()).toEqual([400, 300]);
    });

    it('arrow keys are left alone under auto, with Alt/Control/Meta, or when already prevented', async () => {
      const autoHands = { ...BASE_HANDS, auto: true };
      for (const over of [{ collectForMe: true }, { hands: autoHands }]) {
        const { feed, screen } = await mount(over);
        start(feed);
        expect(key(document.body, { key: 'ArrowRight' }).defaultPrevented).toBe(false);
        screen.unmount();
      }

      const ring = ringSpy();
      const { feed } = await mount();
      start(feed);
      for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        expect(key(document.body, { key: 'ArrowRight', ...mod }).defaultPrevented).toBe(false);
      }
      const prevent = (e: Event) => e.preventDefault();
      document.body.addEventListener('keydown', prevent);
      try {
        key(document.body, { key: 'ArrowRight' });
      } finally {
        document.body.removeEventListener('keydown', prevent);
      }
      frame();
      expect(ring()).toEqual([400, 300]);
    });

    it('unmounting mid-run: no further ontake, the frame is cancelled, a later arrow key is not prevented', async () => {
      const { box, map, feed, ontake, screen } = await mount();
      feed.drops = [feed.dropAt(1, 100, 100, 10), feed.dropAt(2, 700, 500, 20)];
      start(feed);
      feed.day = 15;
      frame();
      expect(ontake).toHaveBeenCalled();
      expect(clock.pending.size).toBe(1);
      const takes = ontake.mock.calls.length;
      screen.unmount();
      expect(clock.pending.size).toBe(0);
      feed.day = 25;
      point(box, map, 'pointermove', 700, 500);
      expect(key(document.body, { key: 'ArrowRight' }).defaultPrevented).toBe(false);
      frame();
      feed.running = false;
      frame();
      expect(ontake.mock.calls.length).toBe(takes);
      expect(clock.pending.size).toBe(0);
    });
  });
});
