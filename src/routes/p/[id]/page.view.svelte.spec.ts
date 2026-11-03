// The shared-plan page: the View menu (transit spec §6.3: the viewer's own `sfhousing:view` prefs
// apply here as on `/`, and View shows only when the rendered manifest has a transit network), and
// the score and the dock as on `/` (sim-ux plan 5, Task 4): the header score, the Results face and
// a read-only Paint tab whose rows list and select, with no tools, no Remove and no undo. A stub
// SimMap hands over a fake MapLibre map, so a real BrushController attaches (vi.mock is file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { MSG } from '$lib/brush/messages';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { OUTLINE_LAYER_ID } from '$lib/paint/outline-layers';
import { emptyPlan, type Plan, type PlanOp } from '$lib/plan';
import { meterValueText, primaryTarget } from '$lib/scoreboard/view';
import type { LotOutlines } from '$lib/sim/outlines';
import { VIEW_KEY } from '$lib/view/prefs';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import { PageWorker, pageWorkers, scoreDiff, scoreOf } from '../../test/page-worker';
import PageHost from './test/PageHost.svelte';

vi.mock('$lib/map/SimMap.svelte', async () => import('$lib/fzp/test/FzpSimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;

function data(m: Manifest = manifest, plan: Plan = emptyPlan('fixture-0')) {
  return {
    id: 'abc123',
    plan,
    createdAt: '2026-10-01T00:00:00.000Z',
    currentDatasetVersion: 'fixture-0',
    datasetNotice: 'none' as const,
    manifest: m,
    fellBack: false,
    manifestError: false,
    datasetVersion: 'fixture-0',
    appRelease: 'dev'
  };
}

const viewButton = () => page.getByRole('button', { name: 'View' });
const stored = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');

beforeEach(async () => {
  await page.viewport(1024, 768);
  stub.reset();
  stub.map.zoom = 18;
  pageWorkers.length = 0;
  vi.stubGlobal('Worker', PageWorker);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/p/[id] View menu', () => {
  it('honours the stored prefs, and a toggle updates the map and persists', async () => {
    // /sim's heightLimits: the plan page never shows it, and writes back the value it read.
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: false, transitAccess: true, heightLimits: false })
    );
    await render(PageHost, { props: { data: data() } });
    expect(stub.props.view).toEqual({
      transitStops: false,
      transitAccess: true,
      heightLimits: false
    });
    await viewButton().click();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();
    expect(page.getByRole('checkbox', { name: 'Zoning height limits' }).query()).toBeNull();
    await page.getByRole('checkbox', { name: 'Transit stops' }).click();
    await expect
      .poll(() => stub.props.view)
      .toEqual({ transitStops: true, transitAccess: true, heightLimits: false });
    expect(stored()).toEqual({ transitStops: true, transitAccess: true, heightLimits: false });
  });

  it('has no View button without manifest.transit', async () => {
    const { transit: _omit, ...plain } = manifest;
    await render(PageHost, { props: { data: data(plain as Manifest) } });
    await expect.element(page.getByRole('heading', { name: 'Shared plan' })).toBeInTheDocument();
    expect(viewButton().elements()).toHaveLength(0);
  });
});

// ---- the score and the read-only dock (Review Focus #4) -----------------------------------------

const op = (id: string, stories: number | null): PlanOp =>
  stories === null
    ? { id, kind: 'erase', radiusM: 20, path: [[-122.42, 37.76]] }
    : { id, kind: 'paint', stories, radiusM: 20, path: [[-122.42, 37.76]] };
const shared: Plan = {
  ...emptyPlan('fixture-0'),
  title: 'Corridor',
  ops: [op('a', 6), op('b', null)]
};

const scoreButton = () => page.getByTestId('score-bar');
const results = () => page.getByRole('region', { name: 'Results' });
const rowButtons = () => [...document.querySelectorAll<HTMLElement>('[data-paint-row]')];
const rowNames = () => rowButtons().map((b) => b.getAttribute('aria-label'));
const overlayIds = () =>
  ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
const key = (k: string, shift = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true })
  );

/** Answers the latest `opLots` request for `opIds` (once it has gone out). */
async function answerLots(opIds: string[], lots: number, outline: LotOutlines | null = null) {
  const w = pageWorkers[0];
  await expect.poll(() => w.lastOf('opLots')?.opIds).toEqual(opIds);
  const q = w.lastOf('opLots')!;
  w.emit({ type: 'opLots', reqId: q.reqId, result: { lots, missing: 0, outline } });
}

