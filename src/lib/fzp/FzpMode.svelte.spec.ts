// FzpMode composition (spec §4.1, §4.2, §4.7, §4.8, §6): the real ScenarioClient over a fake
// worker, a recording SimMap stub, and the header slot from a test host.
import { createRawSnippet, type Snippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import type { TimelinePick } from '$lib/map/types';
import type { LeverLookups } from '$lib/sim/levers/apply';
import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS, type SimLevers } from '$lib/sim/levers/types';
import type { ParcelSummary, ProjectCard } from '$lib/sim/protocol';
import type { LeverStatus } from '$lib/sim-page/lever-status';
import { chanceTable, typicalMonths } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { fixtureCalibration } from './fixtures/calibration';
import { REAL_ACTUAL, SIMULATED } from './fixtures/cards';
import { TIMELINE_SCORE } from './fixtures/timeline-score';
import { FakeScenarioWorker, timelineMsg } from './test/fake-worker';
import FzpModeHost from './test/FzpModeHost.svelte';
import { callsOf, stub } from './test/sim-map-stub';
import { HORIZON, dayFromUtc } from './time';

vi.mock('$lib/map/SimMap.svelte', () => import('./test/FzpSimMapStub.svelte'));

const manifest: Manifest = parseManifest(manifestJson);
const calibration = fixtureCalibration();
const ASOF = calibration.asOf;

type Over = Partial<{
  manifest: Manifest | null;
  manifestError: boolean;
  calibration: Calibration | null;
  calibrationError: boolean;
  noScenario: boolean;
  urlSeed: number | null;
  reload: () => Promise<{ manifest: Manifest; calibration: Calibration }>;
  levers: SimLevers;
  onlevers: (s: LeverStatus) => void;
  actions: Snippet;
}>;

function setup(over: Over = {}) {
  const workers: FakeScenarioWorker[] = [];
  const onurlseed = vi.fn<(s: number | null) => void>();
  const reload = vi.fn(over.reload ?? (async () => ({ manifest, calibration })));
  const createWorker = vi.fn(() => {
    const w = new FakeScenarioWorker();
    workers.push(w);
    return w;
  });
  const props = {
    manifest,
    manifestError: false,
    calibration,
    calibrationError: false,
    noScenario: false,
    datasetVersion: 'fixture-0',
    urlSeed: null,
    ...over,
    reload,
    onurlseed,
    createWorker
  };
  const r = render(FzpModeHost, { props });
  return { workers, w: () => workers[workers.length - 1], onurlseed, reload, createWorker, r };
}

async function unmount(s: Setup) {
  (await s.r).unmount();
}

type Setup = ReturnType<typeof setup>;

const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
const another = () => page.getByRole('button', { name: 'Another future' });
/**
 * Activates 'Another future' with no pointer press (as the keyboard does), so open score details
 * stay open: a press outside them closes them.
 */
const anotherKeyed = () => (another().element() as HTMLElement).click();
const statusText = () =>
  [...document.querySelectorAll('[data-testid="fzp-status"]')].map((e) => e.textContent?.trim());
/** The header's score bar (the pinned slot). */
const scoreButton = () =>
  page.getByTestId('header-pinned').getByRole('button', { name: /homes added|Simulating/ });
