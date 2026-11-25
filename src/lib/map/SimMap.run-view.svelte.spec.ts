import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { CONSTRAINTS, RUN_BOUNDS, runFrame } from './camera';
import type { SimMapHandle, SimMapProps } from './types';

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

describe('SimMap run view', { timeout: 30_000 }, () => {
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
});
