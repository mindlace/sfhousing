// SimMap's transit layers (transit spec §5.3, §6.1, §6.3): load, view toggles, stop tooltip and the
// failure / no-transit paths.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type { GeneratedBuilding } from '$lib/generator';
import SimMap from './SimMap.svelte';
import genJson from './fixtures/generated-small.json';
import { packCell } from './pack';
import {
  TRANSIT_ACCESS_LAYER,
  TRANSIT_ACCESS_SOURCE,
  TRANSIT_STOP_LAYERS,
  TRANSIT_STOPS_SOURCE
} from './style';
import { loadTransitNetwork } from './transit-layer';
import type { SimMapHandle, SimMapProps } from './types';

// The client tests run on Vitest's Vite dev server (root = repo), so the committed fixture is
// reachable at /e2e/fixtures/data/fixture-0/...: re-root the manifest's URLs there.
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

// Fixture stop 0, "Fixture Station" (BART, regional rail: drawn at every zoom).
const STATION: [number, number] = [-122.418138, 37.760991];
/** fixture-0 has 8 stops; Caltrain's two platforms are one station marker. */
const MARKERS = 7;

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

function host(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(el);
  hosts.push(el);
  return el;
}

async function mount(props: Partial<SimMapProps> = {}) {
  const target = host();
  let resolveReady!: (h: SimMapHandle) => void;
  const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
  const onready = vi.fn((h: SimMapHandle) => resolveReady(h));
  const screen = await render(SimMap, {
    target,
    props: { manifest, onready, ...props }
  });
  const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
  return { target, screen, ready, onready, root };
}

async function features(map: MapLibreMap, source: string): Promise<number> {
  const d = (await (map.getSource(source) as GeoJSONSource).getData()) as { features: unknown[] };
  return d.features.length;
}
const vis = (map: MapLibreMap, id: string) => map.getLayoutProperty(id, 'visibility') ?? 'visible';

async function jumpIdle(map: MapLibreMap, center: [number, number], zoom: number) {
  map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
  await new Promise<void>((r) => {
    map.once('idle', () => r());
    map.triggerRepaint();
  });
}

