import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Manifest } from '$lib/data/manifest';
import type { SimMapHandle } from './types';
import SimMap from './SimMap.svelte';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import header from '../../../e2e/fixtures/data/fixture-0/roofs/50_25-000.json';
import '../../routes/layout.css';

const imports = vi.hoisted(() => ({ roofs: 0 }));
// Reject the optional import seam; keep the mandatory deck loader and map lifecycle real.
vi.mock('./deck-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deck-loader')>()),
  loadRoofs: async () => {
    imports.roofs++;
    throw new Error('optional roof chunk failed to load');
  }
}));

const manifest = {
  ...JSON.parse(
    JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', '/e2e/fixtures/data/fixture-0/')
  ),
  buildingRoofs: manifestJson.buildingRoofs
} as Manifest;
const frame = { center: [-122.4188, 37.76014] as [number, number], zoom: 17, pitch: 0, bearing: 0 };
const FS = { source: 'buildings', sourceLayer: 'buildings' };
let host: HTMLDivElement;
afterEach(() => {
  host?.remove();
  vi.restoreAllMocks();
});

async function mount(m: Manifest) {
  host = document.createElement('div');
  host.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(host);
  let handle: SimMapHandle | undefined;
  const onready = vi.fn((h: SimMapHandle) => {
    handle = h;
  });
  const screen = await render(SimMap, {
    target: host,
    props: { manifest: m, initialFrame: frame, onready }
  });
  await expect.poll(() => handle, { timeout: 5000 }).toBeTruthy();
  return { screen, h: handle!, map: handle!.getMap()!, onready };
}

it('legacy maps keep parcel editing without requesting the optional roof module', async () => {
  const { h, map } = await mount({ ...manifest, buildingRoofs: undefined });
  expect(imports.roofs).toBe(0);
  expect((map.getStyle().sources.buildings as { promoteId: object }).promoteId).toEqual({
    buildings: 'parcelId'
  });
  h.applyGenerated({
    revision: 0,
    cells: [],
    removedCells: [],
    hide: { add: ['3512010'], remove: [] }
  });
  expect(map.getFeatureState({ ...FS, id: '3512010' })).toEqual({ replaced: true });
  expect(window.__sfhMap?.roofSnapshot()).toBeNull();
}, 15000);

it('unsupported schema maps keep parcel editing and emit one diagnostic per mount', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const unknown = {
    ...manifest,
    buildingRoofs: { ...manifest.buildingRoofs!, schemaVersion: 99 }
  } as Manifest;
  const { h, map, screen } = await mount(unknown);
  expect(imports.roofs).toBe(0);
  expect((map.getStyle().sources.buildings as { promoteId: object }).promoteId).toEqual({
    buildings: 'parcelId'
  });
  h.applyGenerated({
    revision: 0,
    cells: [],
    removedCells: [],
    hide: { add: ['3512010'], remove: [] }
  });
  expect(map.getFeatureState({ ...FS, id: '3512010' })).toEqual({ replaced: true });
  expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('unsupported'), 99);
  await screen.rerender({ theme: 'dark' });
  map.jumpTo({ zoom: 16 });
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  expect(warn).toHaveBeenCalledTimes(1);
  await screen.rerender({ manifest: { ...unknown } });
  await expect.poll(() => window.__sfhMap?.snapshot()).not.toBeNull();
  await expect.poll(() => warn.mock.calls.length).toBe(2);
  expect(imports.roofs).toBe(0);
  expect(host.querySelector('[role="alert"]')).toBeNull();
}, 15000);

it('a rejected optional roof import keeps supported-map readiness, edits and footprint fallback', async () => {
  const error = vi.spyOn(console, 'error');
  const { h, map, onready } = await mount(manifest);
  await expect.poll(() => imports.roofs).toBe(1);
  const piece = header.pieces[1];
  await expect
    .poll(() =>
      map
        .querySourceFeatures('buildings', { sourceLayer: 'buildings' })
        .some((f) => f.id === piece.pieceId)
    )
    .toBe(true);
  expect(window.__sfhMap?.roofSnapshot()).toBeNull();
  expect(map.getFeatureState({ ...FS, id: piece.pieceId })).toEqual({});
  h.applyGenerated({
    revision: 0,
    cells: [],
    removedCells: [],
    hide: { add: [piece.parcelId], remove: [] }
  });
  expect(map.getFeatureState({ ...FS, id: piece.pieceId })).toEqual({ replaced: true });
  h.applyGenerated({
    revision: 1,
    cells: [],
    removedCells: [],
    hide: { add: [], remove: [piece.parcelId] }
  });
  expect(map.getFeatureState({ ...FS, id: piece.pieceId }).replaced).not.toBe(true);
  expect(map.getFeatureState({ ...FS, id: piece.pieceId }).roofReady).not.toBe(true);
  expect(host.querySelector('[data-testid="map-root"]')?.getAttribute('data-state')).toBe('ready');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(onready).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
}, 15000);
