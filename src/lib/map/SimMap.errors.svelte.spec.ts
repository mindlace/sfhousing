// Start-up failures that are not "no WebGL 2". Own file: vi.mock is file-wide.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import type { SimMapHandle } from './types';

const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

const flags = vi.hoisted(() => ({ styleThrows: false }));

vi.mock('./style', async (importOriginal) => {
  const real = await importOriginal<typeof import('./style')>();
  return {
    ...real,
    buildStyle: (...a: Parameters<typeof real.buildStyle>) => {
      if (flags.styleThrows) throw new Error('style build failed');
      return real.buildStyle(...a);
    }
  };
});

// The lazy deck chunk fails to load (offline, a stale deploy's chunk 404s, …).
vi.mock('./deck-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deck-loader')>()),
  loadDeck: () => Promise.reject(new Error('deck chunk failed to load'))
}));

const ERROR_COPY = "The map couldn't load. Reload the page to try again.";

let hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts) h.remove();
  hosts = [];
  flags.styleThrows = false;
  vi.restoreAllMocks();
});

async function mount() {
  const target = document.createElement('div');
  target.style.cssText = 'width:600px;height:400px';
  document.body.appendChild(target);
  hosts.push(target);
  const events: Event[] = [];
  target.addEventListener('mapunsupported', (e) => events.push(e));
  const onready = vi.fn();
  const screen = await render(SimMap, { target, props: { manifest, onready } });
  const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
  return { screen, root, onready, events };
}

describe('SimMap start-up errors', { timeout: 30_000 }, () => {
  it('a non-WebGL throw before the Map exists is an error, not "needs WebGL 2"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    flags.styleThrows = true;
    const { root, onready, events } = await mount();
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('error');
    await expect.element(page.getByRole('alert')).toHaveTextContent(ERROR_COPY);
    expect(page.getByText('This map needs WebGL 2').query()).toBeNull();
    expect(events).toHaveLength(0);
    expect(onready).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[map] failed to start', expect.any(Error));
  });

  it('a deck import failure shows the error state, drops queued updates and never fires onready', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { root, onready, screen } = await mount();
    const handle = screen.component as unknown as SimMapHandle;
    handle.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: ['QUEUED'], remove: [] }
    });
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('error');
    await expect.element(page.getByRole('alert')).toHaveTextContent(ERROR_COPY);
    expect(handle.getMap()).toBeNull();
    // Later updates are dropped, not queued for a controller that will never exist.
    expect(() =>
      handle.applyGenerated({
        revision: 1,
        cells: [],
        removedCells: [],
        hide: { add: [], remove: [] }
      })
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 300));
    expect(onready).not.toHaveBeenCalled();
    expect(root.dataset.state).toBe('error');
    expect(error).toHaveBeenCalledWith('[map] failed to start', expect.anything());
  });
});