/** A 30 m square at the stub map's centre, as one lot's outline. */
function square(): LotOutlines {
  const c = stub.map.getCenter();
  const ring = [
    [c.lng, c.lat],
    [c.lng + 0.0003, c.lat],
    [c.lng + 0.0003, c.lat + 0.0003],
    [c.lng, c.lat + 0.0003],
    [c.lng, c.lat]
  ];
  return {
    lots: ['P0'],
    ringLot: Uint32Array.from([0]),
    starts: Uint32Array.from([0, ring.length]),
    positions: Float64Array.from(ring.flat())
  };
}

describe('/p/[id] score and dock', () => {
  it('a shared plan shows the header score, a read-only Paint tab with its rows, and Results', async () => {
    await render(PageHost, { props: { data: data(manifest, shared) } });
    await expect.poll(() => pageWorkers.length).toBe(1);
    const w = pageWorkers[0];
    w.ready();
    // The controller listens on the map: keyboard shortcuts would reach it.
    await expect.poll(() => stub.map.listenerCount('moveend')).toBeGreaterThan(0);
    const s = scoreOf(4321);
    w.emit(scoreDiff(s));

    // The header score, as on `/`: the count, the RHNA meter, no "vs FZP" delta.
    await expect.element(scoreButton()).toHaveTextContent('4,321 homes added');
    await expect
      .element(page.getByTestId('header-pinned').getByRole('meter'))
      .toHaveAttribute('aria-valuetext', meterValueText(primaryTarget(s)!));
    expect(document.querySelector('[data-testid="score-delta"]')).toBeNull();
    const dock = page.getByRole('region', { name: 'Paint', exact: true });
    expect(scoreButton().element().getAttribute('aria-controls')).toBe(dock.element().id);

    // The dock opens on the read-only Paint tab: its rows, no tools, no Undo, no Remove.
    await expect
      .element(page.getByRole('tab', { name: 'Paint' }))
      .toHaveAttribute('aria-selected', 'true');
    await answerLots(['a'], 4);
    await answerLots(['b'], 2);
    await expect
      .poll(rowNames)
      .toEqual(['6 stories · 1 stroke · 4 lots', 'Erased · 1 stroke · 2 lots']);
    await expect.element(page.getByText(MSG.readOnly, { exact: true })).toBeVisible();
    expect(page.getByRole('radiogroup', { name: 'Brush tool' }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Remove: / }).elements()).toEqual([]);

    // A row selects and its outline is drawn; still no Remove.
    rowButtons()[0].click();
    await expect.poll(() => rowButtons()[0].getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => w.lastOf('opLots')?.outlines).toBe(true);
    await answerLots(['a'], 4, square());
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
    expect(page.getByRole('button', { name: /^Remove: / }).elements()).toEqual([]);

    // Ctrl+Z and Ctrl+Shift+Z do nothing: nothing but row lookups goes to the worker.
    const before = w.posts.length;
    key('z');
    key('z', true);
    await new Promise((r) => setTimeout(r, 50));
    expect(w.posts.slice(before).filter((p) => p.type !== 'opLots')).toEqual([]);
    expect(rowNames()).toEqual(['6 stories · 1 stroke · 4 lots', 'Erased · 1 stroke · 2 lots']);

    // Results: the same face as `/`'s, then back to the rows.
    await scoreButton().click();
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(results().getByTestId('score-net')).toHaveTextContent('4,321');
    await expect
      .element(results().getByText('Theoretical max buildout', { exact: true }))
      .toBeVisible();
    await expect.element(results().getByTestId('target-rhna')).toBeVisible();
    await expect.element(results().getByText('What does this number mean?')).toBeVisible();
    await page.getByRole('button', { name: 'Back to painting' }).click();
    await expect.poll(rowNames).toHaveLength(2);
    expect(page.getByRole('radiogroup', { name: 'Brush tool' }).elements()).toEqual([]);
  });

  it('has no floating scoreboard', async () => {
    await render(PageHost, { props: { data: data(manifest, shared) } });
    await expect.element(scoreButton()).toBeInTheDocument();
    expect(page.getByRole('region', { name: 'Housing scoreboard' }).elements()).toHaveLength(0);
    expect(page.getByTestId('score-live').elements()).toHaveLength(1);
  });
});
