// SimMap in timeline mode (timelapse-render spec §4.1 "Mode", §4.8, §6): the lazy timelapse
// module, the two layers per cell, picking through `timelinePick`, unusual call orders (Review
// Focus 3), leaving a part (Review Focus 5), remounts and the shader error path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Deck, Layer } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import '../../routes/layout.css';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { DAYS, SLOT, timelineSmall } from './fixtures/timeline-small';
import { timelineLookups } from './fixtures/timeline-lookups';
import { packTimedCell } from './pack-timed';
import { encodeParts } from './timelapse/encode';
import { TIMELINE_PART_LAYER } from './timeline-controller';
import type { SimMapHandle, SimMapProps, TimedPackedCell, TimelineUpdate } from './types';

// See SimMap.svelte.spec.ts: the committed fixture dataset is served by Vitest's dev server.
const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

// Room for every module fetch: the lazy-load assertions read the resource timing buffer.
performance.setResourceTimingBufferSize(100_000);
const lazyLoaded = () =>
  performance.getEntriesByType('resource').some((e) => e.name.includes('timelapse/deck'));

let hosts: HTMLElement[] = [];
let errors: unknown[] = [];
const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
const onRejection = (e: PromiseRejectionEvent) => errors.push(e.reason);

beforeEach(() => {
  errors = [];
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  vi.stubEnv('VITE_E2E', '1'); // installs window.__sfhMap (debug.ts)
});

afterEach(() => {
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  for (const h of hosts) h.remove();
  hosts = [];
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
  const screen = await render(SimMap, { target, props: { manifest, onready, ...props } });
  const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
  const handle = screen.component as unknown as SimMapHandle;
  return { target, screen, ready, onready, root, handle };
}

async function mountReady(props: Partial<SimMapProps> = {}) {
  const m = await mount(props);
  await expect.poll(() => m.root.dataset.state, { timeout: 20_000 }).toBe('ready');
  const h = await m.ready;
  const map = h.getMap()!;
  // deck attaches its luma device asynchronously, and only then follows map moves: a jumpTo
  // before that leaves deck's picking viewport at the initial camera.
  await expect.poll(() => deckOf(map).isInitialized, { timeout: 10_000 }).toBe(true);
  return { ...m, h, map };
}

const dbg = () => window.__sfhMap!;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await nextFrame();
};

function overlayOf(map: MapLibreMap): MapLibreOverlay {
  const controls = (map as unknown as { _controls: unknown[] })._controls;
  return controls.find((c) => c instanceof MapLibreOverlay) as MapLibreOverlay;
}
const deckOf = (map: MapLibreMap) => (overlayOf(map) as unknown as { _deck: Deck })._deck;
const layerIds = (map: MapLibreMap) =>
  ((deckOf(map).props.layers ?? []) as Layer[]).map((l) => l.id);
/** The layers deck has matched and initialised (`layerManager` is protected in deck's types). */
const liveLayers = (map: MapLibreMap) =>
  (deckOf(map) as unknown as { layerManager: { getLayers(): Layer[] } }).layerManager.getLayers();

async function jumpIdle(map: MapLibreMap, center: [number, number], zoom: number) {
  map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
  await new Promise<void>((r) => {
    map.once('idle', () => r());
    map.triggerRepaint();
  });
}

/** Layers and the demolish pump have converged, and the map has drawn them. */
async function converged(map: MapLibreMap) {
  await expect.poll(() => dbg().timelineSnapshot()?.pending, { timeout: 10_000 }).toBe(0);
  await new Promise<void>((r) => {
    map.once('idle', () => r());
    map.triggerRepaint();
  });
}

