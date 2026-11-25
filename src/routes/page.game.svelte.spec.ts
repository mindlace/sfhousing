// The opening at `/` (game-shell §sec-design-opening): the latest complete score at the goal
// opens the opening card and records the win; Start hands the simulation the map's camera. The
// real PaintOpening runs; a map double hands its BrushController the fake map it needs, and
// SimRoute is a recording double (vi.mock is file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { GameStore } from '$lib/game/store.svelte';
import { parsePlan, serializePlan, type Plan } from '$lib/plan';
import { PLAN_KEY } from '$lib/sharing/storage';
import type { SimResponse } from '$lib/sim/protocol';
import { quietSync, seededGame } from '$lib/shell/test/seeded-game';
import type { FakeEditorWorker } from '$lib/brush/test/fake-editor-worker';
import { homeData } from './test/home-data';
import PageHost from './test/PageHost.svelte';
import { PageWorker, pageWorkers, scoreDiff, scoreOf } from './test/page-worker';
import { simRoute } from './test/sim-route-stub';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/sim-page/SimRoute.svelte', () => import('./test/SimRouteStub.svelte'));
vi.mock('$lib/game/e2e', async (orig) => ({
  ...(await orig<typeof import('$lib/game/e2e')>()),
  e2eGoalAmount: () => 1000
}));

const WON = '2026-11-22T12:00:00.000Z';
const REFUSED = 'This browser refused to save.';
const painted: Plan = {
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: [{ id: 's1', kind: 'paint', stories: 6, radiusM: 20, path: [[-122.4193, 37.76013]] }]
};
const seedPlan = () =>
  localStorage.setItem(
    PLAN_KEY,
    JSON.stringify({ v: 1, savedAt: '2026-10-11T00:00:00.000Z', plan: serializePlan(painted) })
  );
const chip = () => page.getByTestId('brush-announcement');
const ctrlZ = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
/** Ctrl+Z (a no-op until the controller has attached to the map), then the chip's text. */
const undoes = () => (ctrlZ(), chip().element().textContent?.trim());

let w: FakeEditorWorker;
async function mount(game: GameStore) {
  const r = await render(PageHost, { props: { data: homeData(), game } });
  await expect.poll(() => pageWorkers.length).toBe(1);
  w = pageWorkers[0];
  w.ready();
  return r;
}
type Diff = Extract<SimResponse, { type: 'diff' }>;
const win = (net: number, complete = true) =>
  w.emit({ ...(scoreDiff(scoreOf(net)) as Diff), complete });
const card = () => page.getByTestId('opening-card-box');
const bar = () => page.getByTestId('score-bar');
const down = (type: 'pointerdown' | 'pointerup' | 'pointercancel') =>
  window.dispatchEvent(new PointerEvent(type));

/** Records each flush the page registers with `beforeLeave` and the remover it got back. */
function spyLeave(game: GameStore): ReturnType<typeof vi.fn>[] {
  const register = game.beforeLeave.bind(game);
  const removers: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(game, 'beforeLeave').mockImplementation((fn) => {
    const remove = vi.fn(register(fn));
    removers.push(remove);
    return remove;
  });
  return removers;
}
/** The fake map's camera at Start: the centre of its bounds (floating point), zoom 18, 40, -20. */
const CAMERA = {
  center: [expect.closeTo(-122.425, 9), expect.closeTo(37.765, 9)],
  zoom: 18,
  pitch: 40,
  bearing: -20
};

