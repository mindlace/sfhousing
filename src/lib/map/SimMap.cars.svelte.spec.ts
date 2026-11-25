// SimMap's cars-per-household layer (car-ownership Task 12): the zones load when the layer is
// first turned on, the source follows `carZones` (the playhead month's values), NaN is no data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { CARS_LAYER, CARS_SOURCE } from './style';
import { loadCarZones } from './cars-layer';
import type { SimMapHandle, SimMapProps } from './types';
import { DEFAULT_VIEW } from '$lib/view/prefs';

// Client tests run on Vitest's Vite dev server (root = repo): re-root the manifest's URLs.
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

async function mount(props: Partial<SimMapProps> = {}) {
  const target = document.createElement('div');
  target.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(target);
  hosts.push(target);
  let resolveReady!: (h: SimMapHandle) => void;
  const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
  const screen = await render(SimMap, {
    target,
    props: { manifest, onready: (h: SimMapHandle) => resolveReady(h), ...props }
  });
  return { screen, ready };
}

async function values(map: MapLibreMap): Promise<unknown[]> {
  const d = (await (map.getSource(CARS_SOURCE) as GeoJSONSource).getData()) as unknown as {
    features: { properties: { v: unknown } }[];
  };
  return d.features.map((f) => f.properties.v);
}
const vis = (map: MapLibreMap, id: string) => map.getLayoutProperty(id, 'visibility') ?? 'visible';

describe('SimMap cars', { timeout: 30_000 }, () => {
  it('fetches nothing and hides the layer while it is off', async () => {
    const fetchCarZones = vi.fn(loadCarZones);
    const { ready } = await mount({ fetchCarZones, carZones: new Float32Array([1, 2, 3]) });
    const map = (await ready).getMap()!;
    expect(vis(map, CARS_LAYER)).toBe('none');
    expect(await values(map)).toEqual([]);
    expect(fetchCarZones).not.toHaveBeenCalled();
  });

  it("turned on: loads the zones once and draws the month's values; NaN is no data", async () => {
    const fetchCarZones = vi.fn(loadCarZones);
    const { ready, screen } = await mount({
      fetchCarZones,
      view: { ...DEFAULT_VIEW, carsPerHousehold: true },
      carZones: new Float32Array([0.5, Number.NaN, 1.5])
    });
    const map = (await ready).getMap()!;
    await expect.poll(() => vis(map, CARS_LAYER)).toBe('visible');
    await expect.poll(() => values(map), { timeout: 10_000 }).toEqual([0.5, null, 1.5]);

    // A playhead month change rebuilds `v`; no second fetch.
    await screen.rerender({ carZones: new Float32Array([0.25, 1, Number.NaN]) });
    await expect.poll(() => values(map)).toEqual([0.25, 1, null]);
    // No values (past the fill): an empty source.
    await screen.rerender({ carZones: null });
    await expect.poll(() => values(map)).toEqual([]);
    // Off again: hidden.
    await screen.rerender({ view: DEFAULT_VIEW });
    await expect.poll(() => vis(map, CARS_LAYER)).toBe('none');
    expect(fetchCarZones).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it('without carZones (Paint shares the prefs): the choice on shows and fetches nothing', async () => {
    const fetchCarZones = vi.fn(loadCarZones);
    const { ready } = await mount({
      fetchCarZones,
      view: { ...DEFAULT_VIEW, carsPerHousehold: true }
    });
    const map = (await ready).getMap()!;
    expect(map.getLayer(CARS_LAYER)).toBeDefined();
    expect(vis(map, CARS_LAYER)).toBe('none');
    expect(fetchCarZones).not.toHaveBeenCalled();
  });

  it('a manifest without car zones has no layer and fetches nothing', async () => {
    const fzp = { ...manifest.scenarios!.fzp, cars: undefined, carZones: undefined };
    const fetchCarZones = vi.fn(loadCarZones);
    const { ready } = await mount({
      manifest: { ...manifest, scenarios: { fzp } },
      fetchCarZones,
      view: { ...DEFAULT_VIEW, carsPerHousehold: true }
    });
    const map = (await ready).getMap()!;
    expect(map.getLayer(CARS_LAYER)).toBeUndefined();
    expect(map.getSource(CARS_SOURCE)).toBeUndefined();
    expect(fetchCarZones).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});
