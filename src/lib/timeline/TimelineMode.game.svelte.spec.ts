// TimelineMode in a game (spec #sec-design-seen, -messages, -card, -levelup): the seen result, the
// standing, the offer, the outcome messages, the win card and the level up, over the real session
// and client with a fake worker, a recording SimMap stub, and a real GameStore.
/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { formatShortMonthYear } from '$lib/fzp/format';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { unlockText } from '$lib/game/copy';
import { roundComplete } from '$lib/game/progress';
import { openGame, type GameStore } from '$lib/game/store.svelte';
import { GOAL_BASE, defaultGoal, type Goal } from '$lib/goal/goal';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type { AddChoice } from './add';
import { winTitle } from './game-copy';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from './policy4';
import type { Lots } from './session.svelte';
import { FakeTimelineWorker, compiledMsg, filledMsg, refillMsg } from './test/fake-timeline-worker';
import { statics as baseStatics } from './test/fixtures';
import { gameAt } from './test/game';
import TimelineModeHost from './test/TimelineModeHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));

const manifest: Manifest = parseManifest(manifestJson);
const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const monthsTo = (last: number): Day[] =>
  Array.from({ length: last + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const MONTHS: Day[] = monthsTo(LAST);
const STATICS: ScoreStatics = { ...baseStatics({ lastIndex: LAST }), asOf, months: MONTHS };
/** The whole window's months, so the default goal's deadline is inside it. */
const LONG: ScoreStatics = {
  ...baseStatics({ lastIndex: WINDOW_MONTHS }),
  asOf,
  months: monthsTo(WINDOW_MONTHS)
};
const fmt = formatShortMonthYear;

// The measure at month i is 1000 + 3i + 1 (more with a base): 1025 at month 8, 1037 at month 12.
const metAt8: Goal = { ...GOAL_BASE, amount: 1025, deadline: MONTHS[12] };
const missedBy3313: Goal = { ...GOAL_BASE, amount: 4350, deadline: MONTHS[12] };

const protect = (years: number): Policy => ({
  id: 'a',
  label: 'Protect',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'newerThan' },
  spans: [{ from: monthFirstDay(asOf, 2), to: null, what: { tag: 'protect', years } }]
});
const mk = (...zoning: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money: [] }
});

type Over = Partial<{
  game: GameStore;
  goal: Goal;
  goalAmount: number;
  initialPolicy: SimPolicy4;
  initialRun: SimPolicy4;
  withInspector: boolean;
  inspectorOpen: boolean;
  onstarter: (choice: AddChoice, label: string) => void;
}>;

let workers: FakeTimelineWorker[];
const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

function setup(over: Over = {}) {
  const ctl: {
    setPolicy?: (p: SimPolicy4) => void;
    setRun?: (p: SimPolicy4) => void;
    setLots?: (l: Lots | null) => void;
    setLotsFailed?: (f: boolean) => void;
  } = {};
  const createWorker = vi.fn(() => {
    const f = new FakeTimelineWorker();
    workers.push(f);
    return f;
  });
  const r = render(TimelineModeHost, {
    props: {
      manifest,
      manifestError: false,
      calibration: cal,
      calibrationError: false,
      noScenario: false,
      datasetVersion: 'fixture-0',
      reload: async () => ({ manifest, calibration: cal }),
      createWorker,
      initialPolicy: over.initialPolicy ?? DEFAULT_POLICY4,
      initialLots: {},
      ctl,
      statusMs: 0,
      fetchPlaces: async () => null,
      ...(over.game ? { game: over.game } : {}),
      ...(over.goal ? { goal: over.goal } : {}),
      ...(over.goalAmount !== undefined ? { goalAmount: over.goalAmount } : {}),
      ...(over.initialRun ? { initialRun: over.initialRun } : {}),
      ...(over.withInspector ? { withInspector: true } : {}),
      ...(over.inspectorOpen !== undefined ? { inspectorOpen: over.inspectorOpen } : {}),
      ...(over.onstarter ? { onstarter: over.onstarter } : {})
    }
  });
  return {
    r,
    setPolicy: (p: SimPolicy4) => ctl.setPolicy!(p),
    setRun: (p: SimPolicy4) => ctl.setRun!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l),
    setLotsFailed: (f: boolean) => ctl.setLotsFailed!(f)
  };
}

/** Opened, compiled and filled through month LAST at rev 1. */
async function opened(over: Over = {}, statics: ScoreStatics = STATICS) {
  const s = setup(over);
  await expect.poll(() => workers.length).toBe(1);
  await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
  emit(compiledMsg(1, statics));
  emit(filledMsg(1, 0, LAST + 1));
  return s;
}

