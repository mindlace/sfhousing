import { afterEach, expect, it, vi } from 'vitest';
import { packCell } from './pack';
import type { GeneratedBuilding } from '$lib/generator';
import genJson from './fixtures/generated-small.json';
import { render } from 'vitest-browser-svelte';
import type { Manifest } from '$lib/data/manifest';
import type { SimMapHandle } from './types';
import SimMap from './SimMap.svelte';
import {
  BUILDINGS_LAYER,
  BUILDINGS_SOURCE,
  buildingsSource,
  existingBuildingsLayer
} from './style';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import legacyJson from '../../../pipeline/test/fixtures/legacy/manifest.json';
import header from '../../../e2e/fixtures/data/fixture-0/roofs/50_25-000.json';
import '../../routes/layout.css';

const manifest = {
  ...JSON.parse(
    JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', '/e2e/fixtures/data/fixture-0/')
  ),
  buildingRoofs: manifestJson.buildingRoofs
} as Manifest;
const legacyManifest = JSON.parse(
  JSON.stringify(legacyJson).replaceAll('/data/fixture-0/', '/e2e/fixtures/data/fixture-0/')
) as Manifest;
const frame = { center: [-122.4188, 37.76014] as [number, number], zoom: 17, pitch: 0, bearing: 0 };
const FS = { source: BUILDINGS_SOURCE, sourceLayer: 'buildings' };
let host: HTMLDivElement;
afterEach(() => {
  host?.remove();
  vi.restoreAllMocks();
});
async function mount(m = manifest, initialFrame = frame) {
  host = document.createElement('div');
  host.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(host);
  let handle!: SimMapHandle;
  const screen = await render(SimMap, {
    target: host,
    props: {
      manifest: m,
      initialFrame,
      onready: (h) => {
        handle = h;
      }
    }
  });
  await expect.poll(() => handle, { timeout: 20000 }).toBeTruthy();
  return { screen, h: handle, map: handle.getMap()! };
}
const roof = () => window.__sfhMap?.roofSnapshot?.();
const active = async () =>
  expect.poll(() => roof()?.activePieceIds.length, { timeout: 15000 }).toBe(3);

it('activates real meshes, preserves independent readiness through revision zero and source recreation, then releases on zoom out', async () => {
  const { h, map, screen } = await mount();
  await active();
  const piece = header.pieces[1],
    sibling = header.pieces[2];
  const state = (id: string) => map.getFeatureState({ ...FS, id });
  await expect
    .poll(
      () =>
        map
          .querySourceFeatures(BUILDINGS_SOURCE, { sourceLayer: 'buildings' })
          .filter((f) => f.properties.pieceId === piece.pieceId).length
    )
    .toBeGreaterThan(0);
  h.applyGenerated({
    revision: 0,
    cells: [],
    removedCells: [],
    hide: { add: [piece.parcelId], remove: [] }
  });
  expect(state(piece.pieceId)).toEqual({ roofReady: true, replaced: true });
  expect(state(sibling.pieceId)).toEqual({ roofReady: true });
  h.applyGenerated({ revision: 0, cells: [], removedCells: [], hide: { add: [], remove: [] } });
  expect(state(piece.pieceId)).toEqual({ roofReady: true });
  h.applyGenerated({
    revision: 1,
    cells: [],
    removedCells: [],
    hide: { add: [piece.parcelId], remove: [] }
  });
  map.removeLayer(BUILDINGS_LAYER);
  map.removeSource(BUILDINGS_SOURCE);
  map.addSource(BUILDINGS_SOURCE, buildingsSource(manifest));
  map.addLayer(existingBuildingsLayer('light'));
  await expect.poll(() => state(piece.pieceId)).toEqual({ roofReady: true, replaced: true });
  await screen.rerender({ theme: 'dark' });
  expect(state(sibling.pieceId)).toEqual({ roofReady: true });
  map.jumpTo({ zoom: 14 });
  await expect.poll(() => roof()?.activePieceIds).toEqual([]);
  expect(state(piece.pieceId)).toEqual({ replaced: true });
  await expect.poll(() => roof()?.ownedBytes).toBe(0);
  map.jumpTo({ zoom: 17 });
  await active();
  expect(state(piece.pieceId)).toEqual({ replaced: true, roofReady: true });
  await screen.unmount();
  expect(document.querySelector('.maplibregl-canvas')).toBeNull();
}, 30000);

it('onready and edits precede a delayed index; late tile pieces inherit only their parcel replacement', async () => {
  const fetchOriginal = window.fetch.bind(window);
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) === manifest.buildingRoofs!.indexUrl) await held;
    return fetchOriginal(input, init);
  });
  const { h, map } = await mount(manifest, { ...frame, zoom: 13 });
  const piece = header.pieces[1],
    sibling = header.pieces[2];
  h.applyGenerated({
    revision: 0,
    cells: [],
    removedCells: [],
    hide: { add: [piece.parcelId], remove: [] }
  });
  await expect.poll(() => roof()?.activePieceIds).toEqual([]);
  map.jumpTo({ zoom: 17 });
  release();
  await active();
  expect(map.getFeatureState({ ...FS, id: piece.pieceId })).toEqual({
    replaced: true,
    roofReady: true
  });
  expect(map.getFeatureState({ ...FS, id: sibling.pieceId })).toEqual({ roofReady: true });
}, 30000);

