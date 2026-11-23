// Paint's win at level 1 (game-shell spec, Paint's win): the latest complete score at the goal
// opens the win card and sets the game's offer; Level up goes to /sim. A map double hands the
// page's BrushController the fake map it needs (vi.mock is file-wide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { Manifest } from '$lib/data/manifest';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { GameStore } from '$lib/game/store.svelte';
import { emptyPlan, parsePlan, serializePlan, type Plan } from '$lib/plan';
import { PLAN_KEY } from '$lib/sharing/storage';
import type { SimResponse } from '$lib/sim/protocol';
import { quietSync, seededGame } from '$lib/shell/test/seeded-game';
import type { FakeEditorWorker } from '$lib/brush/test/fake-editor-worker';
import { gotoCalls } from '../test-stubs/app/navigation';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import PageHost from './test/PageHost.svelte';
import { PageWorker, pageWorkers, scoreDiff, scoreOf } from './test/page-worker';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/game/e2e', async (orig) => ({
  ...(await orig<typeof import('$lib/game/e2e')>()),
  e2eGoalAmount: () => 1000
}));

const manifest = manifestJson as unknown as Manifest;
const data = () => ({
  plan: emptyPlan('fixture-0'),
  manifest,
  fellBack: false,
  manifestError: false,
  datasetVersion: 'fixture-0',
  appRelease: 'dev',
  user: null,
  signInAvailable: true
});
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
async function mount(game?: GameStore) {
  const r = await render(PageHost, { props: { data: data(), game } });
  await expect.poll(() => pageWorkers.length).toBe(1);
  w = pageWorkers[0];
  w.ready();
  return r;
}
type Diff = Extract<SimResponse, { type: 'diff' }>;
const win = (net: number, complete = true) =>
  w.emit({ ...(scoreDiff(scoreOf(net)) as Diff), complete });
const card = () => page.getByTestId('paint-win');
const bar = () => page.getByTestId('score-bar');
const down = (type: 'pointerdown' | 'pointerup' | 'pointercancel') =>
  window.dispatchEvent(new PointerEvent(type));
const OFFER = { on: null, datasetVersion: 'fixture-0' };

