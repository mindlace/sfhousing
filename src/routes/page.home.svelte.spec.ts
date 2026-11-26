// `/` choosing its body (game-shell §sec-design-address): the open game and a game in 'runs' get
// the simulation, a new game the opening; Start hands the opening's camera to the simulation.
// SimRoute and PaintOpening are doubles here (vi.mock is file-wide).
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { openGame } from '$lib/game/store.svelte';
import { newId } from '$lib/ids/base58';
import { seededGame } from '$lib/shell/test/seeded-game';
import { homeData } from './test/home-data';
import { FRAME } from './test/opening-stub';
import PageHost from './test/PageHost.svelte';
import { simRoute } from './test/sim-route-stub';

vi.mock('$lib/sim-page/SimRoute.svelte', () => import('./test/SimRouteStub.svelte'));
vi.mock('$lib/shell/PaintOpening.svelte', () => import('./test/PaintOpeningStub.svelte'));

const WON = '2026-11-22T12:00:00.000Z';
const stubStart = () => page.getByRole('button', { name: 'Stub start', exact: true });

describe('/ chooses its body', () => {
  beforeEach(() => simRoute.reset());

  it('the open game: the simulation in edit mode, no opening, the title SF Housing', async () => {
    render(PageHost, { data: homeData(), game: openGame() });
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(simRoute.props).toMatchObject({ mode: 'edit', persist: 'restore' });
    expect(simRoute.props!.initialFrame).toBeUndefined();
    expect(stubStart().elements()).toEqual([]);
    expect(document.title).toBe('SF Housing');
    await expect
      .element(page.getByRole('heading', { level: 1, name: 'SF Housing' }))
      .toBeInTheDocument();
  });

  it("a game in 'runs': the simulation with initialFrame undefined", async () => {
    const { game } = seededGame({ state: { phase: 'runs', firstWinAt: WON } });
    render(PageHost, { data: homeData(), game });
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(simRoute.mounts).toBe(1);
    expect(simRoute.props).toMatchObject({ mode: 'edit', persist: 'restore' });
    expect(simRoute.props!.initialFrame).toBeUndefined();
    expect(stubStart().elements()).toEqual([]);
  });

  it('a new game: the opening, no simulation', async () => {
    const { game } = seededGame();
    render(PageHost, { data: homeData(), game });
    await expect.element(stubStart()).toBeVisible();
    expect(page.getByTestId('sim-route-stub').elements()).toEqual([]);
    expect(simRoute.mounts).toBe(0);
    expect(game.state.phase).toBe('opening');
  });

  it('Start: startRuns, the simulation mounts with the opening camera, the opening goes', async () => {
    const { game } = seededGame({ state: { firstWinAt: WON } });
    const startRuns = vi.spyOn(game, 'startRuns');
    render(PageHost, { data: homeData(), game });
    await stubStart().click();
    expect(startRuns).toHaveBeenCalledTimes(1);
    expect(game.state.phase).toBe('runs');
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(simRoute.props!.initialFrame).toEqual(FRAME);
    expect(stubStart().elements()).toEqual([]);
  });

  it('a double Start mounts the simulation once', async () => {
    const { game } = seededGame({ state: { firstWinAt: WON } });
    const startRuns = vi.spyOn(game, 'startRuns');
    render(PageHost, { data: homeData(), game });
    await page.getByRole('button', { name: 'Stub start twice' }).click();
    expect(startRuns).toHaveBeenCalledTimes(2);
    expect(game.state.phase).toBe('runs');
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    await tick();
    expect(simRoute.mounts).toBe(1);
    expect(simRoute.props!.initialFrame).toEqual(FRAME);
  });

  it('a rekey of the current game does not remount', async () => {
    const { game } = seededGame({ state: { phase: 'runs', firstWinAt: WON } });
    render(PageHost, { data: homeData(), game });
    await expect.element(page.getByTestId('sim-route-stub')).toBeInTheDocument();
    expect(game.rekey(game.currentId, newId())).toEqual({ ok: true });
    await tick();
    expect(simRoute.mounts).toBe(1);
  });
});
