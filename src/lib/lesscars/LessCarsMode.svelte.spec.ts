// LessCarsMode composition (Plan 2 Task 9): the real PlaybackClient over fake playback workers, the
// recording SimMap stub (FzpMode's spec pattern) and the header slots from a test host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { LESSCARS_START } from '$lib/data/lesscars/schedule';
import { formatMonthYear } from '$lib/fzp/format';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import type { PlaybackCard } from '$lib/sim/lesscars/types';
import { FakePlaybackWorker } from '$lib/sim/lesscars/test/fake-playback-worker';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import planJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/plan.json';
import sitesJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/sites.json';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import { loadLessCars, type LessCarsData } from './load';
import { headlineText } from './summary-view';
import LessCarsModeHost from './test/LessCarsModeHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));

const FILES: Record<string, unknown> = {
  'manifest.json': manifestJson,
  'calibration.json': calibrationJson,
  'plan.json': planJson,
  'sites.json': sitesJson,
  'summary.json': summaryJson
};
async function fixtureFetch(url: string): Promise<Response> {
  const body = FILES[url.split('/').pop() as string];
  return body
    ? new Response(JSON.stringify(body), { status: 200 })
    : new Response('', { status: 404 });
}

let data: LessCarsData;
let workers: FakePlaybackWorker[];

/** The mini plan's garage parcel (the edge garage on a parcel). */
function garageParcel(): string {
  for (const p of data.plan.plan.projects)
    if (p.kind === 'edge-garage' && 'parcel' in p.site) return p.site.parcel;
  throw new Error('no garage parcel in the mini plan');
}

const freedCard: PlaybackCard = {
  projectId: 'lc-build:lc:hwy:1',
  kind: 'freed',
  planLabel: 'I-80 truncation',
  where: 'lc:hwy:1',
  units: 120,
  existingUnits: 0,
  stories: 6,
  status: 'complete',
  constructionDay: LESSCARS_START + 400,
  completeDay: LESSCARS_START + 900
};

function setup() {
  workers = [];
  const createWorker = vi.fn(() => {
    const w = new FakePlaybackWorker();
    workers.push(w);
    return w;
  });
  return render(LessCarsModeHost, { props: { data, createWorker } });
}

const init = () => workers[0].posts[0] as { type: string; rev: number };