/** Opens the score details from the score bar (once) and returns them. */
async function details() {
  const b = scoreButton();
  await expect.element(b).toBeInTheDocument();
  if (b.element().getAttribute('aria-expanded') !== 'true') await b.click();
  return page.getByRole('region', { name: 'Score details' });
}
const futureLine = async () => (await details()).getByText(/^This future: #/).first();
const card = () => page.getByRole('region', { name: /1234 Mission St|Block 3512|Project details/ });

/** The latest scenario request's rev on the current worker. */
function lastRev(w: FakeScenarioWorker): number {
  const reqs = w.posts.filter((p) => p.type === 'initScenario' || p.type === 'reroll');
  return (reqs[reqs.length - 1] as { rev: number }).rev;
}

async function toReady(s: Setup, seed = 7) {
  await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
  const w = s.w();
  const rev = lastRev(w);
  w.emit({ type: 'ready', rev, datasetVersion: 'fixture-0', chunkCount: 4 });
  w.emit(timelineMsg(rev, seed));
  await expect.element(slider()).toBeInTheDocument();
}

function summary(project?: ProjectCard): ParcelSummary {
  return {
    parcelId: 'p1',
    neighborhood: 'Mission',
    landUse: 'residential',
    eligible: true,
    existingUnits: 2,
    envelope: null,
    generated: null,
    ...(project && { project })
  };
}

function pick(p: TimelinePick) {
  stub.props.timelinePick?.(p);
}

async function answerLastSummary(w: FakeScenarioWorker, s: ParcelSummary | null) {
  await expect.poll(() => w.lastSummary()).toBeTruthy();
  w.emit({ type: 'parcelSummary', reqId: w.lastSummary()!.reqId, summary: s });
}

async function press(key: string) {
  (slider().element() as HTMLElement).focus();
  await userEvent.keyboard(key);
}

beforeEach(async () => {
  stub.reset();
  await page.viewport(1024, 768);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FzpMode loading and lookups', () => {
  it('stays loading after `ready` and becomes ready on the first timeline', async () => {
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    const init = s.w().lastOf('initScenario')!;
    expect(init).toMatchObject({ scenario: 'fzp', seed: null, horizon: HORIZON });
    expect(init.manifest).toBe(manifest);
    await expect
      .element(page.getByRole('status').getByText('Loading the simulation…'))
      .toBeVisible();
    s.w().emit({ type: 'ready', rev: init.rev, datasetVersion: 'fixture-0', chunkCount: 4 });
    await expect
      .element(page.getByRole('status').getByText('Loading the simulation…'))
      .toBeVisible();
    expect(slider().elements()).toHaveLength(0);
    s.w().emit(timelineMsg(init.rev, 7));
    await expect.element(slider()).toBeInTheDocument();
    expect(statusText().filter(Boolean)).toEqual([]);
    expect(slider().element().getAttribute('min')).toBe(String(ASOF));
  });

  it('calls setTimelineLookups first, with the same lookup objects every time', async () => {
    stub.autoReady = false;
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    const rev = lastRev(s.w());
    s.w().emit(timelineMsg(rev, 7, { revision: 0 }));
    s.w().emit(timelineMsg(rev, 7, { revision: 1 }));
    stub.fireReady();
    const methods = stub.calls.map((c) => c.method).filter((m) => m !== 'getMap');
    expect(methods.slice(0, 5)).toEqual([
      'setTimelineLookups',
      'applyTimeline',
      'applyTimeline',
      'setTime',
      'setBottomInset'
    ]);
    expect(methods).toContain('onResyncNeeded');
    const [l] = callsOf('setTimelineLookups')[0] as [{ chance: unknown; typicalMonths: unknown }];
    expect(l.chance).toEqual(chanceTable(calibration));
    expect(l.typicalMonths).toEqual(typicalMonths(calibration));
    expect(callsOf('setTime')[0]).toEqual([ASOF]);

    // A second mount with the same calibration object gets the very same lookup objects.
    await unmount(s);
    stub.reset();
    setup();
    await expect.poll(() => callsOf('setTimelineLookups').length).toBe(1);
    const [again] = callsOf('setTimelineLookups')[0] as [typeof l];
    expect(again.chance).toBe(l.chance);
    expect(again.typicalMonths).toBe(l.typicalMonths);
  });

  it('flushes queued updates in order, and revision 0 clears earlier ones', async () => {
    stub.autoReady = false;
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    const rev = lastRev(s.w());
    for (const revision of [0, 1, 2, 0, 1]) s.w().emit(timelineMsg(rev, 7, { revision }));
    stub.fireReady();
    const applied = callsOf('applyTimeline').map((a) => (a[0] as { revision: number }).revision);
    expect(applied).toEqual([0, 1]);
  });

  it('after onready: setTime, setBottomInset and onResyncNeeded go to the live handle', async () => {
    const s = setup();
    await toReady(s);
    expect(callsOf('setBottomInset').length).toBeGreaterThan(0);
    expect(stub.resyncCb).toBeTypeOf('function');
    await press('{ArrowRight}');
    expect(callsOf('setTime').at(-1)).toEqual([dayFromUtc(2026, 11, 1)]);
  });

  it('logs a calibration asOf in another month than score.months[0] once and keeps asOf', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    const rev = lastRev(s.w());
    const shifted = { ...TIMELINE_SCORE, months: TIMELINE_SCORE.months.map((m) => m + 31) };
    s.w().emit(timelineMsg(rev, 7, { score: shifted }));
    s.w().emit(timelineMsg(rev, 7, { score: shifted, revision: 1 }));
    await expect.element(slider()).toBeInTheDocument();
    expect(err).toHaveBeenCalledTimes(1);
    expect(slider().element().getAttribute('min')).toBe(String(ASOF));
  });

  it('passes SimMap the transit-off view and no theme', async () => {
    setup();
    await expect.poll(() => stub.props.view).toEqual({ transitStops: false, transitAccess: false });
    expect('theme' in stub.props).toBe(false);
    expect(stub.props.timelinePick).toBeTypeOf('function');
  });
});

describe('FzpMode failures and Retry', () => {
  it('fails on an error before ready, and Retry re-sends initScenario with the same seed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup({ urlSeed: 5 });
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    s.w().emit({ type: 'error', rev: lastRev(s.w()), code: 'internal', message: 'x' });
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("The simulation couldn't load.");
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.w().allOf('initScenario').length).toBe(2);
    expect(s.w().lastOf('initScenario')!.seed).toBe(5);
    expect(err).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole('status')).toHaveTextContent('Loading the simulation…');
  });

  it('shows the dataset copy on scenario-missing and retries with seed null', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    s.w().emit({ type: 'error', rev: lastRev(s.w()), code: 'scenario-missing', message: 'x' });
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('The simulation data for dataset fixture-0 is missing or damaged.');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.w().allOf('initScenario').length).toBe(2);
    expect(s.w().lastOf('initScenario')!.seed).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('fails on a crash before ready', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    s.w().crash();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("The simulation couldn't load.");
  });

  it('retry with a failing reload stays failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup({
      manifest: null,
      manifestError: true,
      calibration: null,
      reload: async () => {
        throw new Error('still down');
      }
    });
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("The simulation couldn't load.");
    expect(s.w().posts).toEqual([]);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.reload.mock.calls.length).toBe(1);
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("The simulation couldn't load.");
    await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(s.w().posts.filter((p) => p.type === 'initScenario')).toEqual([]);
  });

  it('a successful reload after a calibration failure sends initScenario and the new lookups', async () => {
    const fresh = structuredClone(calibration);
    const s = setup({
      calibration: null,
      calibrationError: true,
      reload: async () => ({ manifest, calibration: fresh })
    });
    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(callsOf('setTimelineLookups')).toEqual([]);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.w().allOf('initScenario').length).toBe(1);
    expect(callsOf('setTimelineLookups')).toHaveLength(1);
    const [l] = callsOf('setTimelineLookups')[0] as [{ chance: unknown }];
    expect(l.chance).toEqual(chanceTable(fresh));
  });

  it('crash after ready: chip, scrubbing works, card unavailable, Retry restarts with the seed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await toReady(s, 99);
    s.w().emit({
      type: 'chunks',
      status: { '50_25': 'error', '50_26': 'ready' },
      pending: 0,
      failed: ['50_25']
    });
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByTestId('card-badge')).toHaveTextContent('Real project');

    s.w().crash();
    await expect
      .element(page.getByRole('status').getByText('Part of the simulation stopped.'))
      .toBeVisible();
    await expect.element(page.getByText('Details unavailable')).toBeVisible();
    const before = callsOf('setTime').length;
    await press('{PageUp}');
    expect(callsOf('setTime').length).toBe(before + 1);

    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.workers.length).toBe(2);
    expect(s.workers[0].terminated).toBe(true);
    const statuses = callsOf('setChunkStatus').slice(-2);
    expect(statuses).toEqual([
      ['50_25', 'ready'],
      ['50_26', 'ready']
    ]);
    await expect.poll(() => s.w().posts.length).toBe(1);
    expect(s.w().posts[0]).toMatchObject({ type: 'initScenario', seed: 99 });
    expect(s.reload).not.toHaveBeenCalled();

    // Retry's first timeline: the chip goes and the open card asks the new worker again.
    s.w().emit(timelineMsg(lastRev(s.w()), 99));
    await expect
      .poll(() => s.w().lastSummary())
      .toMatchObject({
        parcelId: 'p1',
        projectId: 'pr-1'
      });
    await expect.poll(() => statusText().filter(Boolean)).toEqual([]);
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByTestId('card-badge')).toHaveTextContent('Real project');
    expect(page.getByText('Details unavailable').elements()).toEqual([]);
  });

  it('an error answering a crash Retry in ready keeps the chip and its Retry', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await toReady(s, 99);
    s.w().crash();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.workers.length).toBe(2);
    await expect.poll(() => s.w().lastOf('initScenario')).toBeTruthy();
    s.w().emit({ type: 'error', rev: lastRev(s.w()), code: 'internal', message: 'x' });
    await expect
      .element(page.getByRole('status').getByText('Part of the simulation stopped.'))
      .toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(page.getByRole('alert').elements()).toEqual([]);
    await expect.element(slider()).toBeInTheDocument();
    expect(err).toHaveBeenCalled();
  });

  it('a manifest-invalid Retry sends the reloaded manifest, not the rejected one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = parseManifest(manifestJson);
    const s = setup({ reload: async () => ({ manifest: fresh, calibration }) });
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    s.w().emit({ type: 'error', rev: lastRev(s.w()), code: 'manifest-invalid', message: 'x' });
    await expect.element(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.w().allOf('initScenario').length).toBe(2);
    expect(s.reload).toHaveBeenCalledTimes(1);
    expect(fresh).not.toBe(manifest);
    expect(s.w().lastOf('initScenario')!.manifest).toBe(fresh);
    await expect.poll(() => stub.props.manifest).toBe(fresh);
  });

  it('pending request at crash shows Details unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await toReady(s);
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await expect.poll(() => s.w().lastSummary()).toBeTruthy();
    s.w().crash();
    await expect.element(page.getByText('Details unavailable')).toBeVisible();
    expect(page.getByText('Project details are still loading for this area.').elements()).toEqual(
      []
    );
  });
});

