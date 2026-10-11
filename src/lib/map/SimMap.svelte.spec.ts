import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { TOKENS } from './palette';
import type { ParcelSummaryLike, SimMapHandle, SimMapProps } from './types';

// Fixture data: the client tests run on Vitest's Vite dev server, whose root is the repo, so the
// committed fixture dataset is reachable at /e2e/fixtures/data/fixture-0/... (Vite serves range
// requests, which pmtiles needs). Point the manifest's root-relative URLs there: no fetch stub.
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

const HANDLE_FNS = [
  'applyGenerated',
  'setChunkStatus',
  'setPanEnabled',
  'setBottomInset',
  'getMap',
  'setOverlayLayers',
  'onResyncNeeded'
] as const;

const ATTRIBUTION = '© OpenStreetMap · Overture Maps (Esri, Microsoft, USGS) · DataSF · Protomaps';

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

async function chunkData(map: import('maplibre-gl').Map) {
  const data = await (map.getSource('chunk-status') as GeoJSONSource).getData();
  return data as unknown as { features: { properties: { status: string } }[] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idle = (h: SimMapHandle) =>
  new Promise<void>((r) => {
    const map = h.getMap()!;
    if (map.loaded() && map.areTilesLoaded()) return r();
    map.once('idle', () => r());
  });

describe('SimMap teardown (Review Focus 5)', { timeout: 30_000 }, () => {
  it('unmounting before load leaves no canvas and throws nothing', async () => {
    const { screen } = await mount();
    await screen.unmount();
    await sleep(500);
    expect(errors).toEqual([]);
    expect(document.querySelector('.maplibregl-canvas')).toBeNull();
  });

  it('unmounting after the map exists but before deck attaches is clean', async () => {
    const { screen, target, onready } = await mount();
    await expect
      .poll(() => target.querySelector('.maplibregl-canvas'), { timeout: 15_000 })
      .not.toBeNull();
    await screen.unmount();
    await sleep(500);
    expect(errors).toEqual([]);
    expect(document.querySelector('.maplibregl-canvas')).toBeNull();
    expect(onready.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('SimMap ready', { timeout: 30_000 }, () => {
  it('reaches ready, hands over the handle, and the handle drives the map', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const onRetryChunks = vi.fn();
    const { root, ready, onready, target } = await mount({ onRetryChunks });
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('ready');
    const h = await ready;
    expect(onready).toHaveBeenCalledTimes(1);
    for (const fn of HANDLE_FNS) expect(typeof h[fn]).toBe('function');
    expect(target.textContent).not.toContain('Loading map…');

    const map = h.getMap()!;
    h.setPanEnabled(false);
    expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.dragRotate.isEnabled()).toBe(false);
    h.setPanEnabled(true);
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.dragRotate.isEnabled()).toBe(true);

    h.setBottomInset(100);
    expect(map.getPadding().bottom).toBe(100);
    await expect.poll(() => root.style.getPropertyValue('--map-bottom-inset')).toBe('100px');

    h.setChunkStatus('50_25', 'error');
    await expect.element(page.getByText("Some parcels didn't load")).toBeVisible();
    const data = await chunkData(map);
    expect(data.features.map((f) => f.properties.status)).toEqual(['error']);
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(onRetryChunks).toHaveBeenCalledTimes(1);
    h.setChunkStatus('50_25', 'ready');
    await expect.element(page.getByText("Some parcels didn't load")).not.toBeInTheDocument();
    const cleared = await chunkData(map);
    expect(cleared.features).toEqual([]);

    // Glyphs and both pmtiles archives resolve from root-relative URLs: no map errors.
    await idle(h);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('attribution text is exact and links to /attribution', async () => {
    const { root, target } = await mount();
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('ready');
    const inner = target.querySelector('.maplibregl-ctrl-attrib-inner')!;
    expect(inner.textContent).toBe(ATTRIBUTION);
    const a = inner.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/attribution');
    expect(a.textContent).toBe(ATTRIBUTION);
    expect(a.getAttribute('title')).toBe(
      'Data & licences: OpenStreetMap and Overture data under ODbL; DataSF under PDDL / public domain; Protomaps basemap'
    );
    expect(
      target.querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib')
    ).not.toBeNull();
  });

  it('calls queued before ready replay once deck attaches', async () => {
    const { root, screen, ready } = await mount();
    const handle = screen.component as unknown as SimMapHandle;
    handle.setChunkStatus('50_25', 'loading');
    handle.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: ['QUEUED'], remove: [] }
    });
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('ready');
    const h = await ready;
    const map = h.getMap()!;
    expect(
      map.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id: 'QUEUED' })
    ).toEqual({ replaced: true });
    const data = await chunkData(map);
    expect(data.features.map((f) => f.properties.status)).toEqual(['loading']);
  });

  it('switches theme via paint properties without setStyle and keeps feature-state', async () => {
    const { root, screen, ready } = await mount({ theme: 'light' });
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('ready');
    const h = await ready;
    const map = h.getMap()!;
    h.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: ['3512008'], remove: [] }
    });
    const setStyle = vi.spyOn(map, 'setStyle');
    expect(map.getPaintProperty('background', 'background-color')).toBe(TOKENS.light.land);
    await screen.rerender({ theme: 'dark' });
    await expect
      .poll(() => map.getPaintProperty('background', 'background-color'))
      .toBe(TOKENS.dark.land);
    expect(setStyle).not.toHaveBeenCalled();
    expect(
      map.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id: '3512008' })
    ).toEqual({ replaced: true });
    await expect.poll(() => root.style.getPropertyValue('--map-land')).toBe(TOKENS.dark.land);
    expect(h.getMap()).toBe(map); // same map: no remount
  });
});

