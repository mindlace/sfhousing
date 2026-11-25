<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Hands } from '../limits';
  import type { RunTake } from '../run-result';
  import { total } from '../units';
  import { cancelRaf, now, raf, reducedMotion } from './clock';
  import { DRAW, drawRun, policyColour, type Look } from './draw';
  import type { RunFeed } from './drops';
  import { createRun, idle, reproject, setBox, step, type Pt } from './run-model';
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
  /** The canvas box's top left in client pixels; the pointer input (Task 9) reads it. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let origin: Pt = { x: 0, y: 0 };
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
    if (r.collected > 0) sound.collect();
    else if (r.appeared > 0) sound.pop();
    if (r.appeared > 0 || r.collected > 0 || r.ended) send();
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

    return () => {
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
