// /sim page (timeline-ui Task 15): a new load result remounts SimPage, the same one keeps it; the
// URL names no future (rule 25, OD-4), so `?seed=` is dropped from the address with replaceState,
// other parameters kept, and changes nothing. The real SimPage and TimelineMode run over a fake
// timeline worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AfterNavigate } from '@sveltejs/kit';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { SIM_KEY4 } from '$lib/timeline/sim-doc4';
import type { FakeTimelineWorker } from '$lib/timeline/test/fake-timeline-worker';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';

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
    manifest: parseManifest(manifestJson),
    manifestError: false,
    calibration: fixtureCalibration(),
    calibrationError: false,
    noScenario: false
  };
}

describe('/sim page', () => {
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
    const r = await render(Page, { props: { data: first, params: {} } });
    await expect.poll(() => workers.length).toBe(1);
    expect(workers[0].lastOf('openTimeline')!.policy).toEqual(DEFAULT_POLICY4);

    await r.rerender({ data: first, params: {} });
    expect(workers).toHaveLength(1);

    await r.rerender({ data: data(), params: {} });
    await expect.poll(() => workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].terminated).toBe(false);
  });

  it('?seed= is removed from the URL and changes nothing', async () => {
    await render(Page, { props: { data: data(), params: {} } });
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

    // An address with no seed is left alone.
    navigated('link', 'http://localhost/sim?x=1');
    await new Promise((res) => setTimeout(res, 20));
    expect(nav.replaced).toHaveLength(2);
  });

  it('is titled for the policy simulation', async () => {
    await render(Page, { props: { data: data(), params: {} } });
    await expect.poll(() => document.title).toBe('Policy simulation · SF Housing Simulator');
    expect(document.querySelector('h1')?.textContent).toBe('Housing policy simulation');
  });
});