describe('SimMap picking', { timeout: 30_000 }, () => {
  // Fixture parcel 3512014's label point, inside chunk 50_25.
  const AT: [number, number] = [-122.4179679, 37.7601348];
  const P = '3512014';

  async function readyAtParcel() {
    let resolveSummary: ((s: ParcelSummaryLike | null) => void) | null = null;
    const requestParcelSummary = vi.fn(
      () => new Promise<ParcelSummaryLike | null>((r) => (resolveSummary = r))
    );
    const m = await mount({ requestParcelSummary });
    await expect.poll(() => m.root.dataset.state, { timeout: 20_000 }).toBe('ready');
    const h = await m.ready;
    const map = h.getMap()!;
    map.jumpTo({ center: AT, zoom: 17, pitch: 0, bearing: 0 });
    await new Promise<void>((r) => {
      map.once('idle', () => r());
      map.triggerRepaint();
    });
    const p = map.project(AT);
    const fire = (type: string, pointerType: string, dx = 0) => {
      const r = map.getCanvas().getBoundingClientRect();
      map.getCanvas().dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientX: r.left + p.x + dx,
          clientY: r.top + p.y,
          pointerType,
          pointerId: 7,
          isPrimary: true
        })
      );
    };
    const resolve = (s: ParcelSummaryLike | null) => resolveSummary?.(s);
    return { ...m, h, map, fire, requestParcelSummary, resolve };
  }

  it('a tap shows the card, fills units from the summary, and Close dismisses it', async () => {
    const { h, fire, requestParcelSummary, resolve } = await readyAtParcel();
    fire('pointerdown', 'touch');
    fire('pointerup', 'touch');
    await expect.element(page.getByText(`Parcel ${P}`)).toBeVisible();
    await expect.element(page.getByText('Existing building · units loading…')).toBeVisible();
    expect(requestParcelSummary).toHaveBeenCalledExactlyOnceWith(P);
    resolve({ parcelId: P, eligible: true, existingUnits: 3, generated: null });
    await expect.element(page.getByText('Existing building · 3 units')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect.element(page.getByText(`Parcel ${P}`)).not.toBeInTheDocument();

    h.setPanEnabled(false);
    fire('pointerdown', 'touch');
    fire('pointerup', 'touch');
    await sleep(100);
    expect(document.body.textContent).not.toContain(`Parcel ${P}`);
  });

  it('hover shows a tooltip, re-requests when the chunk turns ready, and skips hidden ids', async () => {
    const { h, fire, requestParcelSummary } = await readyAtParcel();
    h.setChunkStatus('50_25', 'loading');
    fire('pointermove', 'mouse');
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toHaveTextContent(`Parcel ${P}`);
    await expect.element(tip).toHaveTextContent('Existing building · units loading…');
    expect(requestParcelSummary).toHaveBeenCalledTimes(1);
    h.setChunkStatus('50_25', 'error');
    await expect.element(tip).toHaveTextContent('Existing building · units unavailable');
    h.setChunkStatus('50_25', 'ready');
    expect(requestParcelSummary).toHaveBeenCalledTimes(2);

    h.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: [P], remove: [] }
    });
    fire('pointermove', 'mouse', 1);
    await expect
      .poll(() => document.querySelector('[role="tooltip"]')?.textContent ?? '')
      .not.toContain(`Parcel ${P}`);

    h.applyGenerated({ revision: 1, cells: [], removedCells: [], hide: { add: [], remove: [P] } });
    fire('pointermove', 'mouse');
    await expect.element(tip).toHaveTextContent(`Parcel ${P}`);
    fire('pointerleave', 'mouse');
    await expect.element(tip).not.toBeInTheDocument();
  });
});