/** Unmounts the page and forgets its workers, for a second mount in the same test. */
async function unmount(s: ReturnType<typeof setup>) {
  (await s.r).unmount();
  workers = [];
}

const debug = () => window.__sfhFzp!;
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
const ruler = () => page.getByTestId('tl-ruler').element();
const win = () => page.getByTestId('tl-win');
/** The card's own button (the header's level cell has a "Level up" too). */
const cardButton = (name: 'Level up' | 'Keep playing') => win().getByRole('button', { name });
const notice = () => page.getByTestId('tl-goal-notice');
const none = (id: string) => document.querySelector(`[data-testid=${id}]`);

/**
 * The playhead by key: Home, then calendar months on to month `k`. The ruler takes each key: a
 * win card that opens on the way moves focus to its own button.
 */
async function keysTo(k: number) {
  const el = slider().element() as HTMLElement;
  el.focus();
  await userEvent.keyboard('{Home}');
  for (let guard = 0; debug().day !== MONTHS[k] && guard < k + 4; guard++) {
    el.focus();
    await userEvent.keyboard('{ArrowRight}');
  }
  await expect.poll(() => debug().day).toBe(MONTHS[k]);
}

/** An edit as the page's store sends it; `answer` gives the new numbers from `changed`. */
async function edit(s: ReturnType<typeof setup>) {
  s.setPolicy(mk(protect(7)));
  await tick();
}
async function answer(s: ReturnType<typeof setup>, changed: number) {
  s.setLots({});
  await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
  emit(compiledMsg(2, STATICS));
  emit(refillMsg(2, changed));
  emit(filledMsg(2, changed, LAST + 1 - changed, { base: 5 }));
  await expect.poll(() => debug().filledThrough).toBe(LAST);
  await expect.poll(() => debug().stale).toBe(false);
}

const offerOn = (on: Day) => ({ on, datasetVersion: 'fixture-0' });

beforeEach(async () => {
  workers = [];
  stub.reset();
  vi.stubEnv('VITE_E2E', '1');
  await page.viewport(1280, 900);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });
});