describe('FzpMode header score bar', () => {
  it('renders no scoreboard region; the header pinned slot holds the score bar', async () => {
    const s = setup();
    await expect.element(scoreButton()).toHaveTextContent('Simulating…');
    await toReady(s);
    expect(document.querySelector('[aria-label="Simulation scoreboard"]')).toBeNull();
    await expect.element(scoreButton()).toHaveTextContent(/^[\d,]+ homes added$/);
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'false');
    const board = await details();
    await expect.element(board.getByTestId('fzp-net')).toBeVisible();
    await expect
      .element(page.getByTestId('header-actions').getByRole('button', { name: 'Another future' }))
      .toBeVisible();
  });
});

describe('FzpMode on /sim: header actions and score copy', () => {
  it('renders the page actions first in the header, and names your policy in the details', async () => {
    const actions = createRawSnippet(() => ({
      render: () => '<button type="button">Policy</button>'
    }));
    const s = setup({ levers: DEFAULT_LEVERS, actions });
    await toReady(s);
    const names = [...page.getByTestId('header-actions').element().querySelectorAll('button')].map(
      (b) => b.textContent?.trim()
    );
    expect(names).toEqual(['Policy', 'Another future']);
    const board = await details();
    await expect.element(board.getByText('What your policy added')).toBeVisible();
  });

  it('keeps the Family Zoning Plan copy without levers (/fzp)', async () => {
    const s = setup();
    await toReady(s);
    const board = await details();
    await expect.element(board.getByText('What the plan added')).toBeVisible();
  });
});

