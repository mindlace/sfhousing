/// <reference types="@vitest/browser-playwright" />
// /s/[id] (plan 5, Task 6; timeline-ui Task 15): a published policy, read-only on the timeline.
// The data comes through the real chain: the server codec's `load` (the stored text), then the
// universal load (opens it on the calibration). The banner names it and offers Remix, which writes
// the opened schema 4 document under `sfhousing:sim:v2`; /sim then opens it. A fake timeline
// worker stands in for the scenario worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../layout.css';
import { page as appPage } from '$app/state';
import { manifestUrl } from '$lib/data/manifest';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { copyFor } from '$lib/sharing/copy';
import { readRecord, writeRecord } from '$lib/sharing/storage';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { monthFirstDay } from '$lib/sim/world/months';
import { SIM_KEY } from '$lib/sim-page/sim-doc';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { SIM_SERVER_CODEC4 } from '$lib/timeline/server-codec';
import { SIM_KEY4, serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import type { FakeTimelineWorker } from '$lib/timeline/test/fake-timeline-worker';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import schema2Painted from '$lib/sim-page/fixtures/schema2/painted.json?raw';
import SimRoutePage from '../../sim/+page.svelte';
import { load } from './+page';
import PageHost from './test/PageHost.svelte';

const nav = vi.hoisted(() => ({
  goto: [] as { url: string; opts?: { state?: App.PageState } }[]
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
vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  replaceState: () => {},
  goto: async (url: string, opts?: { state?: App.PageState }) => {
    nav.goto.push({ url, opts });
  }
}));

const SIM = copyFor('sim');
const cal = fixtureCalibration();
const M = (k: number) => monthFirstDay(cal.asOf, k);

const historic: Policy = {
  id: 'historic',
  label: 'Protect historic buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'historic' },
  spans: [{ from: M(2), to: null, what: { tag: 'protect', years: null } }]
};
const rent: Policy = {
  ...historic,
  id: 'rent',
  label: 'Protect rent-controlled buildings',
  where: { tag: 'category', category: 'rentControl' }
};
const zoning = (...z: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { ...DEFAULT_POLICY4.kinds, zoning: z }
});
const doc4 = (policy: SimPolicy4, title?: string): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  ...(title === undefined ? {} : { title }),
  policy
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const files = async (url: string) => {
  if (url === manifestUrl('fixture-0')) return json(manifestJson);
  if (url === manifestJson.scenarios.fzp.calibration) return json(calibrationJson);
  throw new Error(`unexpected fetch ${url}`);
};

/** The page's data for a stored row of `text`: the server codec's load, then the universal load. */
async function dataFor(text: string, o: { upgradedFrom?: number } = {}) {
  const stored = SIM_SERVER_CODEC4.load(text);
  if (!stored.ok) throw new Error('fixture');
  const server = {
    id: 'Abcdefg2',
    doc: stored.value,
    createdAt: '2026-10-30T12:00:00.000Z',
    currentDatasetVersion: 'fixture-0',
    datasetNotice: 'none' as const,
    ...(o.upgradedFrom === undefined ? {} : { upgradedFrom: o.upgradedFrom }),
    datasetVersion: 'fixture-0',
    appRelease: 'dev'
  };
  const r = await load({
    data: server,
    fetch: files,
    url: new URL('http://x/s/Abcdefg2')
  } as never);
  return { ...server, ...(r as object) } as ComponentProps<typeof PageHost>['data'];
}

const banner = () => page.getByRole('region', { name: 'Shared policy' });
const notices = () => page.getByTestId('sim-notices');
const w = () => workers[workers.length - 1];

function localV2(d: SimDoc4): void {
  writeRecord(
    localStorage,
    { v: 1, savedAt: new Date().toISOString(), plan: serializeSimDoc4(d) },
    SIM_SERVER_CODEC4
  );
}

