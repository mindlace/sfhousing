// /fzp page (spec §4.7): every load run remounts FzpMode, so a navigation within /fzp (the
// header's Timelapse link from ?seed=N) shows the future its URL names. A stub Worker stands in
// for the scenario worker; the SimMap stub records its props.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { stub } from '$lib/fzp/test/sim-map-stub';
import type { WorkerRequest } from '$lib/sim/protocol';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
// The shared client-test stub of $app/navigation has no afterNavigate; this page needs one.
vi.mock('$app/navigation', () => ({ afterNavigate: () => {}, replaceState: () => {} }));

class StubWorker {
  static all: StubWorker[] = [];
  posts: WorkerRequest[] = [];
  terminated = false;
  onmessage = null;
  constructor() {
    StubWorker.all.push(this);
  }
  postMessage(m: WorkerRequest) {
    this.posts.push(m);
  }
  terminate() {
    this.terminated = true;
  }
}

function data(seed: number | null) {
  return {
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    manifest: parseManifest(manifestJson),
    manifestError: false,
    calibration: fixtureCalibration(),
    calibrationError: false,
    noScenario: false,
    seed,
    seedInvalid: false
  };
}

const initSeeds = (w: StubWorker) =>
  w.posts.filter((p) => p.type === 'initScenario').map((p) => (p as { seed: number | null }).seed);

describe('/fzp page', () => {
  beforeEach(() => {
    stub.reset();
    StubWorker.all = [];
    vi.stubGlobal('Worker', StubWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remounts FzpMode on a new load result and keeps it for the same one', async () => {
    const first = data(123);
    const r = await render(Page, { props: { data: first, params: {} } });
    await expect.poll(() => StubWorker.all.length).toBe(1);
    expect(initSeeds(StubWorker.all[0])).toEqual([123]);

    // The same data object (what replaceState leaves behind): no remount.
    await r.rerender({ data: first, params: {} });
    expect(StubWorker.all).toHaveLength(1);

    // A navigation to /fzp reruns the load: a new data object, the representative future.
    await r.rerender({ data: data(null), params: {} });
    await expect.poll(() => StubWorker.all.length).toBe(2);
    expect(StubWorker.all[0].terminated).toBe(true);
    expect(StubWorker.all[1].terminated).toBe(false);
    expect(initSeeds(StubWorker.all[1])).toEqual([null]);
  });
});