describe('FzpMode rerolls and the representative flag', () => {
  it("'Another future' keeps the play state", async () => {
    const s = setup();
    await toReady(s, 7);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await another().click();
    s.w().emit(timelineMsg(s.w().lastOf('reroll')!.rev, 8));
    await expect.element(await futureLine()).toHaveTextContent(/^This future: #8$/);
    await expect.element(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });

  it('a failed-reroll notice does not come back after a crash Retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await toReady(s, 7);
    await another().click();
    s.w().emit({ type: 'error', rev: s.w().lastOf('reroll')!.rev, code: 'internal', message: 'x' });
    await expect.element(page.getByRole('alert')).toBeVisible();
    s.w().crash();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.workers.length).toBe(2);
    await expect.poll(() => s.w().lastOf('initScenario')).toBeTruthy();
    s.w().emit(timelineMsg(lastRev(s.w()), 7));
    await expect.poll(() => statusText().filter(Boolean)).toEqual([]);
    expect(page.getByRole('alert').elements()).toEqual([]);
  });

  it("'Another future' rerolls, keeps the day, writes the URL, and ignores a stale timeline", async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint32Array) => {
      a[0] = 4242;
      return a;
    }) as typeof crypto.getRandomValues);
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    await expect.element(another()).toBeDisabled();
    await toReady(s, 7);
    await expect.element(await futureLine()).toHaveTextContent('This future: #7 (representative)');
    await press('{PageUp}');
    const day = Number((slider().element() as HTMLInputElement).value);

    await another().click();
    const reroll = s.w().lastOf('reroll')!;
    expect(reroll.seed).toBe(4242);
    await expect.element(another()).toHaveAttribute('aria-busy', 'true');
    await expect.element(another()).toBeDisabled();
    await expect
      .element(page.getByRole('status').getByText('Making another future…'))
      .toBeVisible();

    const applied = callsOf('applyTimeline').length;
    s.w().emit(timelineMsg(reroll.rev, 4242));
    await expect.element(await futureLine()).toHaveTextContent(/^This future: #4242$/);
    expect(s.onurlseed.mock.calls).toEqual([[4242]]);
    expect(Number((slider().element() as HTMLInputElement).value)).toBe(day);
    await expect.element(another()).toBeEnabled();
    expect(callsOf('applyTimeline').length).toBe(applied + 1);

    // A late answer to the first scenario rev is stale: dropped.
    s.w().emit(timelineMsg(reroll.rev - 1, 7, { revision: 1 }));
    expect(callsOf('applyTimeline').length).toBe(applied + 1);
    await expect.element(await futureLine()).toHaveTextContent(/^This future: #4242$/);
  });

  it("'Back to the representative future' sends reroll null and clears the URL seed", async () => {
    const s = setup({ urlSeed: 5 });
    await toReady(s, 5);
    await expect.element(await futureLine()).toHaveTextContent(/^This future: #5$/);
    await (
      await details()
    )
      .getByRole('button', { name: 'Back to the representative future' })
      .first()
      .click();
    const reroll = s.w().lastOf('reroll')!;
    expect(reroll.seed).toBeNull();
    s.w().emit(timelineMsg(reroll.rev, 31));
    await expect.element(await futureLine()).toHaveTextContent('This future: #31 (representative)');
    expect(s.onurlseed.mock.calls).toEqual([[null]]);
  });

  it("'Back to the representative future' is disabled while a reroll is busy or the worker stopped", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup({ urlSeed: 5 });
    await toReady(s, 5);
    const board = await details();
    const back = () =>
      board.getByRole('button', { name: 'Back to the representative future' }).first();
    await expect.element(back()).not.toHaveAttribute('aria-disabled');

    anotherKeyed();
    const reroll = s.w().lastOf('reroll')!;
    await expect.element(back()).toHaveAttribute('aria-disabled', 'true');
    (back().element() as HTMLElement).click();
    expect(s.w().allOf('reroll')).toHaveLength(1);
    s.w().emit(timelineMsg(reroll.rev, 6));
    await expect.element(back()).not.toHaveAttribute('aria-disabled');

    s.w().crash();
    await expect.element(back()).toHaveAttribute('aria-disabled', 'true');
    (back().element() as HTMLElement).click();
    expect(s.w().allOf('reroll')).toHaveLength(1);
  });

  it('onResyncNeeded calls client.resync: one reroll per episode, flag kept', async () => {
    const s = setup();
    await toReady(s, 7);
    const before = s.w().allOf('reroll').length;
    stub.resyncCb!();
    stub.resyncCb!();
    expect(s.w().allOf('reroll').length).toBe(before + 1);
    const r = s.w().lastOf('reroll')!;
    expect(r.seed).toBe(7);
    s.w().emit(timelineMsg(r.rev, 7));
    await expect.element(await futureLine()).toHaveTextContent('This future: #7 (representative)');
    expect(s.onurlseed).not.toHaveBeenCalled();
  });

  it('the representative flag survives a crash Retry and never shows for a URL seed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await toReady(s, 7);
    s.w().crash();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.workers.length).toBe(2);
    await expect.poll(() => s.w().lastOf('initScenario')).toBeTruthy();
    s.w().emit(timelineMsg(lastRev(s.w()), 7));
    await expect.element(await futureLine()).toHaveTextContent('This future: #7 (representative)');
    await unmount(s);

    stub.reset();
    const t = setup({ urlSeed: 5 });
    await toReady(t, 5);
    await expect.element(await futureLine()).toHaveTextContent(/^This future: #5$/);
  });

  it('a reroll error in ready keeps the shown future and shows a dismissible notice', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await toReady(s, 7);
    await another().click();
    const r = s.w().lastOf('reroll')!;
    s.w().emit({ type: 'error', rev: r.rev, code: 'internal', message: 'x' });
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("Couldn't make another future. Try again.");
    await expect.element(await futureLine()).toHaveTextContent('This future: #7 (representative)');
    await expect.element(slider()).toBeInTheDocument();
    await expect.element(another()).toBeEnabled();
    expect(err).toHaveBeenCalledTimes(1);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    expect(page.getByRole('alert').elements()).toEqual([]);
  });
});

