import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Manifest } from '$lib/data/manifest';
import type { SimMapHandle } from './types';
import type { GeneratedBuilding } from '$lib/generator';
import SimMap from './SimMap.svelte';
import { packCell } from './pack';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import genJson from './fixtures/generated-small.json';
import '../../routes/layout.css';

const gate = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  return { held, release, requested: false, resolved: false };
});
// Hold the real roof chunk before its module factory completes, as a stalled chunk response does.
vi.mock('./roof-layer', async (importOriginal) => {
  gate.requested = true;
  await gate.held;
  const actual = await importOriginal<typeof import('./roof-layer')>();
  gate.resolved = true;
  return actual;
});

const manifest = {
  ...JSON.parse(
    JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', '/e2e/fixtures/data/fixture-0/')
  ),
  buildingRoofs: manifestJson.buildingRoofs
} as Manifest;
const frame = { center: [-122.4188, 37.76014] as [number, number], zoom: 17, pitch: 0, bearing: 0 };
const hosts: HTMLDivElement[] = [];
afterEach(async () => {
  gate.release();
  if (gate.requested) await expect.poll(() => gate.resolved).toBe(true);
  for (const host of hosts) host.remove();
  vi.restoreAllMocks();
});

async function mount(m = manifest) {
  const target = document.createElement('div');
  target.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(target);
  hosts.push(target);
  let handle: SimMapHandle | undefined;
  const onready = vi.fn((h: SimMapHandle) => {
    handle = h;
  });
  const screen = await render(SimMap, {
    target,
    props: { manifest: m, initialFrame: frame, onready }
  });
  const exported = screen.component as unknown as SimMapHandle;
  exported.applyGenerated({
    revision: 0,
    cells: [
      {
        settled: packCell(
          '50_25',
          (genJson as unknown as GeneratedBuilding[])
            .slice(0, 1)
            .map((building) => ({ building, existingUnits: 0 }))
        ),
        rising: null
      }
    ],
    removedCells: [],
    hide: { add: [], remove: [] }
  });
  await expect.poll(() => handle, { timeout: 5000 }).toBeTruthy();
  return { target, screen, h: handle!, map: handle!.getMap()!, onready };
}

it('held roof imports allow queued and live edits, then skip torn-down mounts when released', async () => {
  const originalFetch = window.fetch.bind(window);
  let indexRequests = 0;
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    if (String(input) === manifest.buildingRoofs!.indexUrl) indexRequests++;
    return originalFetch(input, init);
  });
  const error = vi.spyOn(console, 'error');
  for (const baseline of [
    { ...manifest, buildingRoofs: undefined },
    { ...manifest, buildingRoofs: { ...manifest.buildingRoofs!, schemaVersion: 99 } } as Manifest
  ]) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = await mount(baseline);
    expect(gate.requested).toBe(false);
    expect(window.__sfhMap?.snapshot()?.layerIds).toContain('generated-50_25');
    await legacy.screen.unmount();
    warn.mockRestore();
  }
  const first = await mount();
  await expect.poll(() => gate.requested).toBe(true);
  expect(gate.resolved).toBe(false);
  expect(window.__sfhMap?.snapshot()?.layerIds).toContain('generated-50_25');
  expect(window.__sfhMap?.roofSnapshot()).toBeNull();
  first.h.applyGenerated({
    revision: 1,
    cells: [],
    removedCells: ['50_25'],
    hide: { add: [], remove: [] }
  });
  expect(window.__sfhMap?.snapshot()?.layerIds).toEqual([]);
  await first.screen.unmount();
  expect(first.h.getMap()).toBeNull();
  expect(document.querySelector('.maplibregl-canvas')).toBeNull();
  const second = await mount();
  expect(window.__sfhMap?.roofSnapshot()).toBeNull();
  gate.release();
  await expect.poll(() => gate.resolved).toBe(true);
  await expect.poll(() => window.__sfhMap?.roofSnapshot()).toBeTruthy();
  await expect.poll(() => indexRequests).toBe(1);
  expect(window.__sfhMap?.snapshot()?.layerIds).toContain('generated-50_25');
  expect(first.onready).toHaveBeenCalledTimes(1);
  expect(second.onready).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('.maplibregl-canvas')).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
}, 20000);
