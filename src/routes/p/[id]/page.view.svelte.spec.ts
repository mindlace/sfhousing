// The shared-plan page: the map's Layers (transit spec §6.3: the viewer's own `sfhousing:view` prefs
// apply here as on `/`, and Layers shows only when the rendered manifest has a transit network), and
// the score and the dock as on `/` (sim-ux plan 5, Task 4): the header score, the Details face and
// a read-only Paint tab with the read-only line and one summary line, no rows, tools or undo. A stub
// SimMap hands over a fake MapLibre map, so a real BrushController attaches (vi.mock is file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import type { Manifest } from '$lib/data/manifest';
import { MSG } from '$lib/brush/messages';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { OUTLINE_LAYER_ID } from '$lib/paint/outline-layers';
import { emptyPlan, type Plan, type PlanOp } from '$lib/plan';
import { FULL_TEXT } from '$lib/game/copy';
import { SAVES_KEY } from '$lib/game/saves';
import { YOUR_GAME } from '$lib/sharing/copy';
import { PLAN_CODEC } from '$lib/sharing/doc-codec';
import { PLAN_KEY, readRecord } from '$lib/sharing/storage';
import { seededGame } from '$lib/shell/test/seeded-game';
import { VIEW_KEY } from '$lib/view/prefs';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import { PageWorker, pageWorkers, scoreDiff, scoreOf } from '../../test/page-worker';
import PageHost from './test/PageHost.svelte';

const nav2 = vi.hoisted(() => ({ loadPage: vi.fn() }));

vi.mock('$lib/map/SimMap.svelte', async () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/game/navigate', async (orig) => ({
  ...(await orig<typeof import('$lib/game/navigate')>()),
  loadPage: nav2.loadPage
}));

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
    appRelease: 'dev',
    user: null,
    signInAvailable: true
  };
}

const layersToggle = () => page.getByRole('button', { name: 'Map layers' });
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

describe('/p/[id] map layers', () => {
  it('the header has no View; with manifest.transit the map toolbar has Layers, without it none', async () => {
    const first = await render(PageHost, { props: { data: data() } });
    await expect.element(layersToggle()).toBeVisible();
    const toolbar = page.getByTestId('map-key-control').element();
    expect(toolbar.contains(layersToggle().element())).toBe(true);
    // The header's actions slot is empty: View was its only action.
    expect(document.querySelector('[data-testid="header-actions"]')!.children).toHaveLength(0);
    expect(page.getByRole('button', { name: 'View', exact: true }).elements()).toEqual([]);
    await first.unmount();

    const { transit: _omit, ...plain } = manifest;
    await render(PageHost, { props: { data: data(plain as Manifest) } });
    await expect.element(page.getByRole('heading', { name: 'Shared plan' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Map key' })).toBeInTheDocument();
    expect(layersToggle().elements()).toHaveLength(0);
  });

  it('a stored transit choice is on when Layers opens, and a toggle writes it back', async () => {
    // /sim's heightLimits: the plan page never shows it, and writes back the value it read.
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: false, transitAccess: true, heightLimits: false })
    );
    await render(PageHost, { props: { data: data() } });
    expect(stub.props.view).toEqual({
      transitStops: false,
      transitAccess: true,
      heightLimits: false,
      carsPerHousehold: false
    });
    await layersToggle().click();
    await expect.element(page.getByRole('group', { name: 'Map layers' })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();
    await expect.element(page.getByRole('checkbox', { name: /Transit capacity/ })).toBeChecked();
    expect(page.getByRole('checkbox', { name: 'Zoning height limits' }).query()).toBeNull();
    await page.getByRole('checkbox', { name: 'Transit stops' }).click();
    await expect
      .poll(() => stub.props.view)
      .toEqual({
        transitStops: true,
        transitAccess: true,
        heightLimits: false,
        carsPerHousehold: false
      });
    expect(stored()).toEqual({
      transitStops: true,
      transitAccess: true,
      heightLimits: false,
      carsPerHousehold: false
    });
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

/** The shared plan paints 6 stories (and erases); `scoreOf` rebuilds one lot. */
const SUMMARY = '6 stories · 1 lot rebuilt';

const scoreButton = () => page.getByTestId('score-bar');
const results = () => page.getByRole('region', { name: 'Details' });
const overlayIds = () =>
  ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
const key = (k: string, shift = false) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true })
  );

describe('/p/[id] score and dock', () => {
  it('a shared plan shows the header score, a read-only Paint tab with its summary, and Details', async () => {
    await render(PageHost, { props: { data: data(manifest, shared) } });
    await expect.poll(() => pageWorkers.length).toBe(1);
    const w = pageWorkers[0];
    w.ready();
    // The controller listens on the map: keyboard shortcuts would reach it.
    await expect.poll(() => stub.map.listenerCount('moveend')).toBeGreaterThan(0);
    const s = scoreOf(4321);
    w.emit(scoreDiff(s));

    // The header score, as on `/`: room for homes and its share of the goal; no meter, no Paint
    // button in the banner.
    await expect.element(scoreButton()).toHaveTextContent('Room for 4,321 homes');
    await expect.element(page.getByTestId('score-detail')).toHaveTextContent('5.2% of the goal');
    expect(page.getByTestId('header-pinned').getByRole('meter').elements()).toHaveLength(0);
    expect(document.querySelector('[data-testid="score-delta"]')).toBeNull();
    expect(
      page.getByRole('banner').getByRole('button', { name: 'Paint', exact: true }).elements()
    ).toHaveLength(0);
    const dock = page.getByRole('region', { name: 'Paint', exact: true });
    expect(scoreButton().element().getAttribute('aria-controls')).toBe(dock.element().id);

    // The dock opens on the read-only Paint tab: the read-only line and one summary line (the
    // heights painted, the lots the score rebuilds); no rows, tools, Undo or Remove.
    await expect
      .element(page.getByRole('tab', { name: 'Paint' }))
      .toHaveAttribute('aria-selected', 'true');
    const tab = page.getByRole('tabpanel');
    await expect.element(tab.getByText(MSG.readOnly, { exact: true })).toBeVisible();
    await expect.element(tab.getByText(SUMMARY, { exact: true })).toBeVisible();
    expect(document.querySelector('[data-paint-row]')).toBeNull();
    expect(page.getByRole('radiogroup', { name: 'Tool' }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Undo/ }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: /^Remove/ }).elements()).toEqual([]);
    expect(w.allOf('heightLots').every((r) => r.outlineOf === null)).toBe(true);
    expect(overlayIds()).not.toContain(OUTLINE_LAYER_ID);

    // Ctrl+Z and Ctrl+Shift+Z do nothing: nothing goes to the worker.
    const before = w.posts.length;
    key('z');
    key('z', true);
    // The handler is synchronous: one flush of the DOM is all the keys need.
    await tick();
    expect(w.posts.slice(before)).toEqual([]);
    await expect.element(tab.getByText(SUMMARY, { exact: true })).toBeVisible();

    // Details: the same face as `/`'s, then back to the rows.
    await scoreButton().click();
    // The goal name opens under the pointer (in flow, as this host has no styles): dismiss it.
    await userEvent.keyboard('{Escape}');
    await expect.element(scoreButton()).toHaveAttribute('aria-expanded', 'true');
    const goalRow = results().getByTestId('goal-row-goal');
    await expect.element(goalRow.getByText('5.2%', { exact: true })).toBeVisible();
    await expect.element(results().getByTestId('goal-row-buffer')).toBeVisible();
    await expect.element(results().getByText('What room for homes means')).toBeVisible();
    expect(results().element().textContent).not.toMatch(/RHNA|Theoretical max|net new homes/);
    // Read-only: nothing can be painted, so the flip names the Paint tab, not painting.
    expect(page.getByRole('button', { name: 'Back to painting' }).elements()).toEqual([]);
    await page.getByRole('button', { name: 'Back to the Paint tab' }).click();
    await expect.element(page.getByText(SUMMARY, { exact: true })).toBeVisible();
    expect(page.getByRole('radiogroup', { name: 'Tool' }).elements()).toEqual([]);
  });

  it('has no floating scoreboard', async () => {
    await render(PageHost, { props: { data: data(manifest, shared) } });
    await expect.element(scoreButton()).toBeInTheDocument();
    expect(page.getByRole('region', { name: 'Housing scoreboard' }).elements()).toHaveLength(0);
    expect(page.getByTestId('score-live').elements()).toHaveLength(1);
  });
});