const cellOf = (id: string) => timelineSmall.cells.find((c) => c.cellId === id)!;
/** The first part of a slot's project in a cell. */
function partOf(cell: TimedPackedCell, projectId: string): number {
  return [...cell.partSlot].indexOf(cell.slotProjectIds.indexOf(projectId));
}
/** A part's lng/lat bounding-box centre (a closing duplicate vertex cannot bias it). */
function centreOf(cell: TimedPackedCell, k: number): [number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let v = cell.startIndices[k]; v < cell.startIndices[k + 1]; v++) {
    const [x, y] = [cell.positions[2 * v], cell.positions[2 * v + 1]];
    [x0, x1] = [Math.min(x0, x), Math.max(x1, x)];
    [y0, y1] = [Math.min(y0, y), Math.max(y1, y)];
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

// A footprint-only project ~44 m east of fixture parcel 3512014's existing building, so one view
// holds a timeline part, an existing building and empty map (Review Focus 5).
const AT: [number, number] = [-122.4179679, 37.7601348]; // parcel 3512014, chunk 50_25
const P = '3512014';
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

describe('SimMap timeline mode', { timeout: 60_000 }, () => {
  it('lazily installs solid, ghost and bar layers, with tlA expanded per vertex', async () => {
    const { h, map } = await mountReady();
    expect(lazyLoaded()).toBe(false);
    h.applyTimeline(timelineSmall);
    h.setTimelineLookups(timelineLookups);
    h.setTime(DAYS.a.construction);
    await converged(map);
    expect(lazyLoaded()).toBe(true);
    const ids = layerIds(map);
    expect(ids).toEqual(
      expect.arrayContaining([
        'timeline-solid-tl-A',
        'timeline-solid-tl-B',
        'timeline-ghost-tl-A',
        'timeline-ghost-tl-B',
        'timeline-bars'
      ])
    );
    expect(ids.some((id) => /^(generated|rising)-/.test(id))).toBe(false);
    expect(dbg().timelineSnapshot()).toMatchObject({ revision: 0, cells: 2, day: 22000 });
    expect(dbg().snapshot()).toBeNull(); // the GeneratedController is gone

    const cell = cellOf('tl-A');
    const vertexCount = cell.startIndices[cell.partCount];
    await expect.poll(() => liveLayers(map).some((l) => l.id === 'timeline-ghost-tl-A')).toBe(true);
    const ghost = liveLayers(map).find((l) => l.id === 'timeline-ghost-tl-A')!;
    const tlA = ghost.getAttributeManager()!.getAttributes().tlA;
    // deck over-allocates attribute arrays (typedArrayManager overAlloc), so the vertex-indexed
    // range is the first 4 · vertexCount values; numInstances is the vertex count.
    expect((tlA as unknown as { numInstances: number }).numInstances).toBe(vertexCount);
    const value = tlA.value as Float32Array;
    expect(value.length).toBeGreaterThanOrEqual(4 * vertexCount);
    const enc = encodeParts(cell, timelineLookups).tlA;
    const expected: number[] = [];
    for (let k = 0; k < cell.partCount; k++)
      for (let v = cell.startIndices[k]; v < cell.startIndices[k + 1]; v++)
        expected.push(...enc.subarray(4 * k, 4 * k + 4));
    expect([...value.subarray(0, 4 * vertexCount)]).toEqual(expected);
    expect(errors).toEqual([]);
  });

  it('pickObject finds a part from its ghostFrom on, and nothing before', async () => {
    const { h, map } = await mountReady();
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(timelineSmall);
    const cell = cellOf('tl-A');
    const k = partOf(cell, SLOT.a.projectId);
    await jumpIdle(map, centreOf(cell, k), 18);
    h.setTime(DAYS.a.preApplication - 1);
    await converged(map);
    const { x, y } = map.project(centreOf(cell, k));
    const overlay = overlayOf(map);
    expect(overlay.pickObject({ x, y, radius: 2 })).toBeNull();
    h.setTime(DAYS.a.preApplication);
    await converged(map);
    const info = overlay.pickObject({ x, y, radius: 2 })!;
    expect(info.layer!.id).toMatch(TIMELINE_PART_LAYER);
    expect(info.layer!.id).toBe('timeline-ghost-tl-A');
    expect(cell.slotProjectIds[cell.partSlot[info.index]]).toBe(SLOT.a.projectId);
    expect(cell.parcelIds[cell.partSlot[info.index]]).toBe(SLOT.a.parcelId);
  });

  it('a theme switch rebuilds the layers around the same extension instance', async () => {
    const { h, map, screen } = await mountReady({ theme: 'light' });
    h.applyTimeline(timelineSmall);
    h.setTimelineLookups(timelineLookups);
    await converged(map);
    const ghost = () =>
      ((deckOf(map).props.layers ?? []) as Layer[]).find((l) => l.id === 'timeline-ghost-tl-A')!;
    const before = ghost();
    const ext = before.props.extensions[0];
    await screen.rerender({ theme: 'dark' });
    await expect.poll(() => ghost() !== before).toBe(true);
    expect(ghost().props.extensions[0]).toBe(ext);
  });

  it('ignores applyGenerated in timeline mode with one console.error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { h, map } = await mountReady();
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(timelineSmall);
    await converged(map);
    const gen = { revision: 0, cells: [], removedCells: [], hide: { add: ['X'], remove: [] } };
    h.applyGenerated(gen);
    h.applyGenerated({ ...gen, revision: 1 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('applyGenerated');
    expect(map.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id: 'X' })).toEqual(
      {}
    );
    expect(layerIds(map).some((id) => id.startsWith('generated-'))).toBe(false);
  });

  it('reserves timeline- overlay ids', async () => {
    const { h } = await mountReady();
    const { ScatterplotLayer } = await import('@deck.gl/layers');
    expect(() =>
      h.setOverlayLayers([new ScatterplotLayer({ id: 'timeline-x', data: [] })])
    ).toThrow(/reserved/);
  });

  it('setTime throws RangeError on a non-finite day before any controller exists', async () => {
    const { handle } = await mount();
    expect(() => handle.setTime(NaN)).toThrow(RangeError);
    expect(() => handle.setTime(Infinity)).toThrow(RangeError);
  });
});

