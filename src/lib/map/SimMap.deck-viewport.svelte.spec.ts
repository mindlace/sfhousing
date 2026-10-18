// deck's camera after the lazy overlay attaches (regression). `onready` fires as soon as the
// overlay is added, but deck creates its luma device asynchronously and only then starts
// following map `move` events, so a camera change in between (the editor's setBottomInset, a
// consumer's jumpTo, a user drag) used to leave deck's picking viewport at the attach-time camera
// until the next move.
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Deck } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import type { GeneratedBuilding } from '$lib/generator';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import genJson from './fixtures/generated-small.json';
import { packCell } from './pack';
import SimMap from './SimMap.svelte';
import type { SimMapHandle } from './types';

const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

let hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts) h.remove();
  hosts = [];
});

function overlayOf(map: MapLibreMap): MapLibreOverlay {
  const controls = (map as unknown as { _controls: unknown[] })._controls;
  return controls.find((c) => c instanceof MapLibreOverlay) as MapLibreOverlay;
}
const deckOf = (map: MapLibreMap) => (overlayOf(map) as unknown as { _deck: Deck })._deck;

/** Mounts SimMap and runs `atReady` synchronously inside `onready`, before deck initialises. */
async function mountWith(atReady: (h: SimMapHandle, map: MapLibreMap) => void) {
  const target = document.createElement('div');
  target.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(target);
  hosts.push(target);
  let deckReadyAtReady: boolean | null = null;
  let resolveReady!: (h: SimMapHandle) => void;
  const ready = new Promise<SimMapHandle>((r) => (resolveReady = r));
  await render(SimMap, {
    target,
    props: {
      manifest,
      onready: (h: SimMapHandle) => {
        const map = h.getMap()!;
        deckReadyAtReady = deckOf(map).isInitialized;
        atReady(h, map);
        resolveReady(h);
      }
    }
  });
  const h = await ready;
  const map = h.getMap()!;
  await expect.poll(() => deckOf(map).isInitialized, { timeout: 10_000 }).toBe(true);
  return { h, map, deckReadyAtReady };
}

/** Screen px of `lngLat` through deck's own (picking) viewport and through MapLibre. */
function projections(map: MapLibreMap, lngLat: [number, number]) {
  const vp = deckOf(map).getViewports()[0];
  const [x, y] = vp.project(lngLat);
  const p = map.project(lngLat);
  return { deck: [x, y], map: [p.x, p.y] };
}

function expectAligned(map: MapLibreMap, lngLat: [number, number]) {
  const { deck, map: ml } = projections(map, lngLat);
  expect(Math.abs(deck[0] - ml[0])).toBeLessThan(1);
  expect(Math.abs(deck[1] - ml[1])).toBeLessThan(1);
}

const buildings = genJson as unknown as GeneratedBuilding[];
const FOOT = buildings[0].parts[0].footprint;
// The first generated building's first part, at its centroid.
const AT: [number, number] = [
  FOOT.reduce((s, p) => s + p[0], 0) / FOOT.length,
  FOOT.reduce((s, p) => s + p[1], 0) / FOOT.length
];

describe('SimMap deck viewport at attach', { timeout: 30_000 }, () => {
  it('a jumpTo before deck initialises reaches deck without a further move', async () => {
    const { map, deckReadyAtReady } = await mountWith((_h, m) =>
      m.jumpTo({ center: AT, zoom: 18, pitch: 30, bearing: 20 })
    );
    expect(deckReadyAtReady).toBe(false); // the race this test is about
    expectAligned(map, AT);
    expectAligned(map, [AT[0] + 0.0005, AT[1] - 0.0003]);
  });

  it('a bottom inset set before deck initialises reaches deck without a further move', async () => {
    const { map, deckReadyAtReady } = await mountWith((h) => h.setBottomInset(120));
    expect(deckReadyAtReady).toBe(false);
    expect(map.getPadding().bottom).toBe(120);
    const c = map.getCenter();
    expectAligned(map, [c.lng + 0.01, c.lat + 0.01]);
  });

  it('deck picks a generated building the camera jumped to before deck initialised', async () => {
    const { h, map } = await mountWith((_h, m) =>
      m.jumpTo({ center: AT, zoom: 19, pitch: 0, bearing: 0 })
    );
    h.applyGenerated({
      revision: 0,
      cells: [
        {
          settled: packCell(
            '50_25',
            buildings.slice(0, 3).map((b) => ({ building: b, existingUnits: 0 }))
          ),
          rising: null
        }
      ],
      removedCells: [],
      hide: { add: [], remove: [] }
    });
    await new Promise<void>((r) => {
      map.once('idle', () => r());
      map.triggerRepaint();
    });
    const p = map.project(AT);
    const info = overlayOf(map).pickObject({ x: p.x, y: p.y, radius: 2 });
    expect(info?.layer?.id).toMatch(/^generated-/);
  });
});