// ---- Remix under a game (game-shell Task 6) --------------------------------------------------------

/** The old game's policy record, which a plan remix keeps. */
const OLD_POLICY_RECORD = JSON.stringify({
  v: 1,
  savedAt: '2026-11-01T00:00:00.000Z',
  plan: '{"schema":4,"kind":"sim","datasetVersion":"fixture-0"}'
});
const mission: Plan = { ...shared, title: 'Mission' };
const banner = () => page.getByRole('region', { name: 'Shared plan' });
const remixBtn = () => banner().getByRole('button', { name: 'Remix', exact: true });

describe('/p/[id] Remix', () => {
  beforeEach(() => {
    nav2.loadPage.mockClear();
  });

  it('level 1: a press makes a saved game with the published plan and the old policy, and loads /', async () => {
    const { game, storage } = seededGame({ level: 1, policy: OLD_POLICY_RECORD });
    await render(PageHost, { props: { data: data(manifest, mission), game } });
    await remixBtn().click();
    await expect.poll(() => nav2.loadPage.mock.calls.length).toBe(1);
    expect(nav2.loadPage).toHaveBeenCalledWith('/');
    expect(game.saves).toHaveLength(2);
    expect(game.saves[0].name).toBe('Remix of Mission');
    expect(game.currentId).toBe(game.saves[0].id);
    const r = readRecord(storage);
    expect(r.kind === 'ok' && r.plan).toEqual(PLAN_CODEC.rebase(mission, 'fixture-0'));
    expect(game.read(game.currentId)!.policy).toBe(OLD_POLICY_RECORD);
    expect(game.progress.level).toBe(1);
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    // The page's own localStorage plan stays untouched.
    expect(localStorage.getItem(PLAN_KEY)).toBeNull();
  });

  it('at 12 games Remix is disabled', async () => {
    const { game, storage } = seededGame({ level: 1, saves: 12 });
    const index = storage.getItem(SAVES_KEY);
    await render(PageHost, { props: { data: data(manifest, mission), game } });
    await expect.element(remixBtn()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(banner().getByText(FULL_TEXT, { exact: true })).toBeVisible();
    (remixBtn().element() as HTMLElement).click();
    expect(storage.getItem(SAVES_KEY)).toBe(index);
    expect(nav2.loadPage).not.toHaveBeenCalled();
  });

  it('the open game: no Remix button', async () => {
    await render(PageHost, { props: { data: data(manifest, mission) } });
    await expect.element(banner().getByRole('link', { name: YOUR_GAME })).toBeVisible();
    expect(remixBtn().elements()).toHaveLength(0);
  });
});
