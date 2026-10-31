/// <reference types="@vitest/browser-playwright" />
// /s/[id] (plan 5, Task 6): a published policy, read-only. The banner names it and offers Remix;
// the header has only Policy and Another future; the panel is the summary; a document whose
// timelines no longer fit the calibration opens refit with the timing notice. A fake Worker
// stands in for the scenario worker; the SimMap stub records its props.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { FakeScenarioWorker, timelineMsg } from '$lib/fzp/test/fake-worker';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { copyFor } from '$lib/sharing/copy';
import { readRecord, writeRecord } from '$lib/sharing/storage';
import { defaultEffect, type SimPolicy } from '$lib/sim-page/policy';
import { DEFAULT_POLICY, SIM_CODEC, SIM_KEY, type SimDoc } from '$lib/sim-page/sim-doc';
import { TIMING_NOTICE_TEXT } from '$lib/sim-page/sim-session';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import PageHost from './test/PageHost.svelte';

const nav = vi.hoisted(() => ({
  goto: [] as { url: string; opts?: { state?: App.PageState } }[]
}));

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
// The shared client-test stub of $app/navigation has no afterNavigate; SimRoute needs one.
vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  replaceState: () => {},
  goto: async (url: string, opts?: { state?: App.PageState }) => {
    nav.goto.push({ url, opts });
  }
}));

class StubWorker extends FakeScenarioWorker {
  static all: StubWorker[] = [];
  constructor() {
    super();
    StubWorker.all.push(this);
  }
}

const manifest = parseManifest(manifestJson);
const SIM = copyFor('sim');

const painted = (): SimPolicy => ({
  ...DEFAULT_POLICY,
  brushes: [
    {
      id: 'a',
      kind: 'freehand',
      strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
      effect: defaultEffect('raise', 6)
    }
  ]
});

/** San Diego's pace with its preset scale tampered to 0.3 (today's preset resolves otherwise). */
const tampered = (): SimPolicy => ({
  ...DEFAULT_POLICY,
  timing: {
    current: {
      preset: 'benchmarkPermits',
      presetTimers: [
        { pathway: 'discretionary', stage: 'permitFiled', scale: 0.3, reach: 'all' },
        { pathway: 'streamlined', stage: 'permitFiled', scale: 0.3, reach: 'all' },
        { pathway: 'permitOnly', stage: 'permitFiled', scale: 0.3, reach: 'all' }
      ],
      presetRouteShares: null,
      edits: [],
      routeShares: null,
      localProgramStreamlined: true
    },
    saved: null
  }
});

function data(policy: SimPolicy = painted(), title: string | null = 'SD permits') {
  const doc: SimDoc = { schema: 1, kind: 'sim', datasetVersion: 'fixture-0', policy };
  if (title !== null) doc.title = title;
  return {
    id: 'Abcdefg2',
    doc,
    createdAt: '2026-10-30T12:00:00.000Z',
    currentDatasetVersion: 'fixture-0',
    datasetNotice: 'none' as const,
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    manifest,
    manifestError: false,
    calibration: fixtureCalibration(),
    calibrationError: false,
    noScenario: false,
    fellBack: false,
    seed: null,
    seedInvalid: false,
    start: null
  };
}

async function toReady() {
  await expect.poll(() => StubWorker.all.at(-1)?.lastOf('initScenario')).toBeTruthy();
  const w = StubWorker.all.at(-1)!;
  const rev = w.lastOf('initScenario')!.rev;
  w.emit({ type: 'ready', rev, datasetVersion: 'fixture-0', chunkCount: 4 });
  w.emit(timelineMsg(rev, 7));
}

const banner = () => page.getByRole('region', { name: 'Shared policy' });

