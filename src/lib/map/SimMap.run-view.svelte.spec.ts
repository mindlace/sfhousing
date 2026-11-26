import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Deck, Layer } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { CONSTRAINTS, RUN_BOUNDS, defaultFrame, runFrame } from './camera';
import { timelineLookups } from './fixtures/timeline-lookups';
import { packTimedCell } from './pack-timed';
import type { SimMapHandle, SimMapProps, TimelinePick, TimelineUpdate } from './types';

// The committed fixture dataset, served by Vitest's dev server (see SimMap.svelte.spec.ts).
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

let hosts: HTMLElement[] = [];
let errors: unknown[] = [];
const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
const onRejection = (e: PromiseRejectionEvent) => errors.push(e.reason);

beforeEach(() => {
  errors = [];
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
});

afterEach(() => {
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  for (const h of hosts) h.remove();
  hosts = [];
  vi.restoreAllMocks();
});

function host(width = 600, height = 400): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${width}px;height:${height}px`;
  document.body.appendChild(el);
  hosts.push(el);
  return el;
}

async function mount(props: Partial<SimMapProps> = {}, width = 600, height = 400) {
  const target = host(width, height);
  let resolveReady!: (h: SimMapHandle) => void;
  const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
  const onready = vi.fn((h: SimMapHandle) => resolveReady(h));
  const screen = await render(SimMap, { target, props: { manifest, onready, ...props } });
  const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
  return { target, screen, ready, onready, root };
}

async function mountReady(width = 600, height = 400) {
  const m = await mount({}, width, height);
  const h = await m.ready;
  const map = h.getMap()!;
  return { ...m, h, map };
}

interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

function camera(map: MapLibreMap): Camera {
  const c = map.getCenter();
  return {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing()
  };
}

function sameCamera(a: Camera, b: Camera): void {
  expect(a.center[0]).toBeCloseTo(b.center[0], 6);
  expect(a.center[1]).toBeCloseTo(b.center[1], 6);
  expect(a.zoom).toBeCloseTo(b.zoom, 6);
  expect(a.pitch).toBeCloseTo(b.pitch, 6);
  expect(a.bearing).toBeCloseTo(b.bearing, 6);
}

const CORNERS: [number, number][] = [
  [RUN_BOUNDS[0], RUN_BOUNDS[1]],
  [RUN_BOUNDS[0], RUN_BOUNDS[3]],
  [RUN_BOUNDS[2], RUN_BOUNDS[1]],
  [RUN_BOUNDS[2], RUN_BOUNDS[3]]
];

const HANDLERS = [
  'dragPan',
  'dragRotate',
  'scrollZoom',
  'boxZoom',
  'doubleClickZoom',
  'keyboard',
  'touchZoomRotate',
  'touchPitch'
] as const;
const ZOOM_HANDLERS = [
  'scrollZoom',
  'boxZoom',
  'doubleClickZoom',
  'keyboard',
  'touchZoomRotate',
  'touchPitch'
] as const;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/** Waits frame by frame until `cond` holds (bounded by the test's own timeout). */
async function until(cond: () => boolean): Promise<void> {
  while (!cond()) await nextFrame();
}
/** A few frames: room for a pick frame that should not report. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await nextFrame();
}

function overlayOf(map: MapLibreMap): MapLibreOverlay | undefined {
  const controls = (map as unknown as { _controls: unknown[] })._controls;
  return controls.find((c) => c instanceof MapLibreOverlay) as MapLibreOverlay | undefined;
}
const deckOf = (map: MapLibreMap) =>
  (overlayOf(map) as unknown as { _deck?: Deck } | undefined)?._deck;

// A footprint-only project about 44 m east of fixture parcel 3512014's existing building (as in
// SimMap.timeline.svelte.spec.ts): one view holds a timeline part and an existing building.
const AT: [number, number] = [-122.4179679, 37.7601348];
const FP: [number, number] = [AT[0] + 0.0005, AT[1]];
const FP_DAY = 21000;
const pickTimeline: TimelineUpdate = {
  revision: 0,
  cells: [
    packTimedCell('tl-P', [
      {
        schedule: {
          projectId: 'fx-p',
          origin: 'pipeline',
          parcelIds: ['9100001'],
          pathway: 'discretionary',
          entered: { filed: 20800 },
          end: { kind: 'open' },
          revisions: [{ day: 20800, units: 10, stories: null }],
          existingUnits: 0,
          multiPhase: false,
          phase: null
        },
        massings: [
          {
            footprint: [
              [FP[0] - 0.0001, FP[1] - 0.00008],
              [FP[0] + 0.0001, FP[1] - 0.00008],
              [FP[0] + 0.0001, FP[1] + 0.00008],
              [FP[0] - 0.0001, FP[1] + 0.00008]
            ]
          }
        ],
        pickParcelId: '9100001'
      }
    ])
  ],
  removedCells: [],
  demolish: []
};
const HOVER_MISS = { projectId: null, kind: 'hover' } as const;
const tooltip = () => document.querySelector('[role="tooltip"]');
const card = () => document.querySelector('.sim-map-card');

/** A ready map over the pick fixture at zoom 18, flat, with `fire` for canvas pointer events. */
async function readyOverPart() {
  const timelinePick = vi.fn<(p: TimelinePick) => void>();
  const m = await mount({ timelinePick });
  const h = await m.ready;
  const map = h.getMap()!;
  // deck follows map moves only once its device is up (see SimMap.timeline.svelte.spec.ts).
  await until(() => deckOf(map)?.isInitialized === true);
  h.setTimelineLookups(timelineLookups);
  h.applyTimeline(pickTimeline);
  h.setTime(FP_DAY);
  map.jumpTo({ center: AT, zoom: 18, pitch: 0, bearing: 0 });
  await new Promise<void>((r) => {
    map.once('idle', () => r());
    map.triggerRepaint();
  });
  const fire = (type: string, pointerType: string, p: { x: number; y: number }) => {
    const r = map.getCanvas().getBoundingClientRect();
    map.getCanvas().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: r.left + p.x,
        clientY: r.top + p.y,
        pointerType,
        pointerId: 7,
        isPrimary: true
      })
    );
  };
  const calls = () => timelinePick.mock.calls.length;
  /** Moves the mouse to `p`, re-sent each frame (a move during a map move is dropped), until
   *  `done` holds. */
  const moveUntil = async (p: { x: number; y: number }, done: () => boolean) => {
    while (!done()) {
      fire('pointermove', 'mouse', p);
      await nextFrame();
    }
  };
  return { ...m, h, map, timelinePick, fire, calls, moveUntil };
}

describe('SimMap run view', () => {
  it('locked on 600 by 400: the runFrame zoom, flat, north up, every RUN_BOUNDS corner 23 px inside', async () => {
    const { h, map } = await mountReady();
    h.setRunView(true);
    expect(map.getZoom()).toBeCloseTo(runFrame(600, 400, 0).zoom, 3);
    expect(map.getPitch()).toBe(0);
    expect(map.getBearing()).toBe(0);
    for (const corner of CORNERS) {
      const p = map.project(corner);
      expect(p.x).toBeGreaterThanOrEqual(23);
      expect(p.x).toBeLessThanOrEqual(600 - 23);
      expect(p.y).toBeGreaterThanOrEqual(23);
      expect(p.y).toBeLessThanOrEqual(400 - 23);
    }
  });

  it('locked on 375 by 400: zoom below 11 and the four corners inside the box', async () => {
    const { h, map } = await mountReady(375, 400);
    h.setRunView(true);
    expect(map.getZoom()).toBeLessThan(11);
    for (const corner of CORNERS) {
      const p = map.project(corner);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(375);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
  });

  it('locked: the eight handlers are off, no maxBounds, minZoom 8', async () => {
    const { h, map } = await mountReady();
    h.setRunView(true);
    for (const k of HANDLERS) expect(map[k].isEnabled(), k).toBe(false);
    expect(map.getMaxBounds()).toBeNull();
    expect(map.getMinZoom()).toBe(8);
  });

  it('locked: touch-action none, the bottom-left controls hidden, data-run-view on', async () => {
    const { h, map, target, root } = await mountReady();
    h.setRunView(true);
    expect(getComputedStyle(map.getCanvasContainer()).touchAction).toBe('none');
    // The attribute lands at Svelte's next flush.
    await expect.element(root).toHaveAttribute('data-run-view', 'on');
    const bl = target.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left')!;
    expect(getComputedStyle(bl).display).toBe('none');
  });

  it('unlocked after a lock: the camera before it, the five zoom handlers on, minZoom 11, maxBounds back, no data-run-view', async () => {
    const { h, map, root } = await mountReady();
    const before = camera(map);
    h.setRunView(true);
    await expect.element(root).toHaveAttribute('data-run-view', 'on');
    h.setRunView(false);
    sameCamera(camera(map), before);
    await expect.element(root).not.toHaveAttribute('data-run-view');
    for (const k of ZOOM_HANDLERS) expect(map[k].isEnabled(), k).toBe(true);
    expect(map.getMinZoom()).toBe(11);
    const mb = map.getMaxBounds()!.toArray();
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) expect(mb[i][j]).toBeCloseTo(CONSTRAINTS.maxBounds[i][j], 6);
    }
  });

  it('setPanEnabled(false), lock, unlock: dragPan off, scrollZoom on', async () => {
    const { h, map } = await mountReady();
    h.setPanEnabled(false);
    h.setRunView(true);
    h.setRunView(false);
    expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.scrollZoom.isEnabled()).toBe(true);
  });

  it('lock, setPanEnabled(true): dragPan stays off; unlock: dragPan on', async () => {
    const { h, map } = await mountReady();
    h.setPanEnabled(false);
    h.setRunView(true);
    h.setPanEnabled(true);
    expect(map.dragPan.isEnabled()).toBe(false);
    h.setRunView(false);
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('a second setRunView(true) after a jumpTo leaves the camera; unlock returns to the camera before the first; a second false changes nothing', async () => {
    const { h, map } = await mountReady();
    const before = camera(map);
    h.setRunView(true);
    map.jumpTo({ center: [-122.45, 37.76], zoom: 12 });
    const jumped = camera(map);
    h.setRunView(true);
    sameCamera(camera(map), jumped);
    h.setRunView(false);
    sameCamera(camera(map), before);
    map.jumpTo({ center: [-122.43, 37.77], zoom: 13.5 });
    const after = camera(map);
    h.setRunView(false);
    sameCamera(camera(map), after);
    expect(map.getMinZoom()).toBe(11);
  });

  it('lock, unlock, move, lock, unlock: the second unlock returns to the camera before the second lock', async () => {
    const { h, map } = await mountReady();
    h.setRunView(true);
    h.setRunView(false);
    map.jumpTo({ center: [-122.45, 37.76], zoom: 14, pitch: 30, bearing: 10 });
    const moved = camera(map);
    h.setRunView(true);
    h.setRunView(false);
    sameCamera(camera(map), moved);
  });

  it('a coarse pointer: Reset view is absent while locked and present after unlock', async () => {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => {
      if (q !== '(pointer: coarse)') return real(q);
      return {
        matches: true,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false
      } as MediaQueryList;
    });
    const { h } = await mountReady();
    const reset = page.getByRole('button', { name: 'Reset view' });
    await expect.element(reset).toBeInTheDocument();
    h.setRunView(true);
    await expect.element(reset).not.toBeInTheDocument();
    h.setRunView(false);
    await expect.element(reset).toBeInTheDocument();
  });

  it('lock and unlock raise no console error and no unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error');
    const { h, map } = await mountReady();
    h.setRunView(true);
    await new Promise<void>((r) => map.once('idle', () => r()));
    h.setRunView(false);
    await new Promise<void>((r) => map.once('idle', () => r()));
    expect(error).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('setRunView(true) before onready: once ready the camera is the fit and deck does not pick; unlock goes to defaultFrame(600)', async () => {
    const { screen, ready } = await mount();
    (screen.component as unknown as SimMapHandle).setRunView(true);
    const h = await ready;
    const map = h.getMap()!;
    expect(map.getZoom()).toBeCloseTo(runFrame(600, 400, 0).zoom, 3);
    expect(map.getPitch()).toBe(0);
    expect(map.getBearing()).toBe(0);
    for (const k of HANDLERS) expect(map[k].isEnabled(), k).toBe(false);
    expect(map.getCanvasContainer().classList.contains('sim-map-run-locked')).toBe(true);
    await until(() => deckOf(map) !== undefined);
    expect(deckOf(map)!.props._pickable).toBe(false);
    h.setRunView(false);
    const d = defaultFrame(600);
    sameCamera(camera(map), {
      center: d.center as [number, number],
      zoom: d.zoom,
      pitch: d.pitch ?? 0,
      bearing: d.bearing ?? 0
    });
  });

  it('true then false before the map exists: the map starts unlocked at its initial camera', async () => {
    const { screen, ready, root } = await mount();
    const handle = screen.component as unknown as SimMapHandle;
    handle.setRunView(true);
    handle.setRunView(false);
    const h = await ready;
    const map = h.getMap()!;
    await expect.element(root).not.toHaveAttribute('data-run-view');
    expect(map.getCanvasContainer().classList.contains('sim-map-run-locked')).toBe(false);
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.getMinZoom()).toBe(11);
    expect(map.getZoom()).toBeCloseTo(defaultFrame(600).zoom, 6);
    await until(() => deckOf(map) !== undefined);
    expect(deckOf(map)!.props._pickable).toBe(true);
  });

  it('a remount by a new manifest while locked: the new map is locked and fitted; unlock goes to the camera before the lock', async () => {
    const { h, map, screen, root } = await mountReady();
    map.jumpTo({ center: [-122.45, 37.76], zoom: 14, pitch: 30, bearing: 10 });
    const before = camera(map);
    h.setRunView(true);
    await screen.rerender({ manifest: structuredClone(manifest) });
    await until(() => h.getMap() !== map && root.dataset.state === 'ready');
    const second = h.getMap()!;
    expect(second.getZoom()).toBeCloseTo(runFrame(600, 400, 0).zoom, 3);
    expect(second.getPitch()).toBe(0);
    for (const k of HANDLERS) expect(second[k].isEnabled(), k).toBe(false);
    expect(second.getCanvasContainer().classList.contains('sim-map-run-locked')).toBe(true);
    h.setRunView(false);
    sameCamera(camera(second), before);
  });

  it('merged timeline layers while locked', async () => {
    const error = vi.spyOn(console, 'error');
    const { h, map, screen, root } = await mountReady();
    await until(() => deckOf(map)?.isInitialized === true);
    const timelineIds = (m: MapLibreMap) =>
      ((deckOf(m)?.props.layers ?? []) as Layer[])
        .map((l) => l.id)
        .filter((id) => /^timeline-(solid|ghost)-/.test(id));
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(pickTimeline);
    h.setTime(FP_DAY);
    h.setRunView(true);
    await expect
      .poll(() => timelineIds(map).sort())
      .toEqual(['timeline-ghost-run', 'timeline-solid-run']);
    h.setRunView(false);
    await expect
      .poll(() => timelineIds(map).sort())
      .toEqual(['timeline-ghost-tl-P', 'timeline-solid-tl-P']);
    // Deck initialises the per-cell layers again: no shader error from a reused, finalized layer.
    await settle();
    expect(error).not.toHaveBeenCalled();
    h.setRunView(true);
    await expect
      .poll(() => timelineIds(map).sort())
      .toEqual(['timeline-ghost-run', 'timeline-solid-run']);
    // lock, unlock, lock again on real deck: the map stays ready, nothing logged.
    await settle();
    expect(root.dataset.state).toBe('ready');
    expect(error).not.toHaveBeenCalled();
    await screen.rerender({ manifest: structuredClone(manifest) });
    await until(() => h.getMap() !== map && root.dataset.state === 'ready');
    const second = h.getMap()!;
    await until(() => deckOf(second)?.isInitialized === true);
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(pickTimeline);
    h.setTime(FP_DAY);
    await expect
      .poll(() => timelineIds(second).sort())
      .toEqual(['timeline-ghost-run', 'timeline-solid-run']);
  });

  it('locked, the host resized to 800 by 500: the zoom becomes runFrame(800, 500, 0).zoom', async () => {
    const { h, map, target } = await mountReady();
    h.setRunView(true);
    target.style.cssText = 'width:800px;height:500px';
    await expect.poll(() => map.getZoom()).toBeCloseTo(runFrame(800, 500, 0).zoom, 3);
    expect(map.getPitch()).toBe(0);
  });

  it('resized while locked, then unlocked: the camera before the lock', async () => {
    const { h, map, target } = await mountReady();
    const before = camera(map);
    h.setRunView(true);
    target.style.cssText = 'width:800px;height:500px';
    await expect.poll(() => map.getZoom()).toBeCloseTo(runFrame(800, 500, 0).zoom, 3);
    h.setRunView(false);
    sameCamera(camera(map), before);
  });

  it('locked, setBottomInset(120): the zoom becomes runFrame(600, 400, 120).zoom', async () => {
    const { h, map } = await mountReady();
    h.setRunView(true);
    h.setBottomInset(120);
    expect(map.getZoom()).toBeCloseTo(runFrame(600, 400, 120).zoom, 3);
  });

  it('a locked SimMap unmounted, then a new one mounted: no error, and it starts unlocked', async () => {
    const first = await mountReady();
    first.h.setRunView(true);
    first.screen.unmount();
    const { map, root } = await mountReady();
    for (const k of HANDLERS) expect(map[k].isEnabled(), k).toBe(true);
    expect(root.hasAttribute('data-run-view')).toBe(false);
    expect(map.getMinZoom()).toBe(11);
    expect(errors).toEqual([]);
  });
});

describe('SimMap run view picking', () => {
  it('with a tooltip shown, the lock closes it; timelinePick gets one hover miss after a hit', async () => {
    const { h, map, timelinePick, calls, moveUntil } = await readyOverPart();
    const building = map.project(AT);
    const part = map.project(FP);

    await moveUntil(building, () => tooltip() !== null);
    h.setRunView(true);
    await expect.poll(tooltip).toBeNull();
    h.setRunView(false);

    await moveUntil(part, () => timelinePick.mock.calls.at(-1)?.[0].projectId === 'fx-p');
    const n = calls();
    h.setRunView(true);
    expect(calls()).toBe(n + 1);
    expect(timelinePick).toHaveBeenLastCalledWith(HOVER_MISS);
  });

  it('locked: a touch tap and a mouse click on the canvas deliver nothing and show no card', async () => {
    const { h, map, timelinePick, fire } = await readyOverPart();
    h.setRunView(true);
    expect(timelinePick).not.toHaveBeenCalled();
    const p = map.project(FP);
    fire('pointerdown', 'touch', p);
    fire('pointerup', 'touch', p);
    fire('pointerdown', 'mouse', p);
    fire('pointerup', 'mouse', p);
    fire('pointermove', 'mouse', p);
    await settle();
    expect(timelinePick).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    expect(tooltip()).toBeNull();
  });

  it("after unlock, hover picks start at the next pointer move, not at the unlock's moveend", async () => {
    const { h, map, timelinePick, calls, fire, moveUntil } = await readyOverPart();
    const part = map.project(FP);
    // The part is pickable here: a hover hit, then leave it.
    await moveUntil(part, () => timelinePick.mock.calls.at(-1)?.[0].projectId === 'fx-p');
    fire('pointerleave', 'mouse', part);
    const n = calls();
    h.setRunView(true);
    // Resting where the part will be after unlock.
    fire('pointermove', 'mouse', part);
    await settle();
    h.setRunView(false);
    await settle();
    expect(calls()).toBe(n);
    await moveUntil(part, () => calls() > n);
    expect(timelinePick).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'fx-p', kind: 'hover' })
    );
  });
});