it('remounts legacy and unknown schemas with parcel promotion and no roof controller', async () => {
  const { screen, h } = await mount();
  await active();
  for (const next of [
    legacyManifest,
    { ...manifest, buildingRoofs: { ...manifest.buildingRoofs!, schemaVersion: 99 } } as Manifest
  ]) {
    const map = h.getMap();
    await screen.rerender({ manifest: next });
    await expect.poll(() => h.getMap() !== map && window.__sfhMap?.snapshot() !== null).toBe(true);
    await expect.poll(roof).toBeNull();
    expect((h.getMap()!.getStyle().sources.buildings as { promoteId: object }).promoteId).toEqual({
      buildings: 'parcelId'
    });
    h.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: ['3512011'], remove: [] }
    });
    expect(h.getMap()!.getFeatureState({ ...FS, id: '3512011' })).toEqual({ replaced: true });
  }
}, 30000);

it('picks roof parcel summaries and prioritizes overlapping generated layers even beneath roofs', async () => {
  const { h, map } = await mount();
  await active();
  const at: [number, number] = [-122.418395, 37.76014];
  map.jumpTo({ center: at, zoom: 19, pitch: 0, bearing: 0 });
  await new Promise<void>((r) => map.once('idle', () => r()));
  // Remove footprint fallback only at the picking boundary: the hit must come from the mesh.
  vi.spyOn(map, 'queryRenderedFeatures').mockReturnValue([]);
  const fire = () => {
    const p = map.project(at),
      r = map.getCanvas().getBoundingClientRect();
    map.getCanvas().dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: r.left + p.x,
        clientY: r.top + p.y
      })
    );
  };
  fire();
  await expect
    .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
    .toContain('Parcel 3512010');
  const base = (genJson as unknown as GeneratedBuilding[])[0];
  const b = {
    ...base,
    parcelId: 'PRIORITY',
    parts: [
      {
        ...base.parts[0],
        baseM: 0,
        topM: 1,
        footprint: [
          [at[0] - 0.00005, at[1] - 0.00005],
          [at[0] - 0.00005, at[1] + 0.00005],
          [at[0] + 0.00005, at[1] + 0.00005],
          [at[0] + 0.00005, at[1] - 0.00005]
        ]
      }
    ]
  } as GeneratedBuilding;
  h.applyGenerated({
    revision: 0,
    cells: [{ settled: packCell('50_25', [{ building: b, existingUnits: 0 }]), rising: null }],
    removedCells: [],
    hide: { add: [], remove: [] }
  });
  await new Promise<void>((r) => map.once('idle', () => r()));
  fire();
  await expect
    .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
    .toContain('Parcel PRIORITY');
}, 30000);

it('retains promoted parcel-clipped piece IDs in loaded vector tiles across zoom and refresh', async () => {
  const { map } = await mount();
  await active();
  const loaded = () => map.querySourceFeatures(BUILDINGS_SOURCE, { sourceLayer: 'buildings' });
  for (const zoom of [15, 17]) {
    map.jumpTo({ zoom });
    await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    const pieces = loaded().filter((f) => f.properties.buildingId === 'b10');
    expect([...new Set(pieces.map((f) => f.id))].sort()).toEqual([
      'p-4f95dedf1e4cbf31e3e45491',
      'p-7e33516c53ae4a9d6cd9d679'
    ]);
    for (const f of pieces) {
      expect(f.id).toBe(f.properties.pieceId);
      expect(header.pieces.find((p) => p.pieceId === f.id)?.parcelId).toBe(f.properties.parcelId);
    }
  }
  map.refreshTiles(BUILDINGS_SOURCE);
  await new Promise<void>((resolve) => map.once('idle', () => resolve()));
  expect(
    loaded()
      .filter((f) => f.properties.buildingId === 'b10')
      .map((f) => f.id)
      .sort()
  ).toEqual(['p-4f95dedf1e4cbf31e3e45491', 'p-7e33516c53ae4a9d6cd9d679']);
}, 30000);

it('keeps unmatched footprint pieces visible and pickable when their matched sibling is replaced', async () => {
  const { h, map } = await mount();
  await active();
  const unmatchedId = 'p-39caa3c6bea85d194a88807b';
  const sourcePieces = () =>
    map.querySourceFeatures(BUILDINGS_SOURCE, { sourceLayer: 'buildings' });
  await expect.poll(() => sourcePieces().some((f) => f.id === unmatchedId)).toBe(true);
  h.applyGenerated({
    revision: 0,
    cells: [],
    removedCells: [],
    hide: { add: ['3512006'], remove: [] }
  });
  const unmatched = sourcePieces().find((f) => f.id === unmatchedId)!;
  expect(unmatched.properties.parcelId ?? '').toBe('');
  expect(map.getFeatureState({ ...FS, id: 'p-4e879cb5566587068dcbe1e6' })).toEqual({
    replaced: true
  });
  expect(map.getFeatureState({ ...FS, id: unmatchedId })).toEqual({});
  expect(unmatched.geometry.type).toBe('Polygon');
  // Probe the south band of this courtyard polygon, not its central hole.
  const at: [number, number] = [-122.418875, 37.760099];
  map.jumpTo({ center: at, zoom: 20, pitch: 0, bearing: 0 });
  await new Promise<void>((resolve) => map.once('idle', () => resolve()));
  const point = map.project(at),
    bounds = map.getCanvas().getBoundingClientRect();
  expect(
    map
      .queryRenderedFeatures(point, { layers: [BUILDINGS_LAYER] })
      .some((f) => f.id === unmatchedId)
  ).toBe(true);
  map.getCanvas().dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerType: 'mouse',
      clientX: bounds.left + point.x,
      clientY: bounds.top + point.y
    })
  );
  await expect
    .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
    .toContain('Not matched to a parcel');
  expect(roof()?.activePieceIds).not.toContain(unmatchedId);
}, 30000);
