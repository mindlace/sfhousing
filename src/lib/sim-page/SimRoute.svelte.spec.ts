/// <reference types="@vitest/browser-playwright" />
// SimRoute (timeline-ui Task 15, game-sim #sec-design-route): a new load result remounts SimPage,
// the same one keeps it; the URL names no future (rule 25, OD-4), so `?seed=` is dropped from the
// address with replaceState, other parameters kept, and changes nothing; the opening's camera
// reaches the map. The real SimPage and TimelineMode run over a fake timeline worker; SimMap is a
// stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AfterNavigate } from '@sveltejs/kit';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { stub } from '$lib/fzp/test/sim-map-stub';
import type { CameraFrame } from '$lib/map/types';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { SIM_KEY4 } from '$lib/timeline/sim-doc4';
import type { FakeTimelineWorker } from '$lib/timeline/test/fake-timeline-worker';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import SimRouteHost from './test/SimRouteHost.svelte';

const nav = vi.hoisted(() => ({
  after: [] as ((n: AfterNavigate) => void)[],
  replaced: [] as { url: string; state: App.PageState }[],
  /** The address bar, which SimRoute reads instead of `location`. */
  address: 'http://localhost/sim'
}));
const workers = vi.hoisted(() => [] as FakeTimelineWorker[]);

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/sim/client', async (orig) => {
  const { FakeTimelineWorker } = await import('$lib/timeline/test/fake-timeline-worker');
  return {
    ...(await orig<typeof import('$lib/sim/client')>()),
    spawnSimWorker: () => {
      const w = new FakeTimelineWorker();
      workers.push(w);
      return w;
    }
  };
});
vi.mock('$lib/timeline/address', async (orig) => ({
  ...(await orig<typeof import('$lib/timeline/address')>()),
  addressHref: () => nav.address
}));
vi.mock('$app/navigation', () => ({
  afterNavigate: (cb: (n: AfterNavigate) => void) => nav.after.push(cb),
  replaceState: (url: string, state: App.PageState) => nav.replaced.push({ url, state })
}));

/** Runs the page's afterNavigate callbacks for a navigation whose address bar reads `address`. */
function navigated(type: AfterNavigate['type'], address: string) {
  nav.address = address;
  const to = { url: new URL(address) } as AfterNavigate['to'];
  for (const cb of nav.after) cb({ type, to, from: null, willUnload: false } as AfterNavigate);
}

function data() {
  return {
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    user: null,
    signInAvailable: true,
    manifest: parseManifest(manifestJson),
    manifestError: false,
    calibration: fixtureCalibration(),
    calibrationError: false,
    noScenario: false
  };
}

const FRAME = { center: [-122.42, 37.77], zoom: 15, bearing: 0, pitch: 0 } as CameraFrame;

describe('SimRoute', () => {
  beforeEach(() => {
    stub.reset();
    workers.length = 0;
    nav.after.length = 0;
    nav.replaced.length = 0;
    nav.address = 'http://localhost/sim';
    localStorage.removeItem(SIM_KEY4);
    localStorage.removeItem('sfhousing:sim:v1');
  });

  afterEach(() => {
    localStorage.removeItem(SIM_KEY4);
    localStorage.removeItem('sfhousing:sim:v1');
  });

  it('remounts SimPage on a new load result and keeps it for the same one', async () => {
    const first = data();
    const r = await render(SimRouteHost, { props: { data: first } });
    await expect.poll(() => workers.length).toBe(1);
    expect(workers[0].lastOf('openTimeline')!.policy).toEqual(DEFAULT_POLICY4);

    await r.rerender({ data: first });
    await expect.poll(() => workers.length).toBe(1);
    expect(workers).toHaveLength(1);

    await r.rerender({ data: data() });
    await expect.poll(() => workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].terminated).toBe(false);
  });

  it('?seed= is removed from the URL and changes nothing', async () => {
    await render(SimRouteHost, { props: { data: data() } });
    await expect.poll(() => workers.length).toBe(1);
    const sent = workers[0].posts.length;

    navigated('enter', 'http://localhost/sim?seed=5&x=1&x=2#map');
    await expect.poll(() => nav.replaced.map((r) => r.url)).toEqual(['/sim?x=1&x=2#map']);
    // A bad seed goes the same way.
    navigated('link', 'http://localhost/sim?seed=junk');
    await expect.poll(() => nav.replaced.map((r) => r.url)).toEqual(['/sim?x=1&x=2#map', '/sim']);
    // No remount, no new message: the seed meant nothing.
    expect(workers).toHaveLength(1);
    expect(workers[0].posts.slice(sent).filter((p) => p.type === 'openTimeline')).toEqual([]);

    // An address with no seed is left alone: a seeded one after it is the next replace.
    navigated('link', 'http://localhost/sim?x=1');
    navigated('link', 'http://localhost/sim?seed=7&y=1');
    await expect.poll(() => nav.replaced).toHaveLength(3);
    expect(nav.replaced.map((r) => r.url)).toEqual(['/sim?x=1&x=2#map', '/sim', '/sim?y=1']);
  });

  it('initialFrame reaches SimMap', async () => {
    render(SimRouteHost, { props: { data: data(), initialFrame: FRAME } });
    await expect.poll(() => stub.props.initialFrame).toEqual(FRAME);
  });
});
