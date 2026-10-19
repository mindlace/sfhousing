// /fzp page (spec §4.7): the future on show always matches the URL. Every load run remounts
// FzpMode, and so does a navigation within /fzp that SvelteKit serves without rerunning the load
// (its last-load URL predates replaceState). A fake Worker stands in for the scenario worker; the
// SimMap stub records its props.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { AfterNavigate } from '@sveltejs/kit';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { FakeScenarioWorker, timelineMsg } from '$lib/fzp/test/fake-worker';
import { stub } from '$lib/fzp/test/sim-map-stub';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';

const nav = vi.hoisted(() => ({
  after: [] as ((n: AfterNavigate) => void)[],
  replaced: [] as string[]
}));

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
// The shared client-test stub of $app/navigation has no afterNavigate; this page needs one.
vi.mock('$app/navigation', () => ({
  afterNavigate: (cb: (n: AfterNavigate) => void) => nav.after.push(cb),
  replaceState: (url: string) => nav.replaced.push(url)
}));

class StubWorker extends FakeScenarioWorker {
  static all: StubWorker[] = [];
  constructor() {
    super();
    StubWorker.all.push(this);
  }
}

/** Runs the page's afterNavigate callbacks for a navigation to `search` on /fzp. */
function navigated(type: AfterNavigate['type'], search: string) {
  const to = { url: new URL(`http://localhost/fzp${search}`) } as AfterNavigate['to'];
  for (const cb of nav.after) cb({ type, to, from: null, willUnload: false } as AfterNavigate);
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
    nav.after.length = 0;
    nav.replaced.length = 0;
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

  it('remounts for a same-route navigation the load skips, when its URL names another future', async () => {
    await render(Page, { props: { data: data(5), params: {} } });
    navigated('enter', '?seed=5');
    await expect.poll(() => StubWorker.all.length).toBe(1);
    const w = StubWorker.all[0];
    const init = w.lastOf('initScenario')!;
    expect(init.seed).toBe(5);
    w.emit({ type: 'ready', rev: init.rev, datasetVersion: 'fixture-0', chunkCount: 4 });
    w.emit(timelineMsg(init.rev, 5));

    // 'Back to the representative future': the answer writes the bare URL with replaceState.
    await page.getByRole('button', { name: 'Back to the representative future' }).first().click();
    const reroll = w.lastOf('reroll')!;
    expect(reroll.seed).toBeNull();
    w.emit(timelineMsg(reroll.rev, 31));
    await expect.poll(() => nav.replaced.length).toBe(1);
    expect(StubWorker.all).toHaveLength(1); // replaceState never remounts

    // A link to /fzp?seed=5: the seed of the last load, so SvelteKit keeps the same data object.
    navigated('link', '?seed=5');
    await expect.poll(() => StubWorker.all.length).toBe(2);
    expect(StubWorker.all[0].terminated).toBe(true);
    expect(StubWorker.all[1].lastOf('initScenario')!.seed).toBe(5);

    // A navigation to the future already on show does not remount.
    navigated('link', '?seed=5');
    await new Promise((res) => setTimeout(res, 50));
    expect(StubWorker.all).toHaveLength(2);
  });
});
