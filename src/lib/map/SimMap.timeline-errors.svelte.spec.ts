// The lazy timelapse chunk fails to load (timelapse-render §4.8 "Errors"). Own file: vi.mock is
// file-wide.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimMap from './SimMap.svelte';
import { timelineSmall } from './fixtures/timeline-small';
import type { SimMapHandle } from './types';

const FIXTURE = '/e2e/fixtures/data/fixture-0/';
const manifest = JSON.parse(
  JSON.stringify(manifestJson).replaceAll('/data/fixture-0/', FIXTURE)
) as Manifest;

// The lazy timelapse chunk fails to load (offline, a stale deploy's chunk 404s, …).
vi.mock('./timelapse-loader', () => ({
  loadTimelapse: () => Promise.reject(new Error('timelapse chunk failed to load'))
}));

const ERROR_COPY = "The map couldn't load. Reload the page to try again.";

let hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts) h.remove();
  hosts = [];
  vi.restoreAllMocks();
});

describe('SimMap timeline start-up errors', { timeout: 30_000 }, () => {
  it('a timelapse import failure shows the error state and drops queued timelines', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = document.createElement('div');
    target.style.cssText = 'width:600px;height:400px';
    document.body.appendChild(target);
    hosts.push(target);
    const onready = vi.fn();
    const screen = await render(SimMap, { target, props: { manifest, onready } });
    const root = target.querySelector<HTMLElement>('[data-testid="map-root"]')!;
    const handle = screen.component as unknown as SimMapHandle;
    handle.applyTimeline(timelineSmall);
    await expect.poll(() => root.dataset.state, { timeout: 20_000 }).toBe('error');
    await expect.element(page.getByRole('alert')).toHaveTextContent(ERROR_COPY);
    expect(error).toHaveBeenCalledWith('[map] failed to start', expect.anything());
    expect(handle.getMap()).toBeNull();
    // Later updates are dropped, not queued for a controller that will never exist.
    expect(() => handle.applyTimeline({ ...timelineSmall, revision: 1 })).not.toThrow();
    expect(() => handle.setTime(22000)).not.toThrow();
    await new Promise((r) => setTimeout(r, 300));
    expect(root.dataset.state).toBe('error');
  });
});
