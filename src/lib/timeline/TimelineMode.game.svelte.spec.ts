// TimelineMode in a game (game-sim #sec-design-goal, #tbl-goal-props, #tbl-replacements): the goal
// in play is the rung's, the header's pinned item is GoalHeadline, there is no goal notice, and the
// timeline holds to the game's limits; over the real session and client with a fake worker, a
// recording SimMap stub, the real SiteHeader and a real GameStore.
/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { formatShortMonthYear } from '$lib/fzp/format';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import type { CameraFrame } from '$lib/map/types';
import type { GamePhase } from '$lib/sim-page/game-phase';
import { RHNA_DEADLINE } from '$lib/sim/scenario/score';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { NODES } from '$lib/game/catalogue/nodes';
import { RUNGS, ladder } from '$lib/game/ladder';
import { SIDE_GOALS } from '$lib/game/side-goals';
import type { GameStore } from '$lib/game/store.svelte';
import { runResult } from '$lib/game/ui/test/fixtures';
import {
  GOAL_MET,
  LAST_GOAL,
  NO_SIDE_GOALS,
  RUN_BUSY,
  goalLine,
  progressText,
  sideMetText,
  unlocksText
} from '$lib/game/ui/words';
import { defaultGoal } from '$lib/goal/goal';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type { AddChoice } from './add';
import { LOCKED_LANE, goalUnlocks } from './game-copy';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from './policy4';
import type { Lots } from './session.svelte';
import { FakeTimelineWorker, compiledMsg, filledMsg } from './test/fake-timeline-worker';
import { chunk, statics as baseStatics } from './test/fixtures';
import { GAME_ID, gameWith } from './test/game';
import { isValidId } from '$lib/ids/base58';
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
/** The whole window's months, so every rung's deadline is inside it. */
const LONG: ScoreStatics = {
  ...baseStatics({ lastIndex: WINDOW_MONTHS }),
  asOf,
  months: monthsTo(WINDOW_MONTHS)
};
const fmt = formatShortMonthYear;
/** The default amount: the goal in play's amount without `goalAmount`. */
const AMOUNT = defaultGoal(asOf).amount;

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
  goalAmount: number;
  initialPolicy: SimPolicy4;
  initialRun: SimPolicy4;
  phased: boolean;
  initialFrame: CameraFrame;
  onstarter: (choice: AddChoice, label: string) => void;
  withInspector: boolean;
  inspectorOpen: boolean;
}>;

let workers: FakeTimelineWorker[];
const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

function setup(over: Over = {}) {
  const ctl: {
    setPolicy?: (p: SimPolicy4) => void;
    setRun?: (p: SimPolicy4) => void;
    setLots?: (l: Lots | null) => void;
    setPhase?: (p: GamePhase) => void;
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
      ...(over.goalAmount !== undefined ? { goalAmount: over.goalAmount } : {}),
      ...(over.initialRun ? { initialRun: over.initialRun } : {}),
      ...(over.phased ? { phased: true } : {}),
      ...(over.initialFrame ? { initialFrame: over.initialFrame } : {}),
      ...(over.onstarter ? { onstarter: over.onstarter } : {}),
      ...(over.withInspector !== undefined ? { withInspector: over.withInspector } : {}),
      ...(over.inspectorOpen !== undefined ? { inspectorOpen: over.inspectorOpen } : {})
    }
  });
  return {
    r,
    setRun: (p: SimPolicy4) => ctl.setRun!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l),
    setPhase: (p: GamePhase) => ctl.setPhase!(p),
    setLotsFailed: (f: boolean) => ctl.setLotsFailed!(f)
  };
}

/** Opened and compiled at rev 1, filled through `through` (default the statics' last month). */
async function opened(over: Over = {}, statics: ScoreStatics = LONG, through?: number) {
  const s = setup(over);
  await expect.poll(() => workers.length).toBe(1);
  await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
  emit(compiledMsg(1, statics));
  emit(filledMsg(1, 0, (through ?? statics.lastIndex) + 1));
  await expect.poll(() => debug().filledThrough).toBe(through ?? statics.lastIndex);
  return s;
}

