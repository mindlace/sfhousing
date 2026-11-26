<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Hands } from '../limits';
  import type { RunTake } from '../run-result';
  import { total } from '../units';
  import { cancelRaf, now, raf, reducedMotion } from './clock';
  import { DRAW, drawRun, policyColour, type Look } from './draw';
  import type { RunFeed } from './drops';
  import {
    createRun,
    idle,
    nudgeRing,
    pointRing,
    reproject,
    RING_KEY_DIR,
    RING_KEYS,
    setBox,
    step,
    type Pt
  } from './run-model';
  import type { Sound } from './sound';
  import { runOverText } from './words';

  interface RunLayerProps {
    feed: RunFeed;
    hands: Hands;
    collectForMe: boolean;
    sound: Sound;
    ontake(t: RunTake): void;
  }

  let { feed, hands, collectForMe, sound, ontake }: RunLayerProps = $props();

  let canvas: HTMLCanvasElement;
  let running = $state(false);
  let shown = $state(false);
  let dropped = $state(0);
  let collected = $state(0);
  let said = $state('');

  const m = createRun();
  const project = (lng: number, lat: number): Pt | null => feed.project(lng, lat);
  let ctx: CanvasRenderingContext2D | null = null;
  let look: Look = { accent: '', policy: '', ink: '', surface: '', font: 'sans-serif' };
  let handle: number | null = null;
  /** The canvas box's top left in client pixels; pointer input reads it. */
  let origin: Pt = { x: 0, y: 0 };
  /**
   * Whether the last pointer point was outside the box, or a run has started since the last
   * one: the next inside move is fresh.
   */
  let out = false;
  /** Whether the last drawn frame showed the ring. */
  let drewRing = false;

  function readOrigin(): void {
    const r = canvas.getBoundingClientRect();
    origin = { x: r.left, y: r.top };
  }

  function paint(t: number, reduced: boolean, auto: boolean): void {
    if (!ctx) return;
    drewRing = m.running && !auto;
    drawRun(ctx, m, { now: t, look, reduced, radiusPx: hands.radiusPx, showRing: drewRing });
  }

  function send(): void {
    const take: RunTake = { dropped: { ...m.take.dropped }, collected: { ...m.take.collected } };
    dropped = total(take.dropped);
    collected = total(take.collected);
    ontake(take);
  }

  function frame(): void {
    handle = null;
    const t = now();
    const reduced = reducedMotion();
    const auto = collectForMe || hands.auto;
    const r = step(m, {
      now: t,
      running: feed.running,
      day: feed.day,
      drops: feed.drops,
      hands,
      auto,
      reduced,
      project
    });
    // The ring starts at the centre: the run's first pointer move inside jumps, sweeping nothing.
    if (r.started) out = true;
    if (r.collected > 0) sound.collect();
    else if (r.appeared > 0) sound.pop();
    // A start zeroes the take: that is a change only when the last take sent was not zero.
    const zeroed = r.started && (dropped !== 0 || collected !== 0);
    if (r.appeared > 0 || r.collected > 0 || r.ended || zeroed) send();
    if (r.ended) said = runOverText(m.take);
    running = m.running;
    if (r.dirty || drewRing !== (m.running && !auto)) paint(t, reduced, auto);
    if (m.running || !idle(m)) {
      handle = raf(frame);
    } else {
      ctx?.clearRect(0, 0, m.box.w, m.box.h);
      drewRing = false;
      shown = false;
    }
  }

  function startLoop(): void {
    said = '';
    shown = true;
    readOrigin();
    if (handle === null) handle = raf(frame);
  }

  function resize(): void {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, DRAW.maxDpr);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    setBox(m, r.width, r.height);
    reproject(m, project);
    origin = { x: r.left, y: r.top };
    paint(now(), reducedMotion(), collectForMe || hands.auto);
  }

  /** Moves the ring to a pointer point while running; never starts the loop. */
  function onPointer(e: PointerEvent): void {
    if (!m.running) return;
    const x = e.clientX - origin.x;
    const y = e.clientY - origin.y;
    const { w, h } = m.box;
    if (w <= 0 || h <= 0 || x < 0 || x > w || y < 0 || y > h) {
      out = true;
      return;
    }
    pointRing(m, { x, y }, e.type === 'pointerdown' || out);
    out = false;
  }

  const KEY_WIDGETS =
    '[role=slider],[role=menu],[role=menubar],[role=listbox],[role=radiogroup],' +
    '[role=tablist],[role=tree],[role=grid]';

  function keyIgnored(e: KeyboardEvent): boolean {
    if (!m.running || collectForMe || hands.auto || e.defaultPrevented) return true;
    if (e.altKey || e.ctrlKey || e.metaKey) return true;
    const t = e.target;
    if (!(t instanceof Element)) return false;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return true;
    if (t instanceof HTMLSelectElement) return true;
    if (t instanceof HTMLElement && t.isContentEditable) return true;
    return t.closest(KEY_WIDGETS) !== null;
  }

  /** Steps the ring by an arrow key while running; never starts the loop. */
  function onKey(e: KeyboardEvent): void {
    const dir = RING_KEY_DIR[e.key];
    if (!dir || keyIgnored(e)) return;
    const px = e.shiftKey ? RING_KEYS.shiftStepPx : RING_KEYS.stepPx;
    nudgeRing(m, dir[0] * px, dir[1] * px);
    e.preventDefault();
  }

  function readLook(dark: boolean): void {
    const root = getComputedStyle(document.documentElement);
    const token = (name: string) => root.getPropertyValue(`--color-${name}${dark ? '-dark' : ''}`);
    look = {
      accent: token('accent').trim(),
      policy: policyColour(dark),
      ink: token('ink').trim(),
      surface: token('surface').trim(),
      font: getComputedStyle(canvas).fontFamily || 'sans-serif'
    };
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    const darkQuery = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      readLook(darkQuery.matches);
      paint(now(), reducedMotion(), collectForMe || hands.auto);
    };
    readLook(darkQuery.matches);
    darkQuery.addEventListener('change', onScheme);

    let dprQuery: MediaQueryList | null = null;
    const onDpr = () => {
      watchDpr();
      resize();
    };
    function watchDpr(): void {
      dprQuery?.removeEventListener('change', onDpr);
      dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    }
    watchDpr();

    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    const onScroll = () => readOrigin();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    // The mouse leaving the window: its return elsewhere starts a fresh path, not a sweep.
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) out = true;
    };
    window.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      if (handle !== null) cancelRaf(handle);
      handle = null;
      observer.disconnect();
      darkQuery.removeEventListener('change', onScheme);
      dprQuery?.removeEventListener('change', onDpr);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  });

  $effect(() => {
    if (feed.running) untrack(startLoop);
  });
</script>

<div
  class="pointer-events-none absolute inset-0 z-10"
  data-testid="run-layer"
  data-state={running ? 'running' : 'idle'}
  data-dropped={dropped}
  data-collected={collected}
>
  <canvas
    bind:this={canvas}
    aria-hidden="true"
    class="block h-full w-full"
    style:visibility={shown ? 'visible' : 'hidden'}
  ></canvas>
  <p class="sr-only" aria-live="polite" data-testid="run-live">{said}</p>
</div>