describe('FzpMode picks and summaries', () => {
  it('hover hit shows the tooltip only; tap hit opens the card; both carry projectId', async () => {
    const s = setup();
    await toReady(s);
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 50, kind: 'hover' });
    expect(s.w().lastSummary()).toMatchObject({
      parcelId: 'p1',
      day: ASOF,
      projectId: 'pr-1'
    });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('1234 Mission St');
    expect(card().elements()).toEqual([]);

    pick({ projectId: 'pr-1', parcelId: 'p2', x: 40, y: 50, kind: 'tap' });
    expect(s.w().lastSummary()).toMatchObject({ parcelId: 'p2', projectId: 'pr-1' });
    await expect.poll(() => page.getByRole('tooltip').elements().length).toBe(0);
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByTestId('card-badge')).toHaveTextContent('Real project');
  });

  it('a hover miss hides the tooltip and keeps the card; a tap miss closes the card', async () => {
    const s = setup();
    await toReady(s);
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    pick({ projectId: 'pr-9', parcelId: 'p3', x: 40, y: 50, kind: 'hover' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByRole('tooltip')).toBeVisible();

    pick({ projectId: null, kind: 'hover' });
    await expect.poll(() => page.getByRole('tooltip').elements().length).toBe(0);
    await expect.element(page.getByTestId('card-badge')).toBeVisible();

    pick({ projectId: 'pr-9', parcelId: 'p3', x: 40, y: 50, kind: 'hover' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    pick({ projectId: null, kind: 'tap' });
    await expect.poll(() => card().elements().length).toBe(0);
    await expect.poll(() => page.getByRole('tooltip').elements().length).toBe(0);
  });

  it('requestParcelSummary sends the scrubbed day without projectId and drops generated', async () => {
    const s = setup();
    await toReady(s);
    await press('{PageUp}');
    const day = Number((slider().element() as HTMLInputElement).value);
    const p = stub.props.requestParcelSummary!('p1');
    const req = s.w().lastSummary()!;
    expect(req).toEqual({ type: 'parcelSummary', reqId: req.reqId, parcelId: 'p1', day });
    s.w().emit({
      type: 'parcelSummary',
      reqId: req.reqId,
      summary: { ...summary(), generated: { typology: 'walkup', stories: 4, units: 8 } }
    });
    await expect(p).resolves.toEqual({
      parcelId: 'p1',
      eligible: true,
      existingUnits: 2,
      generated: null
    });
  });

  it('the card re-requests on a month change; a null answer re-requests on chunks', async () => {
    const s = setup();
    await toReady(s);
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    const count = () => s.w().allOf('parcelSummary').length;
    const n = count();
    await press('{ArrowRight}');
    expect(count()).toBe(n + 1);
    expect(s.w().lastSummary()!.day).toBe(dayFromUtc(2026, 11, 1));
    // One in flight: further month changes wait behind it.
    await press('{ArrowRight}');
    await press('{ArrowRight}');
    expect(count()).toBe(n + 1);
    await answerLastSummary(s.w(), null);
    await expect.poll(count).toBe(n + 2);
    expect(s.w().lastSummary()!.day).toBe(dayFromUtc(2027, 1, 1));
    await answerLastSummary(s.w(), null);
    await expect
      .element(page.getByText('Project details are still loading for this area.'))
      .toBeVisible();
    s.w().emit({ type: 'chunks', status: { '50_25': 'ready' }, pending: 0, failed: [] });
    expect(count()).toBe(n + 3);
    expect(s.w().lastSummary()).toMatchObject({ parcelId: 'p1', projectId: 'pr-1' });
  });

  it('scrub back before the project shows No project', async () => {
    const s = setup();
    await toReady(s);
    await press('{PageUp}');
    await press('{PageUp}');
    pick({ projectId: 'sim-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await answerLastSummary(s.w(), summary(SIMULATED));
    await expect.element(page.getByTestId('card-badge')).toHaveTextContent('Simulated project');
    await press('{Home}');
    await expect.poll(() => s.w().lastSummary()!.day).toBe(ASOF);
    await answerLastSummary(s.w(), summary());
    await expect.element(page.getByText('No project on this parcel at this date.')).toBeVisible();
  });

  it('the card re-requests on a reroll answer', async () => {
    const s = setup();
    await toReady(s);
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    const n = s.w().allOf('parcelSummary').length;
    await another().click();
    s.w().emit(timelineMsg(s.w().lastOf('reroll')!.rev, 11));
    await expect.poll(() => s.w().allOf('parcelSummary').length).toBe(n + 1);
  });
});

describe('FzpMode map, layout and lifecycle', () => {
  it('prefetches the viewport after the first timeline and on every moveend, at any zoom', async () => {
    const s = setup();
    await toReady(s);
    expect(s.w().allOf('prefetch')).toEqual([
      { type: 'prefetch', bbox: [-122.45, 37.75, -122.4, 37.78] }
    ]);
    s.w().emit(timelineMsg(lastRev(s.w()), 7, { revision: 1 }));
    expect(s.w().allOf('prefetch')).toHaveLength(1);
    stub.map.zoom = 10;
    stub.map.bounds = [-122.6, 37.7, -122.3, 37.85];
    stub.map.fire('moveend');
    expect(s.w().lastOf('prefetch')).toEqual({
      type: 'prefetch',
      bbox: [-122.6, 37.7, -122.3, 37.85]
    });
  });

  it('no-scenario never creates a worker and shows the editor link only', async () => {
    const s = setup({ noScenario: true, calibration: null });
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(
        "The Family Zoning Plan timelapse isn't available for dataset fixture-0. It needs simulation data that this dataset doesn't have."
      );
    await expect
      .element(page.getByRole('link', { name: 'Go to the editor' }))
      .toHaveAttribute('href', '/');
    expect(s.createWorker).not.toHaveBeenCalled();
    expect(slider().elements()).toEqual([]);
    expect(scoreButton().elements()).toEqual([]);
    expect(another().elements()).toEqual([]);
    expect(page.getByTestId('fzp-sim-map-stub').elements()).toHaveLength(1);
  });

  it('opening the sources dialog pauses playback; opening a card does not', async () => {
    const s = setup();
    await toReady(s);
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await play.click();
    await expect.element(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
    await answerLastSummary(s.w(), summary(REAL_ACTUAL));
    await expect.element(page.getByTestId('card-badge')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    (
      (await details())
        .getByRole('button', { name: 'Where these numbers come from' })
        .first()
        .element() as HTMLElement
    ).click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    const toggle = page.getByTestId('fzp-scrubber').element().querySelector('button')!;
    await expect.poll(() => toggle.textContent?.trim()).toBe('Play');
  });

  it('sets the map inset from the scrubber and --fzp-scrubber-h on its root', async () => {
    const s = setup();
    await toReady(s);
    const scrubber = page.getByTestId('fzp-scrubber').element() as HTMLElement;
    const h = scrubber.offsetHeight;
    expect(h).toBeGreaterThan(0);
    await expect.poll(() => callsOf('setBottomInset').at(-1)).toEqual([h]);
    const root = document.querySelector('.sfh-fzp') as HTMLElement;
    expect(root.style.getPropertyValue('--fzp-scrubber-h')).toBe(`${h}px`);
  });

  it.each([375, 768, 900, 1000, 1280])(
    'at %i px the notices never cover the card or the score panel',
    async (width) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await page.viewport(width, 800);
      // SimMap's contract (docs/dev/map-interfaces.md): the controls' top includes the inset.
      const syncControls = () => {
        const inset = callsOf('setBottomInset').at(-1)?.[0] ?? 0;
        document.documentElement.style.setProperty('--map-controls-br-block-size', `${inset}px`);
      };
      try {
        const s = setup();
        await toReady(s);
        await details();
        pick({ projectId: 'pr-1', parcelId: 'p1', x: 10, y: 10, kind: 'tap' });
        await answerLastSummary(s.w(), summary(REAL_ACTUAL));
        await expect.element(page.getByTestId('card-badge')).toBeVisible();

        const rect = (el: Element) => el.getBoundingClientRect();
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        /** The card and the score details (open), under the header. */
        const covered = () =>
          [card().element(), ...document.querySelectorAll('[data-testid="score-details"]')]
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map(rect);
        const check = async (notice: () => Element) => {
          await expect.poll(() => rect(notice()).height).toBeGreaterThan(0);
          await expect
            .poll(() => {
              syncControls();
              return covered().filter((r) => overlaps(rect(notice()), r)).length;
            })
            .toBe(0);
          expect(covered().length).toBeGreaterThanOrEqual(2);
        };

        anotherKeyed();
        await check(() => page.getByText('Making another future…').element());
        s.w().emit({
          type: 'error',
          rev: s.w().lastOf('reroll')!.rev,
          code: 'internal',
          message: 'x'
        });
        await check(() => page.getByRole('alert').element());
        s.w().crash();
        await check(
          () => page.getByText('Part of the simulation stopped.').element().parentElement!
        );
      } finally {
        document.documentElement.style.removeProperty('--map-controls-br-block-size');
      }
    }
  );

  it('at 375 px with the score details open, every notice shows on top, below them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await page.viewport(375, 800);
    const s = setup();
    await toReady(s);
    const board = await details();
    await expect.element(board).toBeVisible();

    /** The element is on top at its centre and wholly below the details. */
    const onTop = (el: Element) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const d = (board.element() as HTMLElement).getBoundingClientRect();
      return r.height > 0 && !!top && el.contains(top) && r.top >= d.bottom;
    };

    anotherKeyed();
    const busy = () => page.getByText('Making another future…').element();
    await expect.poll(() => onTop(busy())).toBe(true);
    s.w().emit({ type: 'error', rev: s.w().lastOf('reroll')!.rev, code: 'internal', message: 'x' });
    await expect
      .poll(() => onTop(page.getByRole('button', { name: 'Dismiss' }).element()))
      .toBe(true);
    expect(onTop(page.getByRole('alert').element())).toBe(true);
    s.w().crash();
    const retry = () => page.getByRole('button', { name: 'Retry', exact: true }).element();
    await expect.poll(() => onTop(retry())).toBe(true);
    await expect.element(board).toBeVisible();
  });

  it.each([768, 1000])(
    'at %i px the loading notice clears the open score details',
    async (width) => {
      await page.viewport(width, 800);
      setup();
      const notice = page.getByText('Loading the simulation…', { exact: true }).first();
      await expect.element(notice).toBeVisible();
      await expect.element(scoreButton()).toHaveTextContent('Simulating…');
      const board = await details();
      await expect.element(board).toBeVisible();
      const n = (
        document.querySelector('[data-testid="fzp-status"]') as HTMLElement
      ).getBoundingClientRect();
      const p = (board.element() as HTMLElement).getBoundingClientRect();
      expect(n.left < p.right && p.left < n.right && n.top < p.bottom && p.top < n.bottom).toBe(
        false
      );
    }
  );

  it('below 768 px the inset is the scrubber alone, with the score details open or not', async () => {
    await page.viewport(375, 800);
    const s = setup();
    await toReady(s);
    const scrubber = page.getByTestId('fzp-scrubber').element() as HTMLElement;
    await expect.poll(() => scrubber.offsetHeight).toBeGreaterThan(0);
    await expect.poll(() => callsOf('setBottomInset').at(-1)).toEqual([scrubber.offsetHeight]);
    const wrapper = scrubber.parentElement as HTMLElement;
    const root = document.querySelector('.sfh-fzp') as HTMLElement;
    expect(wrapper.getBoundingClientRect().bottom).toBe(root.getBoundingClientRect().bottom);

    await details();
    await expect.poll(() => callsOf('setBottomInset').at(-1)).toEqual([scrubber.offsetHeight]);
  });

  it('the score details end above the scrubber dock, and --fzp-dock-top leaves on unmount', async () => {
    await page.viewport(1024, 768);
    const s = setup();
    await toReady(s);
    const board = await details();
    await expect.element(board).toBeVisible();
    const scrubber = page.getByTestId('fzp-scrubber').element() as HTMLElement;
    await expect
      .poll(() => (board.element() as HTMLElement).getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(scrubber.getBoundingClientRect().top);
    expect(document.documentElement.style.getPropertyValue('--fzp-dock-top')).not.toBe('');
    await unmount(s);
    expect(document.documentElement.style.getPropertyValue('--fzp-dock-top')).toBe('');
  });

  it('unmount terminates the worker and leaves no frame loop pending', async () => {
    const s = setup();
    await toReady(s);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    await unmount(s);
    expect(s.w().terminated).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(stub.map.listenerCount('moveend')).toBe(0);
    const n = callsOf('setTime').length;
    await new Promise((r) => setTimeout(r, 50));
    expect(callsOf('setTime').length).toBe(n);
  });
});

describe('FzpMode levers (/sim)', () => {
  /** A distinct lookups pair, so identity checks can tell it from the calibration's. */
  function postedLookups(): LeverLookups {
    const one = () => ({
      chance: chanceTable(calibration),
      typicalMonths: typicalMonths(calibration)
    });
    return { inFlight: one(), fresh: one() };
  }
  const CAPACITY = { plan: 10, withoutProtections: 10, protectedLots: 0, afterSwitch: null };

  /** The rev the levers last went out on (the init or the latest setLevers). */
  function leverRev(w: FakeScenarioWorker): number {
    const reqs = w.posts.filter((p) => p.type === 'initScenario' || p.type === 'setLevers');
    return (reqs[reqs.length - 1] as { rev: number }).rev;
  }

  it('the first request carries the levers; a new levers object sends one setLevers', async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    expect(s.w().lastOf('initScenario')!.levers).toBe(DEFAULT_LEVERS);
    expect(s.w().allOf('setLevers')).toEqual([]);
    await toReady(s);
    const next: SimLevers = { ...FZP_COMPAT_LEVERS };
    await (await s.r).rerender({ levers: next });
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    expect(s.w().lastOf('setLevers')!.levers).toBe(next);
    // The same object again sends nothing.
    await (await s.r).rerender({ levers: next });
    await new Promise((res) => setTimeout(res, 50));
    expect(s.w().allOf('setLevers')).toHaveLength(1);
  });

  it('a levers change before the first timeline waits for it', async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    const next: SimLevers = { ...FZP_COMPAT_LEVERS };
    await (await s.r).rerender({ levers: next });
    await new Promise((res) => setTimeout(res, 50));
    expect(s.w().allOf('setLevers')).toEqual([]);
    await toReady(s);
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    expect(s.w().lastOf('setLevers')!.levers).toBe(next);
  });

  it('/fzp sends no levers', async () => {
    const s = setup();
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    expect('levers' in s.w().lastOf('initScenario')!).toBe(false);
  });

  it("posted lookups replace the calibration's", async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await expect.poll(() => s.w()?.lastOf('initScenario')).toBeTruthy();
    await expect.poll(() => callsOf('setTimelineLookups').length).toBe(1);
    const base = (callsOf('setTimelineLookups')[0] as [{ chance: unknown }])[0];
    expect(base.chance).toEqual(chanceTable(calibration));
    const lookups = postedLookups();
    const rev = leverRev(s.w());
    s.w().emit({
      type: 'levers',
      rev,
      phase: 'current',
      lookups,
      capacity: CAPACITY,
      unknownLots: 0
    });
    await expect.poll(() => callsOf('setTimelineLookups').length).toBe(2);
    expect(base).not.toHaveProperty('inFlight');
    // the new projects' set at the top level, the in-flight one as `inFlight` (Call 15)
    const sent = callsOf('setTimelineLookups')[1][0] as Record<string, unknown>;
    expect(sent.chance).toBe(lookups.fresh.chance);
    expect(sent.typicalMonths).toBe(lookups.fresh.typicalMonths);
    expect(sent.inFlight).toBe(lookups.inFlight);
    // the same posted lookups again: SimMap already holds them, so nothing is sent
    s.w().emit({
      type: 'levers',
      rev,
      phase: 'current',
      lookups,
      capacity: CAPACITY,
      unknownLots: 0
    });
    await new Promise((res) => setTimeout(res, 50));
    expect(callsOf('setTimelineLookups')).toHaveLength(2);
  });

  it('a stale current keeps the lookups', async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await toReady(s);
    const initRev = leverRev(s.w());
    await (await s.r).rerender({ levers: { ...FZP_COMPAT_LEVERS } });
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    const before = callsOf('setTimelineLookups').length;
    s.w().emit({
      type: 'levers',
      rev: initRev,
      phase: 'current',
      lookups: postedLookups(),
      capacity: CAPACITY,
      unknownLots: 0
    });
    await new Promise((res) => setTimeout(res, 50));
    expect(callsOf('setTimelineLookups')).toHaveLength(before);
  });

  it('resolving shows the updating notice with done/total; current removes it', async () => {
    const onlevers = vi.fn<(st: LeverStatus) => void>();
    const s = setup({ levers: DEFAULT_LEVERS, onlevers });
    await toReady(s);
    await expect.element(scoreButton()).toHaveAttribute('aria-busy', 'false');
    await (await s.r).rerender({ levers: { ...FZP_COMPAT_LEVERS } });
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    const rev = leverRev(s.w());
    s.w().emit({ type: 'levers', rev, phase: 'resolving', done: 2, total: 5, failedCells: [] });
    const notice = page
      .getByRole('status')
      .getByText('Updating the simulation for your policy… 2 of 5 lots');
    await expect.element(notice).toBeVisible();
    expect(onlevers.mock.calls.at(-1)![0]).toMatchObject({ kind: 'resolving', done: 2, total: 5 });
    await expect.element(scoreButton()).toHaveAttribute('aria-busy', 'true');
    s.w().emit({
      type: 'levers',
      rev,
      phase: 'current',
      lookups: postedLookups(),
      capacity: CAPACITY,
      unknownLots: 0
    });
    await expect
      .element(page.getByText(/Updating the simulation for your policy/))
      .not.toBeInTheDocument();
    expect(onlevers.mock.calls.at(-1)![0]).toMatchObject({ kind: 'current', rev });
    // The score stays the last run's, busy, until the new run's timeline arrives.
    const board = await details();
    await expect.element(scoreButton()).toHaveAttribute('aria-busy', 'true');
    await expect.element(board).toHaveAttribute('aria-busy', 'true');
    s.w().emit(timelineMsg(rev, 7));
    await expect.element(scoreButton()).toHaveAttribute('aria-busy', 'false');
    await expect.element(board).toHaveAttribute('aria-busy', 'false');
  });

  it('a failed revision shows an alert whose Retry restarts with the latest levers', async () => {
    const onlevers = vi.fn<(st: LeverStatus) => void>();
    const s = setup({ levers: DEFAULT_LEVERS, onlevers });
    await toReady(s);
    // The alert region is in the accessibility tree before it has anything to say.
    const region = page.getByTestId('fzp-lever-failed');
    await expect.element(region).toBeInTheDocument();
    expect(region.element().getAttribute('role')).toBe('alert');
    expect(region.element().textContent?.trim()).toBe('');
    expect(getComputedStyle(region.element()).display).not.toBe('none');

    const next: SimLevers = { ...FZP_COMPAT_LEVERS };
    await (await s.r).rerender({ levers: next });
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    const rev = leverRev(s.w());
    s.w().emit({ type: 'levers', rev, phase: 'resolving', done: 1, total: 4, failedCells: [] });
    await expect.element(page.getByText(/Updating the simulation/)).toBeVisible();
    // A recompute slice threw: the worker ends the session and posts `internal` at the rev.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.w().emit({ type: 'error', rev, code: 'internal', message: 'x' });

    const message = "Couldn't update the simulation for your policy.";
    const alert = page.getByRole('alert').filter({ hasText: message });
    await expect.element(alert).toBeVisible();
    expect(region.element().contains(alert.element())).toBe(true);
    expect(onlevers.mock.calls.at(-1)![0]).toMatchObject({ kind: 'failed', rev });
    expect(err).toHaveBeenCalledWith('[fzp] worker error', 'internal', 'x');
    await expect.element(page.getByText(/Updating the simulation/)).not.toBeInTheDocument();
    // The score says its numbers predate the change.
    const board = await details();
    const stale = board.getByText('These numbers are from before your latest policy change.');
    await expect.element(stale).toBeVisible();

    const inits = s.w().allOf('initScenario').length;
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.w().allOf('initScenario').length).toBe(inits + 1);
    const init = s.w().lastOf('initScenario')!;
    expect(init.levers).toBe(next);
    expect(init.seed).toBe(7);
    // Sent again: resolving, so the alert clears; current keeps it clear.
    await expect.element(alert).not.toBeInTheDocument();
    s.w().emit({ type: 'ready', rev: init.rev, datasetVersion: 'fixture-0', chunkCount: 4 });
    s.w().emit({
      type: 'levers',
      rev: init.rev,
      phase: 'current',
      lookups: postedLookups(),
      capacity: CAPACITY,
      unknownLots: 0
    });
    s.w().emit(timelineMsg(init.rev, 7));
    await expect.poll(() => onlevers.mock.calls.at(-1)![0].kind).toBe('current');
    await expect.element(page.getByText(message)).not.toBeInTheDocument();
    expect(region.element().textContent?.trim()).toBe('');
    await expect.element(stale).not.toBeInTheDocument();
  });

  it('failed cells offer Retry, which retries the chunks', async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await toReady(s);
    const rev = leverRev(s.w());
    s.w().emit({
      type: 'levers',
      rev,
      phase: 'resolving',
      done: 1,
      total: 3,
      failedCells: ['50_25']
    });
    await expect.element(page.getByText("Some map data didn't load.")).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    expect(s.w().allOf('retryChunks')).toHaveLength(1);
  });

  it('the debug hook reports the lever status', async () => {
    vi.stubEnv('VITE_E2E', '1');
    const s = setup({ levers: DEFAULT_LEVERS });
    await toReady(s);
    const rev = leverRev(s.w());
    s.w().emit({ type: 'levers', rev, phase: 'resolving', done: 1, total: 4, failedCells: [] });
    await expect
      .poll(() => window.__sfhFzp?.levers)
      .toEqual({ status: 'resolving', done: 1, total: 4, sentRev: rev });
    vi.unstubAllEnvs();
  });

  it('hands the page a client api and the map', async () => {
    const onclient = vi.fn();
    const onmapready = vi.fn();
    const s = setup({ levers: DEFAULT_LEVERS, onclient, onmapready } as Over);
    await expect.poll(() => onclient.mock.calls.length).toBe(1);
    await expect.poll(() => onmapready.mock.calls.length).toBe(1);
    expect(onmapready.mock.calls[0]).toEqual([stub.handle, stub.map]);
    const api = onclient.mock.calls[0][0];
    void api.resolveBrush({ kind: 'area', districts: ['RH-1'], neighborhoods: [] });
    expect(s.w().lastOf('resolveBrush')).toMatchObject({ query: { kind: 'area' } });
    api.retryChunks();
    expect(s.w().allOf('retryChunks')).toHaveLength(1);
    await unmount(s);
    expect(onclient.mock.calls.at(-1)).toEqual([null]);
  });

  it('onclient: null on a crash, the api again when Retry starts a new session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onclient = vi.fn();
    const s = setup({ levers: DEFAULT_LEVERS, onclient } as Over);
    await toReady(s);
    const api = onclient.mock.calls[0][0];
    expect(api).not.toBeNull();
    s.w().crash();
    await expect.poll(() => onclient.mock.calls.at(-1)).toEqual([null]);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => s.workers.length).toBe(2);
    await expect.poll(() => onclient.mock.calls.at(-1)?.[0]).toBe(api);
    expect(s.w().lastOf('initScenario')!.levers).toBe(DEFAULT_LEVERS);
  });

  it('a levers change during a reroll waits for its answer, then sends the latest once', async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await toReady(s, 7);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint32Array) => {
      a[0] = 4242;
      return a;
    }) as typeof crypto.getRandomValues);
    await another().click();
    const reroll = s.w().lastOf('reroll')!;
    const r = await s.r;
    await r.rerender({ levers: { ...FZP_COMPAT_LEVERS } });
    const latest: SimLevers = { ...FZP_COMPAT_LEVERS, compare: 'currentLaw' };
    await r.rerender({ levers: latest });
    await new Promise((res) => setTimeout(res, 50));
    expect(s.w().allOf('setLevers')).toEqual([]);

    s.w().emit(timelineMsg(reroll.rev, 4242));
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    const sent = s.w().lastOf('setLevers')!;
    expect(sent.levers).toBe(latest);
    expect(sent.rev).toBeGreaterThan(reroll.rev);
    // The reroll's answer was not superseded: its future is on show and in the URL.
    expect(s.onurlseed.mock.calls).toEqual([[4242]]);
    await expect.element(await futureLine()).toHaveTextContent(/^This future: #4242$/);
  });

  it('a levers change during a reroll is sent after the reroll fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup({ levers: DEFAULT_LEVERS });
    await toReady(s, 7);
    await another().click();
    const reroll = s.w().lastOf('reroll')!;
    const latest: SimLevers = { ...FZP_COMPAT_LEVERS };
    await (await s.r).rerender({ levers: latest });
    await new Promise((res) => setTimeout(res, 50));
    expect(s.w().allOf('setLevers')).toEqual([]);

    s.w().emit({ type: 'error', rev: reroll.rev, code: 'internal', message: 'x' });
    await expect
      .element(page.getByRole('alert').filter({ hasText: "Couldn't make another future" }))
      .toBeVisible();
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    expect(s.w().lastOf('setLevers')!.levers).toBe(latest);
    expect(s.onurlseed).not.toHaveBeenCalled();
  });

  it('a current at the setLevers rev that arrives after a reroll still pushes its lookups', async () => {
    const s = setup({ levers: DEFAULT_LEVERS });
    await toReady(s, 7);
    await (await s.r).rerender({ levers: { ...FZP_COMPAT_LEVERS } });
    await expect.poll(() => s.w().allOf('setLevers').length).toBe(1);
    const leversAt = s.w().lastOf('setLevers')!.rev;
    // The levers' run arrives, then a reroll goes out while their status is still pending.
    s.w().emit(timelineMsg(leversAt, 7));
    await expect.element(another()).toBeEnabled();
    await another().click();
    const reroll = s.w().lastOf('reroll')!;
    expect(reroll.rev).toBeGreaterThan(leversAt);

    const before = callsOf('setTimelineLookups').length;
    const lookups = postedLookups();
    s.w().emit({
      type: 'levers',
      rev: leversAt,
      phase: 'current',
      lookups,
      capacity: CAPACITY,
      unknownLots: 0
    });
    await expect.poll(() => callsOf('setTimelineLookups').length).toBe(before + 1);
    expect(callsOf('setTimelineLookups').at(-1)![0]).toEqual({
      ...lookups.fresh,
      inFlight: lookups.inFlight
    });
  });
});