function hoverAt(map: MapLibreMap, lngLat: [number, number]) {
  const p = map.project(lngLat);
  const r = map.getCanvas().getBoundingClientRect();
  map.getCanvas().dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: r.left + p.x,
      clientY: r.top + p.y,
      pointerType: 'mouse',
      pointerId: 7,
      isPrimary: true
    })
  );
}
const tooltipText = () => document.querySelector('[role="tooltip"]')?.textContent ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SimMap transit', { timeout: 30_000 }, () => {
  it('loads the fixture network into both sources; capacity on, stops off by default', async () => {
    const { ready } = await mount();
    const map = (await ready).getMap()!;
    await expect.poll(() => features(map, TRANSIT_STOPS_SOURCE), { timeout: 10_000 }).toBe(MARKERS);
    await expect
      .poll(() => features(map, TRANSIT_ACCESS_SOURCE), { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(vis(map, TRANSIT_ACCESS_LAYER)).toBe('visible');
    for (const id of TRANSIT_STOP_LAYERS) expect(vis(map, id)).toBe('none');
    expect(errors).toEqual([]);
  });

  it('applies view changes without remounting', async () => {
    const { ready, screen } = await mount({ view: { transitStops: true, transitAccess: false } });
    const map = (await ready).getMap()!;
    await expect.poll(() => vis(map, TRANSIT_ACCESS_LAYER)).toBe('none');
    for (const id of TRANSIT_STOP_LAYERS) expect(vis(map, id)).toBe('visible');
    await screen.rerender({ view: { transitStops: false, transitAccess: true } });
    await expect.poll(() => vis(map, TRANSIT_ACCESS_LAYER)).toBe('visible');
    for (const id of TRANSIT_STOP_LAYERS) expect(vis(map, id)).toBe('none');
    expect((await ready).getMap()).toBe(map);
  });

  it('shows the stop tooltip on hover at z14+ only, and never while stops are hidden', async () => {
    const { ready, screen } = await mount({ view: { transitStops: true, transitAccess: true } });
    const map = (await ready).getMap()!;
    await expect.poll(() => features(map, TRANSIT_STOPS_SOURCE), { timeout: 10_000 }).toBe(MARKERS);

    await jumpIdle(map, STATION, 13);
    hoverAt(map, STATION);
    await sleep(150);
    expect(tooltipText()).not.toContain('Fixture Station');

    await jumpIdle(map, STATION, 15);
    hoverAt(map, STATION);
    await expect.poll(tooltipText).toContain('Fixture Station');
    expect(tooltipText()).toContain('BART');
    expect(tooltipText()).toContain('riders/hr at peak');

    // Hiding the stops layer drops a shown stop tooltip, and hovering finds no stop.
    await screen.rerender({ view: { transitStops: false, transitAccess: true } });
    await expect.poll(tooltipText).not.toContain('Fixture Station');
    await jumpIdle(map, STATION, 15);
    hoverAt(map, STATION);
    await sleep(150);
    expect(tooltipText()).not.toContain('Fixture Station');
    expect(errors).toEqual([]);
  });

  it('generated layers still attach when they arrive while a source is reloading', async () => {
    // Deck adds its MapLibre layer group only while the style reports loaded; a transit setData
    // (or any loading tile) makes it report not loaded.
    const { ready } = await mount();
    const h = await ready;
    const map = h.getMap()!;
    await expect.poll(() => features(map, TRANSIT_STOPS_SOURCE), { timeout: 10_000 }).toBe(MARKERS);
    await jumpIdle(map, STATION, 16);
    const stops = await (map.getSource(TRANSIT_STOPS_SOURCE) as GeoJSONSource).getData();
    (map.getSource(TRANSIT_STOPS_SOURCE) as GeoJSONSource).setData(stops);
    expect(map.isStyleLoaded()).toBe(false);
    const pack = packCell(
      '50_25',
      (genJson as unknown as GeneratedBuilding[])
        .slice(0, 3)
        .map((b) => ({ building: b, existingUnits: 0 }))
    );
    h.applyGenerated({
      revision: 0,
      cells: [{ settled: pack, rising: null }],
      removedCells: [],
      hide: { add: [], remove: [] }
    });
    await expect
      .poll(() => map.getLayersOrder().some((id) => id.startsWith('deck-')), { timeout: 5_000 })
      .toBe(true);
    expect(errors).toEqual([]);
  });

  it('stays ready with empty layers when transit.json fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ready, root } = await mount({
      fetchTransit: () => Promise.reject(new Error('HTTP 404'))
    });
    const map = (await ready).getMap()!;
    await expect.element(root).toHaveAttribute('data-state', 'ready');
    await expect
      .poll(() => warn.mock.calls.some((c) => String(c[0]).includes('transit')))
      .toBe(true);
    expect(await features(map, TRANSIT_STOPS_SOURCE)).toBe(0);
    expect(await features(map, TRANSIT_ACCESS_SOURCE)).toBe(0);
    expect(errors).toEqual([]);
  });

  it.each([
    ['the stops', TRANSIT_STOPS_SOURCE],
    ['the access grid', TRANSIT_ACCESS_SOURCE]
  ])('turns a failure building %s into a warning, not an error', async (_, source) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { ready, root } = await mount({
      fetchTransit: async (url) => {
        await gate;
        return loadTransitNetwork(url);
      }
    });
    const map = (await ready).getMap()!;
    vi.spyOn(map.getSource(source) as GeoJSONSource, 'setData').mockImplementation(() => {
      throw new Error('boom');
    });
    release();
    await expect
      .poll(() => warn.mock.calls.some((c) => c[0] === '[map] transit data unavailable'))
      .toBe(true);
    expect(root.dataset.state).toBe('ready');
    expect(errors).toEqual([]);
  });

  it.each([
    ['a 404', `${FIXTURE}missing-transit.json`],
    ['a file that is not a transit network', `${FIXTURE}manifest.json`]
  ])('the default loader turns %s into a warning, not an error', async (_, url) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    const { ready, root } = await mount({ manifest: { ...manifest, transit: url } });
    const map = (await ready).getMap()!;
    await expect
      .poll(() => warn.mock.calls.some((c) => String(c[0]).includes('transit')))
      .toBe(true);
    expect(root.dataset.state).toBe('ready');
    expect(await features(map, TRANSIT_STOPS_SOURCE)).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('makes no transit fetch and adds no transit layers without manifest.transit', async () => {
    const fetchTransit = vi.fn();
    const fetchSpy = vi.spyOn(window, 'fetch');
    const { transit: _omit, ...plain } = manifest;
    const { ready } = await mount({ manifest: plain as Manifest, fetchTransit });
    const map = (await ready).getMap()!;
    await new Promise<void>((r) => {
      map.once('idle', () => r());
      map.triggerRepaint();
    });
    expect(map.getSource(TRANSIT_STOPS_SOURCE)).toBeUndefined();
    expect(map.getSource(TRANSIT_ACCESS_SOURCE)).toBeUndefined();
    for (const id of [TRANSIT_ACCESS_LAYER, ...TRANSIT_STOP_LAYERS])
      expect(map.getLayer(id)).toBeUndefined();
    expect(fetchTransit).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes('transit'))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
