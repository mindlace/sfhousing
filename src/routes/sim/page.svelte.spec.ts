// /sim page (spec §4.7, moved from /fzp): the future on show always matches the URL. Every load
// run remounts SimPage, and so does a navigation within /sim that SvelteKit serves without
// rerunning the load (its last-load URL predates replaceState). A fake Worker stands in for the
// scenario worker; the SimMap stub records its props.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { AfterNavigate } from '@sveltejs/kit';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { FakeScenarioWorker, timelineMsg } from '$lib/fzp/test/fake-worker';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS } from '$lib/sim/levers/types';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import Page from './+page.svelte';

const nav = vi.hoisted(() => ({
  after: [] as ((n: AfterNavigate) => void)[],
  replaced: [] as string[],
  /** The address bar's query string, which `addressSeed` reads instead of `location`. */
  address: ''
}));

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/fzp/seed', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/fzp/seed')>();
  return {
    ...real,
    addressSearch: () => nav.address,
    addressSeed: () => real.parseSeed(new URLSearchParams(nav.address))
  };
});
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

/**
 * Runs the page's afterNavigate callbacks for a navigation whose address bar reads `address`.
 * `to.url` is SvelteKit's stored URL, which after a replaceState is not the address bar.
 */
function navigated(type: AfterNavigate['type'], address: string, stored = '') {
  nav.address = address;
  const to = { url: new URL(`http://localhost/sim${stored}`) } as AfterNavigate['to'];
  for (const cb of nav.after) cb({ type, to, from: null, willUnload: false } as AfterNavigate);
}

function data(seed: number | null, o: { seedInvalid?: boolean; start?: 'fzp' | null } = {}) {
  return {
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    manifest: parseManifest(manifestJson),
    manifestError: false,
    calibration: fixtureCalibration(),
    calibrationError: false,
    noScenario: false,
    seed,
    seedInvalid: o.seedInvalid ?? false,
    start: o.start ?? null
  };
}

const initSeeds = (w: StubWorker) =>
  w.posts.filter((p) => p.type === 'initScenario').map((p) => (p as { seed: number | null }).seed);

describe('/sim page', () => {
  beforeEach(() => {
    stub.reset();
    StubWorker.all = [];
    nav.after.length = 0;
    nav.replaced.length = 0;
    nav.address = '';
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

    // A navigation to /sim reruns the load: a new data object, the representative future.
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

    // A link to /sim?seed=5: the seed of the last load, so SvelteKit keeps the same data object.
    navigated('link', '?seed=5');
    await expect.poll(() => StubWorker.all.length).toBe(2);
    expect(StubWorker.all[0].terminated).toBe(true);
    expect(StubWorker.all[1].lastOf('initScenario')!.seed).toBe(5);

    // A navigation to the future already on show does not remount.
    navigated('link', '?seed=5');
    await new Promise((res) => setTimeout(res, 50));
    expect(StubWorker.all).toHaveLength(2);
  });

  it('Back onto a rerolled entry: the load ran for the stored /sim, the bar wins', async () => {
    // SvelteKit navigated to (and loaded) the pre-replaceState URL /sim; the bar reads ?seed=7.
    await render(Page, { props: { data: data(null), params: {} } });
    navigated('popstate', '?seed=7', '');
    await expect.poll(() => StubWorker.all.length).toBe(2);
    expect(StubWorker.all[0].terminated).toBe(true);
    expect(initSeeds(StubWorker.all[1])).toEqual([7]);
  });

  it('Back onto the bare /sim after the way back: the load ran for ?seed=5, the bar wins', async () => {
    await render(Page, { props: { data: data(5), params: {} } });
    navigated('popstate', '', '?seed=5');
    await expect.poll(() => StubWorker.all.length).toBe(2);
    expect(initSeeds(StubWorker.all[1])).toEqual([null]);
  });

  it('an invalid seed is cleaned on /sim', async () => {
    // /fzp?seed=abc&x=1&x=2 redirected here with start=fzp: the representative future, and the
    // address loses only its seed.
    await render(Page, {
      props: { data: data(null, { seedInvalid: true, start: 'fzp' }), params: {} }
    });
    navigated('enter', '?seed=abc&x=1&x=2&start=fzp', '?seed=abc&x=1&x=2&start=fzp');
    await expect.poll(() => nav.replaced).toEqual(['?x=1&x=2&start=fzp']);
    await expect.poll(() => StubWorker.all.length).toBe(1);
    expect(initSeeds(StubWorker.all[0])).toEqual([null]);
  });

  it('opens the FZP comparison for start=fzp and current law otherwise', async () => {
    const r = await render(Page, { props: { data: data(null, { start: 'fzp' }), params: {} } });
    await expect.poll(() => StubWorker.all.length).toBe(1);
    expect(StubWorker.all[0].lastOf('initScenario')!.levers).toEqual(FZP_COMPAT_LEVERS);
    await r.rerender({ data: data(null), params: {} });
    await expect.poll(() => StubWorker.all.length).toBe(2);
    expect(StubWorker.all[1].lastOf('initScenario')!.levers).toEqual(DEFAULT_LEVERS);
  });

  it('is titled for the policy simulation', async () => {
    await render(Page, { props: { data: data(null), params: {} } });
    await expect.poll(() => document.title).toBe('Policy simulation · SF Housing Simulator');
    expect(document.querySelector('h1')?.textContent).toBe('Housing policy simulation');
  });
});