describe('SimMap timeline call order (Review Focus 3)', { timeout: 60_000 }, () => {
  it('setTime, setTimelineLookups, applyTimeline before ready = the normal order', async () => {
    const early = await mount();
    early.handle.setTime(DAYS.a.construction);
    early.handle.setTimelineLookups(timelineLookups);
    early.handle.applyTimeline(timelineSmall);
    await expect.poll(() => early.root.dataset.state, { timeout: 20_000 }).toBe('ready');
    const eh = await early.ready;
    await converged(eh.getMap()!);
    const a = dbg().timelineSnapshot();
    await early.screen.unmount();

    const { h, map } = await mountReady();
    h.applyTimeline(timelineSmall);
    h.setTimelineLookups(timelineLookups);
    h.setTime(DAYS.a.construction);
    await converged(map);
    const b = dbg().timelineSnapshot();
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    // (a), (c) and (e) are demolished by day 22000; (h) is later.
    expect(b!.demolish).toEqual({ total: 4, applied: 3 });
    expect(b!.bars).toBeGreaterThan(0);
  });

  it('a remount with a new manifest re-creates the controller and asks for a resync', async () => {
    const { h, map, root, screen } = await mountReady();
    const resync = vi.fn();
    h.onResyncNeeded(resync);
    h.applyTimeline(timelineSmall);
    h.setTimelineLookups(timelineLookups);
    h.setTime(DAYS.a.construction);
    await converged(map);
    expect(resync).not.toHaveBeenCalled();

    await screen.rerender({ manifest: structuredClone(manifest) });
    await expect
      .poll(() => h.getMap() !== map && root.dataset.state === 'ready', { timeout: 20_000 })
      .toBe(true);
    await expect.poll(() => resync.mock.calls.length, { timeout: 10_000 }).toBe(1);
    const second = h.getMap()!;
    // A new, empty controller with the stored day.
    expect(dbg().timelineSnapshot()).toMatchObject({ revision: -1, cells: 0, day: 22000 });
    h.applyTimeline(timelineSmall);
    await converged(second);
    expect(layerIds(second)).toEqual(
      expect.arrayContaining(['timeline-solid-tl-A', 'timeline-ghost-tl-B', 'timeline-bars'])
    );
    expect(dbg().timelineSnapshot()!.demolish).toEqual({ total: 4, applied: 3 });
    expect(resync).toHaveBeenCalledTimes(1);
  });
});