describe('/ the opening', () => {
  beforeEach(async () => {
    stub.reset();
    stub.map.zoom = 18;
    // The fake map has no pitch or bearing of its own; Start reads both.
    Object.assign(stub.map, { getPitch: () => 0, getBearing: () => 0 });
    simRoute.reset();
    await page.viewport(1024, 768);
    pageWorkers.length = 0;
    vi.stubGlobal('Worker', PageWorker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("the headline reads the seam's goal", async () => {
    const { game } = seededGame();
    await mount(game);
    win(1000);
    await expect.element(bar()).toHaveTextContent('Room for 1,000 homes');
    await expect.element(page.getByTestId('score-detail')).toHaveTextContent('Goal reached');
  });

  it('a new game: the brush editor, Room for 0 homes, Publish for the plan and the save state', async () => {
    const { game } = seededGame();
    await mount(game);
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeInTheDocument();
    await expect.element(bar()).toHaveTextContent('Room for 0 homes');
    await expect
      .element(page.getByTestId('header-actions').getByRole('button', { name: 'Publish' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByTestId('header-status').getByTestId('save-state'))
      .toBeInTheDocument();
    expect(page.getByTestId('sim-route-stub').elements()).toEqual([]);
  });

  it('a complete score at the goal opens the card with Start focused and calls won() once', async () => {
    const { game } = seededGame();
    const won = vi.spyOn(game, 'won');
    await mount(game);
    win(999);
    await expect.element(bar()).toHaveTextContent('Room for 999 homes');
    expect(card().elements()).toHaveLength(0);
    win(1000);
    await expect.element(card().getByTestId('opening-card')).toBeVisible();
    await expect
      .element(card().getByRole('heading', { name: 'Room for 1,000 homes' }))
      .toBeVisible();
    await expect.element(card().getByTestId('opening-start')).toHaveFocus();
    expect(won).toHaveBeenCalledTimes(1);
  });

  it('an incomplete score at the goal opens nothing', async () => {
    const { game } = seededGame();
    const won = vi.spyOn(game, 'won');
    await mount(game);
    win(1000, false);
    await expect.element(bar()).toHaveTextContent('Room for 1,000 homes');
    expect(card().elements()).toHaveLength(0);
    expect(won).not.toHaveBeenCalled();
    expect(game.state.firstWinAt).toBeNull();
  });

  for (const end of ['pointerup', 'pointercancel'] as const) {
    it(`a win while a pointer is held opens the card at ${end}`, async () => {
      const { game } = seededGame();
      const won = vi.spyOn(game, 'won');
      await mount(game);
      down('pointerdown');
      win(1000);
      await expect.element(bar()).toHaveTextContent('Room for 1,000 homes');
      expect(card().elements()).toHaveLength(0);
      expect(won).not.toHaveBeenCalled();
      down(end);
      await expect.element(card()).toBeVisible();
      await expect.element(card().getByTestId('opening-start')).toHaveFocus();
      expect(won).toHaveBeenCalledTimes(1);
    });
  }

  it('a complete score below the goal closes the card; crossing again reopens it on release', async () => {
    const { game } = seededGame();
    const won = vi.spyOn(game, 'won');
    await mount(game);
    win(1000);
    await expect.element(card()).toBeVisible();
    down('pointerdown');
    win(400, false);
    await expect.element(bar()).toHaveTextContent('Room for 400 homes');
    await expect.element(card()).toBeVisible(); // a preview does not close it
    down('pointerup');
    win(400);
    await expect.element(card()).not.toBeInTheDocument();
    down('pointerdown');
    win(1000);
    await expect.element(bar()).toHaveTextContent('Room for 1,000 homes');
    expect(card().elements()).toHaveLength(0);
    down('pointerup');
    await expect.element(card()).toBeVisible();
    expect(won).toHaveBeenCalledTimes(2);
  });

  it('a game won before reopens the card without a second win', async () => {
    const { game, storage } = seededGame({ state: { firstWinAt: WON } });
    await mount(game);
    const setItem = vi.spyOn(storage, 'setItem');
    win(1000);
    await expect.element(card()).toBeVisible();
    expect(game.state.firstWinAt).toBe(WON);
    expect(game.read(game.currentId)?.state.firstWinAt).toBe(WON);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('Start hands the simulation the map camera and unmounts the opening', async () => {
    const { game } = seededGame();
    const startRuns = vi.spyOn(game, 'startRuns');
    Object.assign(stub.map, { getPitch: () => 40, getBearing: () => -20 });
    const removers = spyLeave(game);
    await mount(game);
    win(1000);
    await card().getByTestId('opening-start').click();
    expect(startRuns).toHaveBeenCalledTimes(1);
    expect(game.state.phase).toBe('runs');
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(simRoute.props!.initialFrame).toEqual(CAMERA);
    expect(page.getByRole('radiogroup', { name: 'Tool' }).elements()).toEqual([]);
    expect(removers[0]).toHaveBeenCalledTimes(1);
  });

  it('a double Start mounts the simulation once, on the first camera, with no notice', async () => {
    const { game } = seededGame();
    Object.assign(stub.map, { getPitch: () => 40, getBearing: () => -20 });
    await mount(game);
    win(1000);
    await card().getByTestId('opening-start').dblClick();
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(game.state.phase).toBe('runs');
    expect(simRoute.mounts).toBe(1);
    expect(simRoute.props!.initialFrame).toEqual(CAMERA);
    expect(page.getByText(REFUSED).elements()).toEqual([]);
  });

  it('Start with no map hands the simulation no frame', async () => {
    const { game } = seededGame();
    await mount(game);
    win(1000);
    await expect.element(card()).toBeVisible();
    vi.spyOn(stub.handle, 'getMap').mockReturnValue(null);
    await card().getByTestId('opening-start').click();
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(simRoute.props!.initialFrame).toBeUndefined();
  });

  it('a refused Start keeps the opening and shows one notice', async () => {
    const { game, storage } = seededGame();
    await mount(game);
    win(1000);
    await expect.element(card()).toBeVisible();
    storage.failWrites = true;
    await card().getByTestId('opening-start').click();
    await card().getByTestId('opening-start').click();
    await expect.element(page.getByText(REFUSED)).toBeVisible();
    expect(page.getByText(REFUSED).elements()).toHaveLength(1);
    expect(game.state.phase).toBe('opening');
    expect(page.getByTestId('sim-route-stub').elements()).toEqual([]);
    await expect.element(card()).toBeVisible();
  });

  it('an autosave write calls touched()', async () => {
    seedPlan();
    const { game } = seededGame();
    const touched = vi.spyOn(game, 'touched');
    await render(PageHost, { props: { data: homeData(), game } });
    await expect.poll(undoes).toBe('Undid paint, 6 stories');
    expect(touched).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    await expect.poll(() => touched.mock.calls.length).toBe(1);
  });

  it("an edit followed at once by New game is in the old game's save; the new plan record stays empty", async () => {
    seedPlan();
    // The opening's Autosave writes through getStorage(), localStorage: the store shares it.
    const game = new GameStore({ storage: localStorage, sync: quietSync() });
    const oldId = game.currentId;
    const { unmount } = await render(PageHost, { props: { data: homeData(), game } });
    await expect.poll(undoes).toBe('Undid paint, 6 stories');
    // The undo sits in the 500 ms debounce: without the flush the old save would keep the paint.
    expect(
      document
        .querySelector('[data-testid="header-status"] [data-save-status]')
        ?.getAttribute('data-save-status')
    ).toBe('saving');
    expect(game.newGame()).toEqual({ ok: true });
    const old = game.read(oldId);
    const record = JSON.parse(old!.plan!) as { plan: string };
    const plan = parsePlan(record.plan);
    expect(plan.ok && plan.value.ops).toEqual([]);
    unmount();
    expect(localStorage.getItem(PLAN_KEY)).toBeNull(); // nothing flushed over the new game's record
  });

  it('Paint registers one flush on mount and removes it on unmount', async () => {
    const { game } = seededGame();
    const removers = spyLeave(game);
    const { unmount } = await render(PageHost, { props: { data: homeData(), game } });
    expect(game.beforeLeave).toHaveBeenCalledTimes(1);
    expect(removers[0]).not.toHaveBeenCalled();
    unmount();
    expect(removers[0]).toHaveBeenCalledTimes(1);
  });
});