/** Unmounts the page and forgets its workers, for a second mount in the same test. */
async function unmount(s: ReturnType<typeof setup>) {
  (await s.r).unmount();
  workers = [];
}

const debug = () => window.__sfhFzp!;
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
const headline = () => page.getByTestId('goal-headline');
const line2 = () => page.getByTestId('goal-line2');
const none = (id: string) => document.querySelector(`[data-testid=${id}]`);

/** The playhead to the last filled day, by key. */
async function toEnd() {
  (slider().element() as HTMLElement).focus();
  await userEvent.keyboard('{End}');
  await expect.poll(() => debug().day).toBeGreaterThan(defaultGoal(asOf).deadline);
}

beforeEach(async () => {
  workers = [];
  stub.reset();
  vi.stubEnv('VITE_E2E', '1');
  await page.viewport(1280, 900);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('TimelineMode in a game: the goal and the header', () => {
  it("the pinned item is GoalHeadline with homes null before the rung's first run", async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }) }, LONG);
    const banner = page.getByRole('banner');
    await expect.element(banner.getByTestId('goal-headline')).toBeVisible();
    const slot = page.getByTestId('goal-headline').element().parentElement!; // SiteHeader's pinned box
    expect(slot.parentElement).toBe(banner.element());
    expect(page.getByTestId('goal-live').element().parentElement).toBe(slot); // both root nodes
    expect(getComputedStyle(banner.element()).position).toBe('relative');
    expect(getComputedStyle(slot).position).toBe('static');
    expect(document.querySelector('[data-testid=score-bar]')).toBeNull();
    expect(document.querySelector('[data-testid=tl-goal-notice]')).toBeNull();
    // Homes null: line 1 is the goal alone.
    expect(page.getByTestId('goal-headline-button').element().textContent).toContain(
      goalLine(null, AMOUNT, ladder(asOf)[0].label)
    );
  });

  it('the opening phase shows GoalHeadline too', async () => {
    await opened({ game: gameWith() }, LONG);
    await expect.element(headline()).toBeVisible();
    expect(none('score-bar')).toBeNull();
  });

  it("the headline shows the last run's homes on the rung in play", async () => {
    const last = runResult({ rung: 0, homes: 1234 });
    await opened({ game: gameWith({ phase: 'runs', runs: 1, last }) }, LONG);
    await expect.element(headline()).toHaveTextContent('1,234');
    await expect
      .element(page.getByTestId('goal-headline-button'))
      .toHaveTextContent(goalLine(1234, AMOUNT, ladder(asOf)[0].label));
  });

  it("a last run on another rung is not the rung in play's: homes null", async () => {
    const last = runResult({ rung: 0, homes: 1234 });
    await opened({ game: gameWith({ phase: 'runs', runs: 1, rung: 1, last }) }, LONG);
    await expect.element(headline()).toBeVisible();
    expect(headline().element().textContent).not.toContain('1,234');
    expect(page.getByTestId('goal-headline-button').element().textContent).toContain(
      goalLine(null, AMOUNT, ladder(asOf)[1].label)
    );
  });

  it('the goal is goalAt of the rung, with goalAmount', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 1, rung: 1 }), goalAmount: 5000 }, LONG);
    await expect.element(headline()).toHaveTextContent(ladder(asOf)[1].label);
    await expect.element(headline()).toHaveTextContent(`5,000 homes by ${ladder(asOf)[1].label}`);
  });

  it("unlocks names the next ring's levers and an earlier goal; the last rung has none", async () => {
    const ring1 = NODES.filter((n) => n.ring === 1).length;
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1 }) }, LONG);
    await expect.element(line2()).toHaveTextContent(unlocksText(goalUnlocks(ring1, true)));
    await unmount(s);

    await opened({ game: gameWith({ phase: 'runs', runs: 1, rung: RUNGS - 1 }) }, LONG);
    await expect.element(line2()).toHaveTextContent(LAST_GOAL);
  });

  it('met is a met entry for the rung in play', async () => {
    const met = [
      { rung: 0, reachedOn: MONTHS[8], datasetVersion: 'fixture-0', at: '2026-11-25T00:00:00.000Z' }
    ];
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1, met }) }, LONG);
    await expect.element(line2()).toHaveTextContent(GOAL_MET);
    expect(page.getByTestId('goal-box').element().getAttribute('data-met')).toBe('true');
    await unmount(s);

    // Met at rung 0, playing rung 1: not met.
    await opened({ game: gameWith({ phase: 'runs', runs: 1, rung: 1, met }) }, LONG);
    await expect.element(headline()).toBeVisible();
    expect(line2().element().textContent).not.toContain(GOAL_MET);
    expect(page.getByTestId('goal-box').element().hasAttribute('data-met')).toBe(false);
  });

  it("side goals read the last run's take on the rung in play at the deadline's month", async () => {
    const last = runResult({ rung: 0, dropped: { home: 100 }, collected: { home: 80 } });
    await opened({ game: gameWith({ phase: 'runs', runs: 1, last }) }, LONG);
    // Collect 50% of the homes in a run: 80 of 100 collected is met.
    await expect.element(line2()).toHaveTextContent(sideMetText(1));
    await page.getByTestId('goal-headline-button').click();
    const share = page
      .getByTestId('side-goals')
      .getByTestId('side-goal')
      .filter({
        hasText: SIDE_GOALS.find((g) => g.id === 'collect-share-1')!.label
      });
    await expect.element(share).toHaveTextContent(progressText(80, 50));
    await expect.element(share).toHaveAttribute('data-met', 'true');
  });

  it('a last run on another rung gives a take of zero: the share goal is left out', async () => {
    const last = runResult({ rung: 1, dropped: { home: 100 }, collected: { home: 80 } });
    await opened({ game: gameWith({ phase: 'runs', runs: 1, last }) }, LONG);
    await expect.element(headline()).toBeVisible();
    await page.getByTestId('goal-headline-button').click();
    await expect.element(page.getByTestId('side-goals')).toBeVisible();
    const label = SIDE_GOALS.find((g) => g.id === 'collect-share-1')!.label;
    expect(page.getByTestId('side-goal').filter({ hasText: label }).elements()).toHaveLength(0);
    expect(line2().element().textContent).not.toContain(sideMetText(1));
  });

  it("side goals are empty while the deadline's month is not filled", async () => {
    const last = runResult({ rung: 0, dropped: { home: 100 }, collected: { home: 80 } });
    await opened({ game: gameWith({ phase: 'runs', runs: 1, last }) }, LONG, LAST);
    await expect.element(headline()).toBeVisible();
    await page.getByTestId('goal-headline-button').click();
    await expect.element(page.getByTestId('side-goals')).toHaveTextContent(NO_SIDE_GOALS);
  });

  it('there is no goal notice in a game, where the page without one has one', async () => {
    const plain = await opened({}, LONG);
    await toEnd();
    await expect.element(page.getByTestId('tl-goal-notice')).toBeInTheDocument();
    await unmount(plain);

    await opened({ game: gameWith({ phase: 'runs', runs: 1 }) }, LONG);
    await toEnd();
    await tick();
    expect(none('tl-goal-notice')).toBeNull();
    expect(none('tl-goal')).not.toBeNull();
  });

  it('Activity offers no starters in a game, even given onstarter; without one it does', async () => {
    const onstarter = vi.fn();
    const plain = await opened({ withInspector: true, inspectorOpen: false, onstarter }, LONG);
    const activity = page.getByTestId('tl-activity');
    await expect.element(activity.getByText('Try one:')).toBeVisible();
    await unmount(plain);

    await opened(
      {
        game: gameWith({ phase: 'runs', runs: 1 }),
        withInspector: true,
        inspectorOpen: false,
        onstarter
      },
      LONG
    );
    await expect.element(page.getByTestId('tl-activity')).toBeVisible();
    expect(page.getByTestId('tl-activity').getByText('Try one:').elements()).toHaveLength(0);
  });

  it("the timeline holds to the game's limits: nothing bought, the lanes are locked", async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 1 }) }, LONG);
    await expect.poll(() => page.getByTestId('tl-locked-lane').elements().length).toBe(3);
    for (const el of page.getByTestId('tl-locked-lane').elements()) {
      expect(el.textContent).toBe(LOCKED_LANE);
    }
  });
});