describe('TimelineMode in a game', () => {
  it('level 2: reaching the goal opens the win card', async () => {
    const game = gameAt(2);
    const won = vi.spyOn(game, 'won');
    const s = await opened({ game, goal: metAt8 });
    await keysTo(8);
    await expect.element(win()).toHaveTextContent(winTitle(MONTHS[8]));
    expect(debug().playing).toBe(false);
    expect(won).toHaveBeenCalledTimes(1);
    expect(game.offer).toEqual(offerOn(MONTHS[8]));
    expect(none('tl-goal-notice')).toBeNull();
    await unmount(s);

    // At today with nothing in force: no starters at level 2, where the page without a game has.
    const activity = { withInspector: true, inspectorOpen: false, onstarter: vi.fn() };
    const plain = await opened(activity);
    await expect
      .element(page.getByTestId('tl-activity').getByRole('list', { name: 'Try one:' }))
      .toBeVisible();
    await unmount(plain);
    await opened({ ...activity, game: gameAt(2) });
    await expect
      .element(page.getByTestId('tl-activity').getByRole('heading', { name: 'Activity' }))
      .toBeVisible();
    expect(page.getByText('Try one:').elements()).toHaveLength(0);
  });

  it('Keep playing and Escape close the card, focus the ruler, keep the offer', async () => {
    const game = gameAt(2);
    const s = await opened({ game, goal: metAt8 });
    await keysTo(8);
    await expect.element(win()).toBeInTheDocument();
    await cardButton('Keep playing').click();
    await expect.element(win()).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(ruler());
    expect(game.offer).toEqual(offerOn(MONTHS[8]));
    await unmount(s);

    const again = gameAt(2);
    await opened({ game: again, goal: metAt8 });
    await keysTo(8);
    await expect.poll(() => document.activeElement).toBe(cardButton('Level up').element());
    await userEvent.keyboard('{Escape}');
    await expect.element(win()).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(ruler());
    expect(again.offer).toEqual(offerOn(MONTHS[8]));
  });

  it('an edit closes the card and clears the offer; a new month reopens it; the kept month does not', async () => {
    const game = gameAt(2);
    const s = await opened({ game, goal: metAt8, initialPolicy: mk(protect(5)) });
    await keysTo(8);
    await expect.element(win()).toBeInTheDocument();
    await cardButton('Keep playing').click();
    await expect.element(win()).not.toBeInTheDocument();
    // Met at month 7 with the edit (base 5 from month 2).
    await edit(s);
    expect(game.offer).toBeNull();
    expect(none('tl-win')).toBeNull();
    await answer(s, 2);
    await keysTo(8);
    await expect.element(win()).toHaveTextContent(winTitle(MONTHS[7]));
    expect(game.offer).toEqual(offerOn(MONTHS[7]));
    await unmount(s);

    // An edit from month 10: the months seen are unchanged, so the kept month is seen again.
    const kept = gameAt(2);
    const k = await opened({ game: kept, goal: metAt8, initialPolicy: mk(protect(5)) });
    await keysTo(8);
    await cardButton('Keep playing').click();
    await expect.element(win()).not.toBeInTheDocument();
    await edit(k);
    expect(kept.offer).toBeNull();
    await answer(k, 10);
    await expect.poll(() => kept.offer).toEqual(offerOn(MONTHS[8]));
    await tick();
    expect(none('tl-win')).toBeNull();
  });

  it('an edit that closes the card with focus in it moves focus to the ruler', async () => {
    const s = await opened({ game: gameAt(2), goal: metAt8, initialPolicy: mk(protect(5)) });
    await keysTo(8);
    await expect.poll(() => document.activeElement).toBe(cardButton('Level up').element());
    await edit(s);
    expect(none('tl-win')).toBeNull();
    await expect.poll(() => document.activeElement).toBe(ruler());
  });

  it("an edit whose lots fail sees no result: the numbers on show are the last sent document's", async () => {
    const game = gameAt(2);
    const s = await opened({ game, goal: metAt8, initialPolicy: mk(protect(5)) });
    await edit(s);
    s.setLots(null);
    s.setLotsFailed(true);
    await expect.poll(() => debug().stale).toBe(false);
    await keysTo(8);
    await tick();
    expect(none('tl-win')).toBeNull();
    expect(none('tl-goal-notice')).toBeNull();
    expect(game.offer).toBeNull();
  });

  it('level 3 messages name the bar', async () => {
    const s = await opened({ game: gameAt(3, { bar: MONTHS[6] }), goal: metAt8 });
    await keysTo(8);
    await expect
      .element(notice())
      .toHaveTextContent(`Goal reached in ${fmt(MONTHS[8])}. Beat ${fmt(MONTHS[6])} to level up.`);
    await expect.element(page.getByTestId('tl-bar-flag')).toBeInTheDocument();
    await unmount(s);

    // A tie never beats: the same sentence, and no card.
    const tie = await opened({ game: gameAt(3, { bar: MONTHS[8] }), goal: metAt8 });
    await keysTo(8);
    await expect
      .element(notice())
      .toHaveTextContent(`Goal reached in ${fmt(MONTHS[8])}. Beat ${fmt(MONTHS[8])} to level up.`);
    expect(none('tl-win')).toBeNull();
    await unmount(tie);

    await opened({ game: gameAt(3, { bar: MONTHS[6] }), goal: missedBy3313 });
    await keysTo(13);
    await expect
      .element(notice())
      .toHaveTextContent(
        `Goal missed by 3,313 homes. Reach it before ${fmt(MONTHS[6])} to level up.`
      );
  });

  it('level 2 missed', async () => {
    await opened({ game: gameAt(2), goal: missedBy3313 });
    await keysTo(13);
    await expect.element(notice()).toHaveTextContent(/^Goal missed by 3,313 homes\.$/);
  });

  /** At level 2 with the card open at month 8, then `up` levels up; the page's answer. */
  async function levelsUp(up: (game: GameStore) => Promise<void>) {
    const game = gameAt(2);
    await opened({ game, goal: metAt8 });
    await keysTo(8);
    await expect.element(win()).toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(cardButton('Level up').element());
    await up(game);
    await expect.poll(() => game.progress.level).toBe(3);
    await expect.poll(() => debug().day).toBe(asOf);
    expect(debug().reached).toBe(asOf);
    await expect.poll(() => document.activeElement).toBe(ruler());
    expect(none('tl-win')).toBeNull();
    expect(none('tl-goal-notice')).toBeNull();
    await keysTo(8);
    // The bar is month 8: a tie.
    await expect
      .element(notice())
      .toHaveTextContent(`Goal reached in ${fmt(MONTHS[8])}. Beat ${fmt(MONTHS[8])} to level up.`);
    expect(none('tl-win')).toBeNull();
  }

  it('Level up returns the clock to today', async () => {
    await levelsUp(async () => {
      await cardButton('Level up').click();
    });
  });

  it("a level up from outside acts as the card's", async () => {
    await levelsUp(async (game) => {
      game.levelUp();
    });
  });

  it('a level that falls (a new game) is no level up: the clock stays', async () => {
    const game = gameAt(3, { bar: MONTHS[6] });
    await opened({ game, goal: metAt8 });
    await keysTo(8);
    expect(game.newGame()).toEqual({ ok: true });
    game.setOffer({ on: null, datasetVersion: 'fixture-0' });
    game.levelUp();
    expect(game.progress.level).toBe(2);
    await tick();
    await tick();
    expect(debug().day).toBe(MONTHS[8]);
  });

  /** Level 5 won at month 8 and levelled up: the round is complete. */
  async function completeRound() {
    const game = gameAt(5, { bar: MONTHS[10] });
    const s = await opened({ game, goal: metAt8, initialPolicy: mk(protect(5)) });
    await keysTo(8);
    await expect.element(win()).toHaveTextContent(unlockText(6));
    await cardButton('Level up').click();
    await expect.poll(() => roundComplete(game.progress)).toBe(true);
    expect(game.progress.level).toBe(5);
    await expect.poll(() => debug().day).toBe(asOf);
    await expect.poll(() => document.activeElement).toBe(ruler());
    await tick();
    expect(game.offer).toBeNull();
    return { game, s };
  }

  it('level 5 completes the round', async () => {
    const { game } = await completeRound();
    expect(none('tl-win')).toBeNull();
    expect(game.progress.banked[5]?.on).toBe(MONTHS[8]);
  });

  it('once the round is complete a win offers no level up', async () => {
    const { game, s } = await completeRound();
    await keysTo(8);
    await expect.element(win()).toHaveTextContent('Round complete');
    expect(cardButton('Level up').elements()).toHaveLength(0);
    await expect.poll(() => document.activeElement).toBe(cardButton('Keep playing').element());
    expect(game.offer).toEqual(offerOn(MONTHS[8]));

    const before = game.progress;
    game.levelUp();
    expect(game.progress).toBe(before);
    expect(game.offer).toBeNull();
    await tick();
    expect(game.offer).toBeNull();
    expect(debug().day).toBe(MONTHS[8]);
    await expect.element(win()).toBeInTheDocument();

    // An edit closes the card and keeps the clock; its answer (met at month 7, base 5 from month
    // 2) is a new win, so the card opens again, still with no level up.
    await edit(s);
    expect(none('tl-win')).toBeNull();
    expect(game.offer).toBeNull();
    expect(debug().day).toBe(MONTHS[8]);
    await answer(s, 2);
    await expect.element(win()).toHaveTextContent(winTitle(MONTHS[7]));
    expect(cardButton('Level up').elements()).toHaveLength(0);
    expect(game.offer).toEqual(offerOn(MONTHS[7]));
    expect(debug().day).toBe(MONTHS[8]);
  });

  it('the win card on the page passes axe in light and dark, its buttons at least 24 px', async () => {
    await opened({ game: gameAt(2), goal: metAt8 });
    await keysTo(8);
    await expect.element(win()).toBeVisible();
    for (const b of win().getByRole('button').elements()) {
      const r = b.getBoundingClientRect();
      expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(24);
    }
    for (const s of ['light', 'dark'] as const) {
      await cdp().send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: s }]
      });
      expect((await axe.run(win().element())).violations).toEqual([]);
    }
  });

  it('unmounting clears the offer', async () => {
    const game = gameAt(2);
    const s = await opened({ game, goal: metAt8 });
    await keysTo(8);
    await expect.poll(() => game.offer).toEqual(offerOn(MONTHS[8]));
    await unmount(s);
    expect(game.offer).toBeNull();
  });

  it("no game: today's page", async () => {
    for (const game of [undefined, openGame()]) {
      const s = await opened({ goal: metAt8, ...(game ? { game } : {}) });
      await keysTo(8);
      await expect
        .element(notice())
        .toHaveTextContent(
          `Goal reached in ${fmt(MONTHS[8])}, by the ${fmt(MONTHS[12])} deadline.`
        );
      expect(none('tl-win')).toBeNull();
      expect(none('tl-bar-flag')).toBeNull();
      expect(none('tl-locked-lane')).toBeNull();
      if (game) expect(game.offer).toBeNull();
      await unmount(s);
    }
  });

  it('run apart from policy', async () => {
    const s = await opened({ initialPolicy: mk(protect(5)), initialRun: mk() });
    expect(w().lastOf('openTimeline')!.policy).toEqual(mk());
    await page.getByRole('button', { name: 'Zoning', exact: true }).click();
    await expect.poll(() => page.getByTestId('tl-policy').elements().length).toBe(1);
    s.setRun(mk(protect(7)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.policy).toEqual(mk(protect(7)));
  });

  it("goalAmount sets the goal's amount", async () => {
    await opened({ goalAmount: 1025 }, LONG);
    await keysTo(8);
    await expect
      .element(notice())
      .toHaveTextContent(
        `Goal reached in ${fmt(MONTHS[8])}, by the ${fmt(defaultGoal(asOf).deadline)} deadline.`
      );
  });
});
