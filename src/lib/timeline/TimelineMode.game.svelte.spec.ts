// TimelineMode in a game (game-sim #sec-design-goal, #tbl-goal-props, #tbl-replacements): the goal
// in play is the rung's, the header's pinned item is GoalHeadline, there is no goal notice, the
// timeline holds to the game's limits, and the page is the simulation tool at all times (the map,
// the timeline, Play and Pause); over the real session and client with a fake worker, a recording
// SimMap stub, the real SiteHeader and a real GameStore.
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
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { NODES } from '$lib/game/catalogue/nodes';
import { RUNGS, goalAt, ladder } from '$lib/game/ladder';
import { formatCount } from '$lib/scoreboard/format';
import { SIDE_TUNING } from '$lib/game/catalogue/tuning';
import { SIDE_GOALS } from '$lib/game/side-goals';
import type { GameStore } from '$lib/game/store.svelte';
import { runResult } from '$lib/game/ui/test/fixtures';
import {
  GOAL_MET,
  LAST_GOAL,
  NO_SIDE_GOALS,
  goalLine,
  progressText,
  sideMetText,
  unlocksText
} from '$lib/game/ui/words';
import { TODAY, defaultGoal } from '$lib/goal/goal';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics, TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type { AddChoice } from './add';
import { LOCKED_LANE, goalUnlocks } from './game-copy';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from './policy4';
import type { Lots } from './session.svelte';
import { playheadAt } from './results';
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
/** "Collect N% of the homes in a run"'s target, as the catalogue tunes it (80 of 100 meets it). */
const SHARE_TARGET = SIDE_GOALS.find((g) => g.id === 'collect-share-1')!.read({
  view: null as never, // the share reads the take only
  index: 0,
  take: { dropped: { home: 1 }, collected: {} },
  inForce: false
})!.target;
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
      ...(over.initialFrame ? { initialFrame: over.initialFrame } : {}),
      ...(over.onstarter ? { onstarter: over.onstarter } : {}),
      ...(over.withInspector !== undefined ? { withInspector: over.withInspector } : {}),
      ...(over.inspectorOpen !== undefined ? { inspectorOpen: over.inspectorOpen } : {})
    }
  });
  return {
    r,
    setRun: (p: SimPolicy4) => ctl.setRun!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l)
  };
}