describe("/ Paint's win", () => {
  beforeEach(async () => {
    stub.reset();
    stub.map.zoom = 18;
    await page.viewport(1024, 768);
    pageWorkers.length = 0;
    vi.stubGlobal('Worker', PageWorker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    gotoCalls.length = 0;
  });

  it("the headline reads the seam's goal", async () => {
    const { game } = seededGame({ level: 1 });
    await mount(game);
    win(1000);
    await expect.element(bar()).toHaveTextContent('Room for 1,000 homes');
    await expect.element(page.getByTestId('score-detail')).toHaveTextContent('Goal reached');
  });

  it('a complete score crossing the goal opens the card on Level up, calls won() once and sets the offer', async () => {
    const { game } = seededGame({ level: 1 });
    const won = vi.spyOn(game, 'won');
    await mount(game);
    win(999);
    await expect.element(bar()).toHaveTextContent('Room for 999 homes');
    expect(card().elements()).toHaveLength(0);
    expect(game.offer).toBeNull();
    win(1000);
    await expect
      .element(card().getByRole('heading', { name: 'Room for 1,000 homes' }))
      .toBeVisible();
    await expect.element(card().getByRole('button', { name: 'Level up' })).toHaveFocus();
    await expect.element(card()).toHaveTextContent('Unlocks: The simulation');
    expect(won).toHaveBeenCalledTimes(1);
    expect(game.offer).toEqual(OFFER);
  });

  it('an incomplete score at the goal opens nothing', async () => {
    const { game } = seededGame({ level: 1 });
    await mount(game);
    win(1000, false);
    await expect.element(bar()).toHaveTextContent('Room for 1,000 homes');
    expect(card().elements()).toHaveLength(0);
    expect(game.offer).toBeNull();
  });

  for (const end of ['pointerup', 'pointercancel'] as const) {
    it(`a win while a pointer is held mounts the card at ${end}`, async () => {
      const { game } = seededGame({ level: 1 });
      await mount(game);
      down('pointerdown');
      win(1000);
      await expect.poll(() => game.offer).toEqual(OFFER);
      expect(card().elements()).toHaveLength(0);
      down(end);
      await expect.element(card()).toBeVisible();
      await expect.element(card().getByRole('button', { name: 'Level up' })).toHaveFocus();
    });
  }

  it('Keep playing closes the card, focuses the header score, and the offer stays', async () => {
    const { game } = seededGame({ level: 1 });
    await mount(game);
    win(1000);
    await card().getByRole('button', { name: 'Keep playing' }).click();
    await expect.element(card()).not.toBeInTheDocument();
    await expect.element(bar()).toHaveFocus();
    expect(game.offer).not.toBeNull();
    win(1001);
    await expect.element(bar()).toHaveTextContent('Room for 1,001 homes');
    expect(card().elements()).toHaveLength(0);
  });

  it('Escape closes the card as Keep playing does', async () => {
    const { game } = seededGame({ level: 1 });
    await mount(game);
    win(1000);
    await expect.element(card().getByRole('button', { name: 'Level up' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(card()).not.toBeInTheDocument();
    await expect.element(bar()).toHaveFocus();
    expect(game.offer).toEqual(OFFER);
  });

  it('after Keep playing, a stroke of incomplete scores then a complete win leaves the card closed and the offer set', async () => {
    const { game } = seededGame({ level: 1 });
    await mount(game);
    win(1000);
    await expect.element(card()).toBeVisible();
    await card().getByRole('button', { name: 'Keep playing' }).click();
    await expect.element(card()).not.toBeInTheDocument();
    const setOffer = vi.spyOn(game, 'setOffer');
    const won = vi.spyOn(game, 'won');
    down('pointerdown');
    win(400, false); // the room dips below the goal mid-stroke
    await expect.element(bar()).toHaveTextContent('Room for 400 homes');
    expect(game.offer).not.toBeNull();
    win(1200, false);
    await expect.element(bar()).toHaveTextContent('Room for 1,200 homes');
    down('pointerup');
    win(1100);
    await expect.element(bar()).toHaveTextContent('Room for 1,100 homes');
    expect(card().elements()).toHaveLength(0);
    expect(game.offer).toEqual(OFFER);
    expect(setOffer).not.toHaveBeenCalledWith(null);
    expect(won).not.toHaveBeenCalled();
  });

  it('a complete score below the goal clears the offer and the kept state; crossing again reopens the card', async () => {
    const { game } = seededGame({ level: 1 });
    const won = vi.spyOn(game, 'won');
    await mount(game);
    win(1000);
    await card().getByRole('button', { name: 'Keep playing' }).click();
    await expect.element(card()).not.toBeInTheDocument();
    win(10);
    await expect.poll(() => game.offer).toBeNull();
    expect(card().elements()).toHaveLength(0);
    win(1000);
    await expect.element(card().getByRole('button', { name: 'Level up' })).toHaveFocus();
    expect(game.offer).not.toBeNull();
    expect(won).toHaveBeenCalledTimes(2);
  });

  it('Level up raises the level to 2 and goes to /sim', async () => {
    const { game } = seededGame({ level: 1 });
    await mount(game);
    win(1000);
    await card().getByRole('button', { name: 'Level up' }).click();
    expect(game.progress.level).toBe(2);
    await expect.poll(() => gotoCalls.at(-1)?.url).toBe('/sim');
    await expect.element(card()).not.toBeInTheDocument();
    expect(game.offer).toBeNull();
  });

  it('a refused Level up stays on Paint and offers again', async () => {
    const { game, storage } = seededGame({ level: 1 });
    await mount(game);
    win(1000);
    const levelUp = card().getByRole('button', { name: 'Level up' });
    await expect.element(levelUp).toHaveFocus();
    storage.failWrites = true;
    await levelUp.click();
    expect(game.progress.level).toBe(1);
    expect(gotoCalls).toHaveLength(0);
    expect(game.offer).toEqual(OFFER);
    await expect.element(levelUp).toBeVisible();
    storage.failWrites = false;
    await levelUp.click();
    expect(game.progress.level).toBe(2);
    await expect.poll(() => gotoCalls.at(-1)?.url).toBe('/sim');
  });

  it('an autosave write calls touched()', async () => {
    seedPlan();
    const { game } = seededGame({ level: 1 });
    const touched = vi.spyOn(game, 'touched');
    await render(PageHost, { props: { data: data(), game } });
    await expect.poll(undoes).toBe('Undid paint, 6 stories');
    expect(touched).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    await expect.poll(() => touched.mock.calls.length).toBe(1);
  });

  it("an edit followed at once by New game is in the old game's save; the new plan record stays empty", async () => {
    seedPlan();
    // Paint's Autosave writes through getStorage(), localStorage: the store shares it.
    const game = new GameStore({ storage: localStorage, sync: quietSync() });
    const oldId = game.currentId;
    const { unmount } = await render(PageHost, { props: { data: data(), game } });
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
    const { game } = seededGame({ level: 1 });
    const register = game.beforeLeave.bind(game);
    const removers: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(game, 'beforeLeave').mockImplementation((fn) => {
      const remove = vi.fn(register(fn));
      removers.push(remove);
      return remove;
    });
    const { unmount } = await render(PageHost, { props: { data: data(), game } });
    expect(game.beforeLeave).toHaveBeenCalledTimes(1);
    expect(removers[0]).not.toHaveBeenCalled();
    unmount();
    expect(removers[0]).toHaveBeenCalledTimes(1);
  });

  it('at level 2 no card shows and no offer is set', async () => {
    const { game } = seededGame({ level: 2 });
    await mount(game);
    win(1000);
    await expect.element(page.getByTestId('score-detail')).toHaveTextContent('Goal reached');
    expect(card().elements()).toHaveLength(0);
    expect(game.offer).toBeNull();
  });

  it('the open game (no game given): no card and no offer', async () => {
    await mount();
    win(1000);
    await expect.element(page.getByTestId('score-detail')).toHaveTextContent('Goal reached');
    expect(card().elements()).toHaveLength(0);
  });
});