describe('/s/[id] read-only view', () => {
  beforeEach(async () => {
    stub.reset();
    workers.length = 0;
    nav.goto.length = 0;
    appPage.state = {};
    localStorage.removeItem(SIM_KEY);
    localStorage.removeItem(SIM_KEY4);
    await page.viewport(1280, 900);
  });

  afterEach(() => {
    localStorage.removeItem(SIM_KEY);
    localStorage.removeItem(SIM_KEY4);
  });

  it('the banner reads Shared policy and Start your own goes to /sim', async () => {
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));
    await render(PageHost, { props: { data } });
    await expect.element(banner()).toBeVisible();
    await expect.element(banner()).toHaveTextContent(/SD permits · Shared policy · published/);
    await expect
      .element(banner().getByRole('link', { name: 'Start your own' }))
      .toHaveAttribute('href', '/sim');
    await expect.poll(() => document.title).toBe('SD permits · SF Housing Simulator');
  });

  it('/s shows the shared timeline read-only', async () => {
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));
    await render(PageHost, { props: { data } });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    await expect.element(page.getByTestId('tl-timeline')).toBeVisible();
    expect(page.getByRole('button', { name: /^Add .* policy$/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Undo|^Redo/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /Publish|Share link/ }).elements()).toHaveLength(0);
    // The status slot holds the fill status only: no save state.
    expect(page.getByText('Saved').elements()).toHaveLength(0);
    expect(document.querySelector('[data-header-status]')?.textContent).not.toMatch(/Sav|Autosave/);
    // Nothing is autosaved from the view, under either key.
    expect(localStorage.getItem(SIM_KEY4)).toBeNull();
    expect(localStorage.getItem(SIM_KEY)).toBeNull();
  });

  it('a schema 2 link keeps its "funding-added" notice', async () => {
    const data = await dataFor(schema2Painted, { upgradedFrom: 2 });
    await render(PageHost, { props: { data } });
    await expect
      .element(notices().getByText(/saved before public money could be added/))
      .toBeVisible();
  });

  it('Remix stores the opened document under sfhousing:sim:v2', async () => {
    // A v2 autosave with something in force: Remix asks first.
    localV2(doc4(zoning(rent)));
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));
    await render(PageHost, { props: { data } });
    await banner().getByRole('button', { name: 'Remix', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: SIM.remixConfirm(0) });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace' }).click();

    await expect.poll(() => nav.goto.length).toBe(1);
    expect(nav.goto[0].url).toBe('/sim');
    expect(nav.goto[0].opts?.state?.sfhSimRemix).toEqual({ from: 'SD permits' });
    const r = readRecord(localStorage, SIM_SERVER_CODEC4);
    expect(r.kind === 'ok' && r.plan.policy).toEqual(zoning(historic));
    expect(r.kind === 'ok' && r.plan.title).toBe('SD permits');
    // Nothing writes the v1 key.
    expect(localStorage.getItem(SIM_KEY)).toBeNull();
  });

  it('after Remix, /sim shows the remixed document over the earlier v2 autosave', async () => {
    localV2(doc4(zoning(rent)));
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));
    const shared = await render(PageHost, { props: { data } });
    await banner().getByRole('button', { name: 'Remix', exact: true }).click();
    await page.getByRole('button', { name: 'Replace' }).click();
    await expect.poll(() => nav.goto.length).toBe(1);
    await shared.unmount();

    appPage.state = nav.goto[0].opts!.state!;
    workers.length = 0;
    await render(SimRoutePage, { props: { data: data as never, params: {} } });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    await expect.element(notices().getByText(SIM.remixedToast('SD permits'))).toBeVisible();
  });

  it('Remix over a local document with nothing in force goes straight to /sim', async () => {
    localV2(doc4({ ...zoning({ ...rent, on: false }) }));
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic))));
    await render(PageHost, { props: { data } });
    await banner().getByRole('button', { name: 'Remix', exact: true }).click();
    await expect.poll(() => nav.goto.length).toBe(1);
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    expect(nav.goto[0].opts?.state?.sfhSimRemix).toEqual({ from: 'Abcdefg2' });
  });

  it('Remix hands the upgrade over: goto state carries upgradedFrom', async () => {
    const data = await dataFor(schema2Painted, { upgradedFrom: 2 });
    await render(PageHost, { props: { data } });
    await banner().getByRole('button', { name: 'Remix', exact: true }).click();
    await expect.poll(() => nav.goto.length).toBe(1);
    expect(nav.goto[0].opts).toEqual({
      state: { sfhSimRemix: expect.objectContaining({ upgradedFrom: 2 }) }
    });
    // The stored document is the opened one: schema 4.
    const r = readRecord(localStorage, SIM_SERVER_CODEC4);
    expect(r.kind === 'ok' && r.plan.schema).toBe(4);
  });
});