/** The worker exists and was asked to open. */
async function opening() {
  await expect.poll(() => workers.length).toBeGreaterThan(0);
  await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
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

/** The view the page holds once LONG is filled: its baseline under `chunk`'s rows. */
const longView = () =>
  ({
    baseline: { completedNet: LONG.baseline.units },
    rows: chunk(0, LONG.lastIndex + 1).rows
  }) as unknown as TimelineView;

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
  it("the pinned item is GoalHeadline, its homes the view's at today", async () => {
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
    const homes = goalAt(asOf, 0).measure.valueAt(longView(), TODAY);
    await expect
      .element(page.getByTestId('goal-headline-button'))
      .toHaveTextContent(goalLine(homes, AMOUNT, ladder(asOf)[0].label));
  });

  it('the opening phase shows GoalHeadline too', async () => {
    await opened({ game: gameWith() }, LONG);
    await expect.element(headline()).toBeVisible();
    expect(none('score-bar')).toBeNull();
  });

  it("the headline reads the playhead's month, whatever the last run", async () => {
    const last = runResult({ rung: 0, homes: 1234 });
    await opened({ game: gameWith({ phase: 'runs', runs: 1, last }) }, LONG);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(3));
    await expect.poll(() => debug().day).toBe(MONTHS[3]);
    const { index, atToday } = playheadAt(LONG.months, asOf, MONTHS[3]);
    const homes = goalAt(asOf, 0).measure.valueAt(longView(), atToday ? TODAY : index);
    expect(homes).toBeGreaterThan(LONG.baseline.units);
    await expect
      .element(page.getByTestId('goal-headline-button'))
      .toHaveTextContent(goalLine(homes, AMOUNT, ladder(asOf)[0].label));
    expect(headline().element().textContent).not.toContain('1,234');
  });

  it('the goal is goalAt of the rung, with goalAmount', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 1, rung: 1 }), goalAmount: 5000 }, LONG);
    await expect.element(headline()).toHaveTextContent(ladder(asOf)[1].label);
    await expect
      .element(headline())
      .toHaveTextContent(`of 5,000 homes by ${ladder(asOf)[1].label}`);
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
    // "Collect N% of the homes in a run": 80 of 100 collected is met.
    await expect.element(line2()).toHaveTextContent(sideMetText(1));
    await page.getByTestId('goal-headline-button').click();
    const share = page
      .getByTestId('side-goals')
      .getByTestId('side-goal')
      .filter({
        hasText: SIDE_GOALS.find((g) => g.id === 'collect-share-1')!.label
      });
    await expect.element(share).toHaveTextContent(progressText(80, SHARE_TARGET));
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

  describe('a side goal that reads the policy effect (ruling conductor-11)', () => {
    const EFFECT_ID = 'policy-homes-1';
    const effectGoal = SIDE_GOALS.find((g) => g.id === EFFECT_ID)!;
    /** Every month's plan effect is at least the goal's target, so only inForce decides. */
    const BASE = SIDE_TUNING[EFFECT_ID].target + 1;
    const row = () =>
      page.getByTestId('side-goals').getByTestId('side-goal').filter({ hasText: effectGoal.label });

    /** Opened and filled through the window with the effect at or above the target. */
    async function openedWithEffect(over: Over) {
      const s = setup(over);
      await opening();
      emit(compiledMsg(1, LONG));
      emit(filledMsg(1, 0, LONG.lastIndex + 1, { base: BASE }));
      await expect.poll(() => debug().filledThrough).toBe(LONG.lastIndex);
      return s;
    }

    it('with no policy in force the headline reads 0 for it', async () => {
      const game = gameWith({ phase: 'runs', runs: 1, last: runResult({ rung: 0 }) });
      await openedWithEffect({ game });
      await page.getByTestId('goal-headline-button').click();
      await expect.element(row()).toHaveTextContent(progressText(0, SIDE_TUNING[EFFECT_ID].target));
      expect(row().element().hasAttribute('data-met')).toBe(false);
    });

    it('with a policy in force the headline reads the plan effect', async () => {
      const game = gameWith({ phase: 'runs', runs: 1, last: runResult({ rung: 0 }) });
      await openedWithEffect({ game, initialPolicy: mk(protect(5)), initialRun: mk(protect(5)) });
      await page.getByTestId('goal-headline-button').click();
      await expect.element(row()).toHaveAttribute('data-met', 'true');
      expect(row().element().textContent).toMatch(
        new RegExp(`(^|\\s)(\\d[\\d,]*) of ${formatCount(SIDE_TUNING[EFFECT_ID].target)}`)
      );
      expect(row().element().textContent).not.toMatch(/(^|\s)0 of /);
    });
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

describe('TimelineMode in a game: one screen, the simulation tool', () => {
  const mode = () => page.getByTestId('tl-mode').element();
  const mapBox = () => page.getByTestId('tl-map-box').element();

  it("gameWith's id is fixed and valid", () => {
    expect(isValidId(GAME_ID)).toBe(true);
    expect(gameWith().currentId).toBe(GAME_ID);
  });

  for (const runs of [0, 1]) {
    it(`a game in its runs (${runs} settled) mounts the tool at once: dock, Playhead, chart, speeds`, async () => {
      await opened({ game: gameWith({ phase: 'runs', runs }) }, LONG);
      await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
      expect(none('tl-ruler')).not.toBeNull();
      expect(none('chart-svg')).not.toBeNull();
      expect(none('tl-play')).not.toBeNull();
      const speed = page.getByTestId('tl-speed');
      await expect.element(speed).toHaveTextContent('1×');
      await speed.click();
      await expect.element(speed).toHaveTextContent('3×');
      expect(none('map-key-control')).not.toBeNull();
      expect(none('tl-card')).not.toBeNull();
      // Nothing of the run, the tally or the tree.
      expect(none('run-layer')).toBeNull();
      expect(none('run-layer-box')).toBeNull();
      expect(none('run-clock')).toBeNull();
      expect(none('run-waiting')).toBeNull();
      expect(none('run-waiting-live')).toBeNull();
      expect(none('tl-tally')).toBeNull();
      expect(none('game-tree-pane')).toBeNull();
      expect(mode().hasAttribute('data-phase')).toBe(false);
      // The map is never inert or locked: it takes taps and is no focus stop of its own.
      expect(mapBox().hasAttribute('inert')).toBe(false);
      expect(mapBox().hasAttribute('aria-hidden')).toBe(false);
      expect(mapBox().hasAttribute('tabindex')).toBe(false);
      expect(mapBox().parentElement!.classList.contains('max-md:h-[40%]')).toBe(true);
      expect(stub.props.tapCards).toBe(true);
      expect('setRunView' in stub.handle).toBe(false);
    });
  }

  it('Space plays and pauses in a game', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }) }, LONG);
    await expect.element(page.getByTestId('tl-play')).toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(debug().playing).toBe(false);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(true);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(false);
  });

  it('a moveend asks for the viewport in a game', async () => {
    await opened({ game: gameWith({ phase: 'runs', runs: 0 }) }, LONG);
    await expect.poll(() => callsOf('getMap').length).toBeGreaterThan(0);
    const before = w().all('prefetch').length;
    stub.map.fire('moveend');
    expect(w().all('prefetch').length).toBe(before + 1);
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