describe('SimMap timeline picking', { timeout: 60_000 }, () => {
  async function readyOverPart(props: Partial<SimMapProps> = {}, center = AT) {
    const m = await mountReady(props);
    const { h, map } = m;
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(pickTimeline);
    h.setTime(FP_DAY);
    await jumpIdle(map, center, 18);
    await converged(map);
    const at = (ll: [number, number]) => map.project(ll);
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
    return { ...m, at, fire };
  }
  const tooltip = () => document.querySelector('[role="tooltip"]');

  // Pins the current miss semantics on purpose (2026-10-17 conductor ruling: `timelinePick(null)`
  // stays kind-less): leaving a part after a hover sends one null; a click or tap off a part
  // sends null. A later T7 change to null's meaning must show up here.
  it('reports hover and click, suppresses the tooltip, and sends one null on leaving', async () => {
    const timelinePick = vi.fn();
    const { at, fire } = await readyOverPart({ timelinePick });
    const part = at(FP);
    const building = at(AT);
    const empty = { x: 8, y: 8 };

    // An existing building first: SimMap's own tooltip, nothing reported.
    fire('pointermove', 'mouse', building);
    await expect.poll(() => tooltip()?.textContent ?? '').toContain(`Parcel ${P}`);
    expect(timelinePick).not.toHaveBeenCalled();

    fire('pointermove', 'mouse', part);
    await expect.poll(() => timelinePick.mock.calls.length).toBe(1);
    expect(timelinePick).toHaveBeenLastCalledWith({
      projectId: 'fx-p',
      parcelId: '9100001',
      x: part.x,
      y: part.y,
      kind: 'hover'
    });
    await expect.poll(tooltip).toBeNull();

    fire('pointerdown', 'mouse', part);
    fire('pointerup', 'mouse', part);
    await expect.poll(() => timelinePick.mock.calls.length).toBe(2);
    expect(timelinePick).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'fx-p', parcelId: '9100001', kind: 'tap' })
    );
    expect(tooltip()).toBeNull();

    // Part → existing building: exactly one null, and the building's tooltip still works.
    fire('pointermove', 'mouse', building);
    await expect.poll(() => tooltip()?.textContent ?? '').toContain(`Parcel ${P}`);
    expect(timelinePick).toHaveBeenCalledTimes(3);
    expect(timelinePick).toHaveBeenLastCalledWith(null);
    fire('pointermove', 'mouse', { x: building.x + 1, y: building.y });
    await frames(3);
    fire('pointermove', 'mouse', empty);
    await expect.poll(tooltip).toBeNull();
    await frames(3);
    expect(timelinePick).toHaveBeenCalledTimes(3);

    // Part → empty map: one null; two further misses add nothing.
    fire('pointermove', 'mouse', part);
    await expect.poll(() => timelinePick.mock.calls.length).toBe(4);
    fire('pointermove', 'mouse', empty);
    await expect.poll(() => timelinePick.mock.calls.length).toBe(5);
    expect(timelinePick).toHaveBeenLastCalledWith(null);
    fire('pointermove', 'mouse', { x: empty.x + 1, y: empty.y });
    await frames(3);
    fire('pointermove', 'mouse', { x: empty.x + 2, y: empty.y });
    await frames(3);
    expect(timelinePick).toHaveBeenCalledTimes(5);

    // A click on empty map reports null.
    fire('pointerdown', 'mouse', empty);
    fire('pointerup', 'mouse', empty);
    await expect.poll(() => timelinePick.mock.calls.length).toBe(6);
    expect(timelinePick).toHaveBeenLastCalledWith(null);
    expect(errors).toEqual([]);
  });

  it('a touch tap on a part reports a tap and shows no card', async () => {
    const timelinePick = vi.fn();
    const { at, fire } = await readyOverPart({ timelinePick });
    fire('pointerdown', 'touch', at(FP));
    fire('pointerup', 'touch', at(FP));
    await expect.poll(() => timelinePick.mock.calls.length).toBe(1);
    expect(timelinePick).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'fx-p', kind: 'tap' })
    );
    await frames(3);
    expect(document.body.textContent).not.toContain('Parcel 9100001');
  });

  it('without timelinePick a part shows the generated tooltip; clicks pick nothing', async () => {
    // The part left of centre, so the long generated tooltip fits beside the pointer.
    const { at, fire } = await readyOverPart({}, [FP[0] + 0.0006, FP[1]]);
    fire('pointermove', 'mouse', at(FP));
    await expect.poll(() => tooltip()?.textContent ?? '').toContain('Parcel 9100001');
    expect(tooltip()!.textContent).toContain('10 units');
    fire('pointerdown', 'mouse', at(FP));
    fire('pointerup', 'mouse', at(FP));
    await frames(3);
    expect(document.querySelector('.sim-map-card')).toBeNull(); // the editor's mouse: no card
    fire('pointerleave', 'mouse', at(FP));
    await expect.poll(tooltip).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('SimMap timeline errors', { timeout: 60_000 }, () => {
  it('luma device errors log as before in the editor, fail the map in timeline mode', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { h, map, root } = await mountReady();
    // `device` is protected in deck's types.
    const device = (
      deckOf(map) as unknown as { device: { props: { onError: (e: Error) => unknown } } }
    ).device;
    expect(device.props.onError(new Error('editor'))).toBe(false);
    expect(root.dataset.state).toBe('ready');

    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(timelineSmall);
    await converged(map);
    const e = new Error('link failed');
    expect(device.props.onError(e)).toBe(true);
    expect(error).toHaveBeenCalledWith('[map] timelapse shader', e);
    await expect.poll(() => root.dataset.state).toBe('error');
    // Once: a second error is swallowed, the controller is stopped, and a restored context
    // does not flip the state back to ready.
    expect(device.props.onError(new Error('again'))).toBe(true);
    expect(error.mock.calls.filter((c) => c[0] === '[map] timelapse shader')).toHaveLength(1);
    expect(dbg().timelineSnapshot()).toMatchObject({ cells: 0, layerIds: [] });
    expect(layerIds(map)).toEqual([]);
    map.fire('webglcontextrestored');
    await frames(2);
    expect(root.dataset.state).toBe('error');
  });

  it("deck's onError for a timeline- layer fails the map", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { h, map, root } = await mountReady();
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(timelineSmall);
    await converged(map);
    const e = new Error('layer failed');
    const layer = liveLayers(map).find((l) => l.id === 'timeline-solid-tl-A')!;
    deckOf(map).props.onError!(e, layer);
    deckOf(map).props.onError!(new Error('ghost failed'), layer);
    expect(error).toHaveBeenCalledWith('[map] timelapse shader', e);
    expect(error.mock.calls.filter((c) => c[0] === '[map] timelapse shader')).toHaveLength(1);
    await expect.poll(() => root.dataset.state).toBe('error');
  });

  // luma throws a compile error in an un-awaited async check (ruling R13). This Chromium
  // reports the fixture's broken shader through the link path instead
  // (SimMap.timeline-shader.svelte.spec.ts), so the rejection listener is driven directly.
  // The listener is called rather than a synthetic event dispatched: Vite's dev client forwards
  // every `unhandledrejection` to the terminal, which would make the test output noisy.
  const watched = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => c[0] === 'unhandledrejection').map((c) => c[1]);
  const rejection = (message: string) => ({
    reason: new Error(message),
    preventDefault: vi.fn()
  });
  const COMPILE = 'RenderPipeline Link error during compilation of Shader vs';

  it('the editor installs no unhandledrejection listener', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { h, map } = await mountReady();
    h.applyGenerated({ revision: 0, cells: [], removedCells: [], hide: { add: [], remove: [] } });
    await frames(2);
    expect(watched(add)).toEqual([]);
    expect(map).toBeTruthy();
  });

  it('a compile rejection fails the map in timeline mode, once; unmount removes it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { h, map, root, screen } = await mountReady();
    h.setTimelineLookups(timelineLookups);
    h.applyTimeline(timelineSmall);
    await converged(map);
    const listeners = watched(add) as ((e: unknown) => void)[];
    expect(listeners).toHaveLength(1);
    const onRejection = listeners[0];

    const other = rejection('unrelated');
    onRejection(other);
    expect(other.preventDefault).not.toHaveBeenCalled(); // other rejections are left alone
    expect(root.dataset.state).toBe('ready');

    const compile = rejection(COMPILE);
    onRejection(compile);
    expect(compile.preventDefault).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[map] timelapse shader', compile.reason);
    await expect.poll(() => root.dataset.state).toBe('error');
    onRejection(rejection(COMPILE));
    expect(error.mock.calls.filter((c) => c[0] === '[map] timelapse shader')).toHaveLength(1);

    await screen.unmount();
    expect(watched(remove)).toContain(onRejection);
  });
});