describe('TimelineMode in a game: the phases and what each mounts (#tbl-phase-mounts)', () => {
  const mode = () => page.getByTestId('tl-mode').element();
  const mapBox = () => page.getByTestId('tl-map-box').element();
  const hostTree = () => page.getByTestId('host-tree').element();
  const phaseIs = (p: string) => expect.poll(() => mode().getAttribute('data-phase')).toBe(p);
  it("gameWith's id is fixed and valid", () => {
    expect(isValidId(GAME_ID)).toBe(true);
    expect(gameWith().currentId).toBe(GAME_ID);
  });

  const space = () => {
    const e = new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true });
    window.dispatchEvent(e);
    return e;
  };

  it('tree: the pane covers the map box, which is inert; no dock, key or card', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    expect(mode().getAttribute('data-phase')).toBe('tree');
    const pane = page.getByTestId('game-tree-pane').element().getBoundingClientRect();
    const box = mapBox().getBoundingClientRect();
    expect([pane.top, pane.left, pane.width, pane.height]).toEqual([
      box.top,
      box.left,
      box.width,
      box.height
    ]);
    expect(page.getByTestId('game-tree-pane').element().contains(hostTree())).toBe(true);
    expect(mapBox().contains(hostTree())).toBe(false);
    expect(mapBox().hasAttribute('inert')).toBe(true);
    expect(mapBox().getAttribute('aria-hidden')).toBe('true');
    // The map stays mounted under the tree.
    expect(none('fzp-sim-map-stub')).not.toBeNull();
    expect(none('tl-dock')).toBeNull();
    expect(none('map-key-control')).toBeNull();
    expect(none('tl-card')).toBeNull();
  });

  it('starting: the map takes the whole mode box; no dock, key or card; taps open no card', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    expect(mode().getAttribute('data-phase')).toBe('starting');
    expect(none('tl-dock')).toBeNull();
    expect(none('map-key-control')).toBeNull();
    expect(none('tl-card')).toBeNull();
    expect(none('game-tree-pane')).toBeNull();
    expect(mapBox().hasAttribute('inert')).toBe(false);
    expect(mapBox().getAttribute('tabindex')).toBe('-1');
    expect(stub.props.tapCards).toBe(false);
    const box = mapBox().getBoundingClientRect();
    expect(box.bottom).toBe(mode().getBoundingClientRect().bottom);
    // Below md too: the map's container loses its 40% share.
    expect(mapBox().parentElement!.classList.contains('max-md:h-[40%]')).toBe(false);
    await page.viewport(390, 844);
    await expect
      .poll(() => mapBox().getBoundingClientRect().bottom)
      .toBe(mode().getBoundingClientRect().bottom);
  });

  it('workshop keeps the map container its 40% share below md', async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    s.setPhase('workshop');
    await phaseIs('workshop');
    expect(mapBox().parentElement!.classList.contains('max-md:h-[40%]')).toBe(true);
  });

  it('the waiting region is a real box, in the accessibility tree', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    const live = page.getByTestId('run-waiting-live').element();
    expect(live.getAttribute('role')).toBe('status');
    expect(getComputedStyle(live).display).not.toBe('contents');
    await expect.element(page.getByRole('status').filter({ hasText: RUN_BUSY })).toBeVisible();
  });

  it("workshop: today's layout, the dock, key and card mounted, the map not inert", async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    await phaseIs('tree');
    s.setPhase('workshop');
    await phaseIs('workshop');
    await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
    expect(none('map-key-control')).not.toBeNull();
    expect(none('tl-card')).not.toBeNull();
    expect(none('game-tree-pane')).toBeNull();
    expect(mapBox().hasAttribute('inert')).toBe(false);
    expect(mapBox().hasAttribute('aria-hidden')).toBe(false);
    expect(mapBox().hasAttribute('tabindex')).toBe(false);
    expect(stub.props.tapCards).toBe(true);
  });

  it('setRunView: true in starting, false in tree; never without a game', async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    await expect.poll(() => callsOf('setRunView').at(-1)).toEqual([false]);
    // Tree's Run sends `run`: tree to starting.
    await page.getByTestId('host-run').click();
    await phaseIs('starting');
    await expect.poll(() => callsOf('setRunView').at(-1)).toEqual([true]);
    s.setPhase('tally');
    await phaseIs('tally');
    await expect.poll(() => callsOf('setRunView').length).toBe(3);
    expect(callsOf('setRunView').at(-1)).toEqual([true]);
    s.setPhase('workshop');
    await phaseIs('workshop');
    await expect.poll(() => callsOf('setRunView').at(-1)).toEqual([false]);
    await unmount(s);
    stub.reset();

    await opened({}, LONG);
    expect(mode().getAttribute('data-phase')).toBe('none');
    expect(callsOf('getMap').length).toBeGreaterThan(0); // the map was ready
    expect(callsOf('setRunView')).toEqual([]);
  });

  it('setRunView is called once in onMapReady with the phase', async () => {
    stub.autoReady = false;
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    expect(callsOf('setRunView')).toEqual([]);
    stub.fireReady();
    await expect.poll(() => callsOf('setRunView')).toEqual([[true]]);
  });

  it('prefetchViewport asks nothing while in RUN_VIEW, and asks in tree', async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    const before = w().all('prefetch').length;
    stub.map.fire('moveend');
    expect(w().all('prefetch').length).toBe(before);
    s.setPhase('tally');
    await phaseIs('tally');
    stub.map.fire('moveend');
    expect(w().all('prefetch').length).toBe(before);
    // The control: out of RUN_VIEW the same moveend asks.
    s.setPhase('tree');
    await phaseIs('tree');
    stub.map.fire('moveend');
    expect(w().all('prefetch').length).toBe(before + 1);
  });

  it('Space in starting and tally does nothing and is prevented', async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    expect(mode().getAttribute('data-phase')).toBe('starting');
    const e = space();
    expect(e.defaultPrevented).toBe(true);
    expect(debug().playing).toBe(false);
    s.setPhase('tally');
    await phaseIs('tally');
    const t = space();
    expect(t.defaultPrevented).toBe(true);
    expect(debug().playing).toBe(false);
    // The control: in workshop Space plays.
    s.setPhase('workshop');
    await phaseIs('workshop');
    await expect.element(page.getByTestId('tl-play')).toBeInTheDocument();
    space();
    await expect.poll(() => debug().playing).toBe(true);
  });

  it('busy while the forecast is not ready, false once it is; ending null before the last rung is met', async () => {
    setup({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true });
    await expect.poll(() => workers.length).toBe(1);
    await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
    await expect.element(page.getByTestId('host-tree')).toHaveAttribute('data-busy', 'true');
    emit(compiledMsg(1, LONG));
    emit(filledMsg(1, 0, LONG.lastIndex + 1));
    await expect.element(page.getByTestId('host-tree')).toHaveAttribute('data-busy', 'false');
    expect(hostTree().getAttribute('data-ending')).toBe('null');
  });

  it('busy again while lots have failed', async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    await expect.element(page.getByTestId('host-tree')).toHaveAttribute('data-busy', 'false');
    s.setLotsFailed(true);
    s.setLots(null);
    await expect.element(page.getByTestId('host-tree')).toHaveAttribute('data-busy', 'true');
  });

  it('ending once finished: reachedOn of the last met rung, stateBy RHNA_DEADLINE', async () => {
    const met = Array.from({ length: RUNGS }, (_, rung) => ({
      rung,
      reachedOn: asOf + 400 + rung,
      datasetVersion: 'fixture-0',
      at: '2026-11-25T00:00:00.000Z'
    }));
    const game = gameWith({ phase: 'runs', runs: RUNGS, rung: RUNGS - 1, met });
    await opened({ game, phased: true }, LONG);
    await expect
      .poll(() => JSON.parse(hostTree().getAttribute('data-ending')!))
      .toEqual({ reachedOn: asOf + 400 + RUNGS - 1, stateBy: RHNA_DEADLINE, perAddedHome: null });
  });

  it("ending's perAddedHome is the view's at the deadline's month when it has money", async () => {
    const met = Array.from({ length: RUNGS }, (_, rung) => ({
      rung,
      reachedOn: asOf + 400,
      datasetVersion: 'fixture-0',
      at: '2026-11-25T00:00:00.000Z'
    }));
    const game = gameWith({ phase: 'runs', runs: RUNGS, rung: RUNGS - 1, met });
    const finance: ScoreStatics = { ...LONG, limits: [], debts: [] };
    setup({ game, phased: true });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, finance));
    emit({
      type: 'filled',
      rev: 1,
      through: finance.lastIndex,
      series: chunk(0, finance.lastIndex + 1, { pools: ['p'] })
    });
    await expect
      .poll(() => JSON.parse(hostTree().getAttribute('data-ending')!)?.perAddedHome)
      .toEqual(expect.any(Number));
  });

  it("starting shows the waiting notice in a status region; tree doesn't", async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    const waiting = page.getByTestId('run-waiting');
    await expect.element(waiting).toHaveTextContent(RUN_BUSY);
    expect(waiting.element().closest('[role=status]')).not.toBeNull();
    s.setPhase('tree');
    await phaseIs('tree');
    expect(none('run-waiting')).toBeNull();
  });

  it('focus: the map box in starting; the Zoning toggle in workshop with nothing selected', async () => {
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    await page.getByTestId('host-run').click();
    await phaseIs('starting');
    await expect.poll(() => document.activeElement).toBe(mapBox());
    s.setPhase('workshop');
    await phaseIs('workshop');
    const toggle = page.getByRole('button', { name: 'Zoning', exact: true }).element();
    await expect.poll(() => document.activeElement).toBe(toggle);
  });

  it('focus: from the keyboard the map box in starting shows a focus ring', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 1 }), phased: true }, LONG);
    (page.getByTestId('host-run').element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    await phaseIs('starting');
    await expect.poll(() => document.activeElement).toBe(mapBox());
    expect(mapBox().matches(':focus-visible')).toBe(true);
    const style = getComputedStyle(mapBox());
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
  });

  it('focus: a page landing in starting does not take focus at load', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    expect(mode().getAttribute('data-phase')).toBe('starting');
    await tick();
    await tick();
    expect(document.activeElement).not.toBe(mapBox());
    expect(mapBox().contains(document.activeElement)).toBe(false);
  });

  it('focus: a change to tree moves none (the tree keeps the Run it focused)', async () => {
    // Land in starting, then change to tree: the stub tree focuses its Run on mount, as Tree does.
    const s = await opened({ game: gameWith({ phase: 'runs', runs: 0 }), phased: true }, LONG);
    s.setPhase('run');
    await phaseIs('run');
    await expect.poll(() => document.activeElement).toBe(mapBox());
    s.setPhase('tree');
    await phaseIs('tree');
    const run = page.getByTestId('host-run').element();
    await expect.poll(() => document.activeElement).toBe(run);
    await tick();
    await tick();
    expect(document.activeElement).toBe(run);
  });

  it('no phase without phased: data-phase none and the dock mounts', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 1 }) }, LONG);
    expect(mode().getAttribute('data-phase')).toBe('none');
    await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
    expect(callsOf('setRunView')).toEqual([]);
  });

  it('initialFrame reaches SimMap', async () => {
    const frame = { center: [-122.42, 37.77], zoom: 15, bearing: 0, pitch: 0 } as CameraFrame;
    await opened({ initialFrame: frame }, LONG);
    expect(stub.props.initialFrame).toEqual(frame);
  });
});

describe('TimelineMode without a game', () => {
  it('run apart from policy', async () => {
    const s = await opened({ initialPolicy: mk(protect(5)), initialRun: mk() }, LONG, LAST);
    expect(w().lastOf('openTimeline')!.policy).toEqual(mk());
    await page.getByRole('button', { name: 'Zoning', exact: true }).click();
    await expect.poll(() => page.getByTestId('tl-policy').elements().length).toBe(1);
    s.setRun(mk(protect(7)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.policy).toEqual(mk(protect(7)));
  });

  it("goalAmount sets the goal's amount", async () => {
    await opened({ goalAmount: 1025 }, LONG, LAST);
    const el = slider().element() as HTMLElement;
    el.focus();
    await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(8));
    await expect.poll(() => debug().day).toBe(MONTHS[8]);
    await expect
      .element(page.getByTestId('tl-goal-notice'))
      .toHaveTextContent(
        `Goal reached in ${fmt(MONTHS[8])}, by the ${fmt(defaultGoal(asOf).deadline)} deadline.`
      );
  });
});