beforeEach(async () => {
  stub.reset();
  await page.viewport(1024, 768);
  const r = await loadLessCars('fixture-0', fixtureFetch);
  if (r.state !== 'ready') throw new Error(`fixture not ready: ${r.state}`);
  data = r.data;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LessCarsMode', () => {
  it('sends initPlayback with the plan and sites, opens paused at the plan start', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    expect(workers[0].posts[0]).toMatchObject({
      type: 'initPlayback',
      plan: data.plan,
      sites: data.sites
    });
    await expect
      .element(page.getByTestId('fzp-readout-label'))
      .toHaveTextContent(formatMonthYear(LESSCARS_START));
    await expect.element(page.getByTestId('fzp-play-label')).toHaveTextContent('Play');
    expect(callsOf('setTimelineLookups')).toHaveLength(1);
    expect(callsOf('setTime')[0]).toEqual([LESSCARS_START]);
    // The plan layers are installed at once, before any building arrives.
    expect(stub.map.getLayer('lc-lines')).toBeTruthy();
    await expect.element(page.getByText('Loading the buildings…')).toBeVisible();
  });

  it('applies playback revisions to the map handle; playbackLoaded fills the garage source', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    const { rev } = init();
    workers[0].emit({
      type: 'playback',
      rev,
      render: { revision: 0, cells: [], removedCells: [], demolish: [] },
      complete: true
    });
    expect(callsOf('applyTimeline')).toHaveLength(1);
    await expect.element(page.getByText('Loading the buildings…')).not.toBeInTheDocument();
    expect(stub.map.sourceData('lc-garages').features).toHaveLength(0);
    const G = garageParcel();
    workers[0].emit({
      type: 'playbackLoaded',
      rev,
      seed: 1,
      places: { [G]: [-122.418, 37.76] },
      reservations: [{ parcelId: G, kept: true }]
    });
    expect(stub.map.sourceData('lc-garages').features.length).toBeGreaterThan(0);
  });

  it('a voided reservation draws no garage marker', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    const G = garageParcel();
    workers[0].emit({
      type: 'playbackLoaded',
      rev: init().rev,
      seed: 1,
      places: { [G]: [-122.418, 37.76] },
      reservations: [{ parcelId: G, kept: false }]
    });
    expect(stub.map.sourceData('lc-garages').features).toHaveLength(0);
  });

  it('queues playback revisions until the map handle is ready', async () => {
    stub.autoReady = false;
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    const { rev } = init();
    const r0 = { revision: 0, cells: [], removedCells: [], demolish: [] };
    workers[0].emit({ type: 'playback', rev, render: r0, complete: false });
    workers[0].emit({ type: 'playback', rev, render: { ...r0, revision: 1 }, complete: true });
    expect(callsOf('applyTimeline')).toHaveLength(0);
    stub.fireReady();
    expect(callsOf('applyTimeline').map((a) => (a[0] as { revision: number }).revision)).toEqual([
      0, 1
    ]);
  });

  it('a resync after a revision gap re-inits the host and prefetches again', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    const r0 = { revision: 0, cells: [], removedCells: [], demolish: [] };
    const prefetches = () => workers[0].posts.filter((m) => m.type === 'prefetch').length;
    workers[0].emit({ type: 'playback', rev: init().rev, render: r0, complete: true });
    await expect.poll(prefetches).toBe(1);
    expect(stub.resyncCb).toBeTruthy();
    stub.resyncCb!();
    await expect
      .poll(() => workers[0].posts.filter((m) => m.type === 'initPlayback').length)
      .toBe(2);
    const second = workers[0].posts.filter((m) => m.type === 'initPlayback')[1] as { rev: number };
    workers[0].emit({ type: 'playback', rev: second.rev, render: r0, complete: true });
    await expect.poll(prefetches).toBe(2);
  });

  it('puts the headline in the pinned slot and Timeline and Evidence among the actions', async () => {
    setup();
    const pinned = page.getByTestId('header-pinned');
    await expect
      .element(pinned.getByTestId('lc-headline'))
      .toHaveTextContent(headlineText(data.summary));
    await page.getByTestId('header-actions').getByRole('button', { name: 'Timeline' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Project timeline' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await page.getByTestId('header-actions').getByRole('button', { name: 'Evidence' }).click();
    const ev = page.getByRole('dialog', { name: 'Evidence for every number' });
    await expect.element(ev).toBeVisible();
    await expect
      .element(
        ev.getByText('Transit line paths are drawn straight between stations (approximate).')
      )
      .toBeVisible();
  });

  it('opening a dialog pauses playback', async () => {
    setup();
    await page.getByTestId('fzp-play').click();
    await expect.element(page.getByTestId('fzp-play')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('header-actions').getByRole('button', { name: 'Timeline' }).click();
    await expect.element(page.getByTestId('fzp-play')).toHaveAttribute('aria-pressed', 'false');
  });

  it("the timeline's Evidence button opens the evidence dialog on that project", async () => {
    setup();
    await page.getByTestId('header-actions').getByRole('button', { name: 'Timeline' }).click();
    const hwy = data.plan.plan.projects.find((p) => p.id === 'hwy')!;
    await page.getByRole('button', { name: `Evidence for ${hwy.label}` }).click();
    await expect
      .element(page.getByRole('dialog', { name: 'Evidence for every number' }))
      .toBeVisible();
    // Only the evidence dialog is open: the timeline closed itself first.
    expect(
      [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].map((d) => d.dataset.testid)
    ).toEqual(['lc-evidence']);
  });

  it('a worker error shows the failure notice; Retry restarts and re-inits', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    workers[0].emit({ type: 'error', rev: init().rev, code: 'internal', message: 'x' });
    await expect.element(page.getByRole('alert')).toHaveTextContent("Couldn't load the buildings.");
    // The plan layers and the scrubber keep working while the buildings fail.
    await expect.element(page.getByTestId('fzp-play-label')).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].posts[0].type).toBe('initPlayback');
    await expect.element(page.getByText('Loading the buildings…')).toBeVisible();
  });

  it('a worker crash shows the failure notice too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    workers[0].crash();
    await expect.element(page.getByRole('alert')).toHaveTextContent("Couldn't load the buildings.");
  });

  it('a card answer renders the building details; Escape closes it', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    stub.props.timelinePick!({
      projectId: 'lc-build:lc:hwy:1',
      parcelId: 'lc:hwy:1',
      x: 10,
      y: 10,
      kind: 'tap'
    });
    expect(workers[0].posts.at(-1)).toMatchObject({
      type: 'playbackCard',
      projectId: 'lc-build:lc:hwy:1',
      day: LESSCARS_START
    });
    workers[0].emit({ type: 'playbackCard', reqId: workers[0].lastReqId(), card: freedCard });
    const card = page.getByRole('region', { name: 'Building details' });
    await expect.element(card).toHaveTextContent('Built by the plan on freed land');
    await expect.element(card).toHaveTextContent('I-80 truncation');
    await expect.element(card).toHaveTextContent('120 homes');
    await expect.element(card).toHaveTextContent('6 stories');
    await expect.element(card).toHaveTextContent(/Completed \w{3} \d{4}/);
    await userEvent.keyboard('{Escape}');
    await expect.element(card).not.toBeInTheDocument();
  });

  it('a tap on nothing closes the card; a hover opens none', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    const hit = { projectId: 'p', parcelId: 'x', x: 1, y: 1 } as const;
    stub.props.timelinePick!({ ...hit, kind: 'hover' });
    expect(workers[0].lastReqId()).toBe(-1);
    stub.props.timelinePick!({ ...hit, kind: 'tap' });
    workers[0].emit({
      type: 'playbackCard',
      reqId: workers[0].lastReqId(),
      card: {
        ...freedCard,
        kind: 'market',
        planLabel: null,
        where: 'Block 3512, Lot 15',
        existingUnits: 2,
        status: 'construction',
        completeDay: null
      }
    });
    const card = page.getByRole('region', { name: 'Building details' });
    await expect.element(card).toHaveTextContent('Market project');
    await expect.element(card).toHaveTextContent('replacing 2 homes');
    await expect.element(card).toHaveTextContent(/Under construction since \w{3} \d{4}/);
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    await expect.element(card).not.toBeInTheDocument();
  });

  it('the scrubbed day reaches the map and the plan layers', async () => {
    setup();
    await expect.poll(() => workers[0]?.posts.length).toBe(1);
    const slider = page.getByRole('slider', { name: 'Date in the simulation' });
    (slider.element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect.poll(() => callsOf('setTime').length).toBeGreaterThan(1);
    const last = callsOf('setTime').at(-1)![0] as number;
    expect(last).toBeGreaterThan(LESSCARS_START);
  });
});