describe('/s/[id] read-only view', () => {
  beforeEach(async () => {
    stub.reset();
    StubWorker.all = [];
    nav.goto.length = 0;
    vi.stubGlobal('Worker', StubWorker);
    localStorage.removeItem(SIM_KEY);
    await page.viewport(1024, 768);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(SIM_KEY);
  });

  it('the banner reads Shared policy and Start your own goes to /sim', async () => {
    await render(PageHost, { props: { data: data() } });
    await expect.element(banner()).toBeVisible();
    await expect.element(banner()).toHaveTextContent(/SD permits · Shared policy · published/);
    await expect
      .element(banner().getByRole('link', { name: 'Start your own' }))
      .toHaveAttribute('href', '/sim');
    await expect.poll(() => document.title).toBe('SD permits · SF Housing Simulator');
  });

  it('has no Publish, no save state and no brush tools', async () => {
    await render(PageHost, { props: { data: data() } });
    await toReady();
    await expect.element(page.getByRole('button', { name: 'Another future' })).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Policy (read-only)' })).toBeVisible();
    expect(page.getByRole('button', { name: /Publish|Share link/ }).elements()).toHaveLength(0);
    expect(page.getByText('Saved').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Add a brush' }).elements()).toHaveLength(0);
    expect(document.querySelector('[data-header-status]')?.children).toHaveLength(0);
    // Nothing is autosaved from the view.
    expect(localStorage.getItem(SIM_KEY)).toBeNull();
    // The shared brushes are still resolved (the lot dots and the summary's counts).
    await expect.poll(() => StubWorker.all.at(-1)!.allOf('resolveBrush').length).toBeGreaterThan(0);
  });

  it('Policy toggles "Policy (read-only)", docked on md+ and a sheet on a phone', async () => {
    await render(PageHost, { props: { data: data() } });
    const policy = page.getByRole('button', { name: 'Policy', exact: true });
    const region = page.getByRole('region', { name: 'Policy (read-only)' });
    await expect.element(region).toBeVisible();
    await policy.click();
    await expect.element(region).not.toBeInTheDocument();
    await policy.click();
    await expect.element(region).toBeVisible();

    await page.viewport(375, 700);
    await page.getByRole('button', { name: 'Close policy' }).click();
    await page.getByRole('button', { name: 'Menu' }).click();
    await policy.click();
    await expect.element(page.getByRole('dialog', { name: 'Policy (read-only)' })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it('a tampered link opens refit', async () => {
    await render(PageHost, { props: { data: data(tampered()) } });
    await toReady();
    await expect.element(page.getByText(TIMING_NOTICE_TEXT)).toBeVisible();
    // The worker runs the reconciled set, not the tampered scale.
    const timers = StubWorker.all.at(-1)!.lastOf('initScenario')!.levers?.timers ?? [];
    expect(timers.length).toBeGreaterThan(0);
    expect(timers.every((t) => t.scale !== 0.3)).toBe(true);
  });

  it('Remix confirms over a non-default local policy', async () => {
    const local: SimDoc = {
      schema: 1,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: painted()
    };
    writeRecord(
      localStorage,
      { v: 1, savedAt: new Date().toISOString(), plan: SIM_CODEC.serialize(local) },
      SIM_CODEC
    );
    const shared = data(tampered());
    await render(PageHost, { props: { data: shared } });
    await banner().getByRole('button', { name: 'Remix', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: SIM.remixConfirm(0) });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace' }).click();

    await expect.poll(() => nav.goto.length).toBe(1);
    expect(nav.goto[0].url).toBe('/sim');
    expect(nav.goto[0].opts?.state?.sfhSimRemix).toEqual({ from: 'SD permits' });
    const r = readRecord(localStorage, SIM_CODEC);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.plan.title).toBe('SD permits');
  });

  it('Remix over the default local policy goes straight to /sim, from the id when untitled', async () => {
    await render(PageHost, { props: { data: data(painted(), null) } });
    await banner().getByRole('button', { name: 'Remix', exact: true }).click();
    await expect.poll(() => nav.goto.length).toBe(1);
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    expect(nav.goto[0].opts?.state?.sfhSimRemix).toEqual({ from: 'Abcdefg2' });
  });
});
