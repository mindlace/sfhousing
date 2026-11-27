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
import { PENDING } from '$lib/game/rounds';
import type { GameStore } from '$lib/game/store.svelte';
import { pinnedWords, type PinnedCtx } from '$lib/game/ui/round-words';
import { TODAY, defaultGoal } from '$lib/goal/goal';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics, TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type { AddChoice } from './add';
import { offerThrough } from '$lib/game/offer';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from './policy4';
import type { Lots } from './session.svelte';
import { playheadAt } from './results';
import { FakeTimelineWorker, compiledMsg, filledMsg, refillMsg } from './test/fake-timeline-worker';
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
/** The legal deadline: the goal's deadline while a game has no target. */
const LEGAL = defaultGoal(asOf).deadline;
/** The pinned goal's pending words in a game. */
const words = (c: Partial<PinnedCtx> = {}) =>
  pinnedWords(PENDING, {
    amount: AMOUNT,
    target: null,
    legal: LEGAL,
    round: 0,
    finished: false,
    next: 3,
    ...c
  });

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
  ongift: (w: { goalMonth: Day | null }) => boolean;
}>;

let workers: FakeTimelineWorker[];
const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

function setup(over: Over = {}) {
  const ctl: {
    setPolicy?: (p: SimPolicy4) => void;
    setRun?: (p: SimPolicy4) => void;
    setLots?: (l: Lots | null) => void;
    edit?: (change: (p: SimPolicy4) => SimPolicy4) => void;
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
      ...(over.ongift ? { ongift: over.ongift } : {}),
      ...(over.withInspector !== undefined ? { withInspector: over.withInspector } : {}),
      ...(over.inspectorOpen !== undefined ? { inspectorOpen: over.inspectorOpen } : {})
    }
  });
  return {
    r,
    setRun: (p: SimPolicy4) => ctl.setRun!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l),
    edit: (change: (p: SimPolicy4) => SimPolicy4) => ctl.edit!(change)
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
  const line1 = () => page.getByTestId('goal-line1');
  const bar = () => page.getByTestId('goal-bar');
  /** The bar's data-fill for `homes` of the amount. */
  const pct = (homes: number, amount = AMOUNT) => String(Math.floor((homes / amount) * 100));

  it("the pinned item is GoalHeadline, its bar the view's homes at today", async () => {
    await opened({ game: gameWith({ phase: 'runs' }) }, LONG);
    const banner = page.getByRole('banner');
    await expect.element(banner.getByTestId('goal-headline')).toBeVisible();
    const slot = page.getByTestId('goal-headline').element().parentElement!; // SiteHeader's pinned box
    expect(slot.parentElement).toBe(banner.element());
    expect(page.getByTestId('goal-live').element().parentElement).toBe(slot); // both root nodes
    expect(document.querySelector('[data-testid=score-bar]')).toBeNull();
    expect(document.querySelector('[data-testid=tl-goal-notice]')).toBeNull();
    await expect.element(line1()).toHaveTextContent(words().line1);
    await expect.element(line2()).toHaveTextContent(words().line2);
    const homes = defaultGoal(asOf).measure.valueAt(longView(), TODAY);
    await expect.element(bar()).toHaveAttribute('data-fill', pct(homes));
  });

  it('the opening phase shows GoalHeadline too', async () => {
    await opened({ game: gameWith() }, LONG);
    await expect.element(headline()).toBeVisible();
    expect(none('score-bar')).toBeNull();
  });

  it("the bar reads the playhead's month", async () => {
    await opened({ game: gameWith({ phase: 'runs', round: 1 }) }, LONG);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(3));
    await expect.poll(() => debug().day).toBe(MONTHS[3]);
    const { index, atToday } = playheadAt(LONG.months, asOf, MONTHS[3]);
    const homes = defaultGoal(asOf).measure.valueAt(longView(), atToday ? TODAY : index);
    expect(homes).toBeGreaterThan(LONG.baseline.units);
    await expect.element(bar()).toHaveAttribute('data-fill', pct(homes));
  });

  it('the goal is the target, with goalAmount', async () => {
    const target = dayFromUtc(2055, 12, 1);
    await opened({ game: gameWith({ phase: 'runs', round: 2, target }), goalAmount: 5000 }, LONG);
    await expect
      .element(line1())
      .toHaveTextContent(words({ amount: 5000, target, round: 2 }).line1);
    expect(line1().element().textContent).toContain(`before ${fmt(target)}`);
  });

  it('with no target the goal is the legal deadline', async () => {
    await opened({ game: gameWith({ phase: 'runs' }) }, LONG);
    await expect.element(line1()).toHaveTextContent(`by ${fmt(LEGAL)}`);
  });

  it("line 2 names the next round's policies, then every policy, then your best", async () => {
    const s1 = await opened({ game: gameWith({ phase: 'runs', round: 1 }) }, LONG);
    await expect.element(line2()).toHaveTextContent(words({ round: 1, next: 3 }).line2);
    await unmount(s1);

    const s4 = await opened({ game: gameWith({ phase: 'runs', round: 4 }) }, LONG);
    await expect.element(line2()).toHaveTextContent(words({ round: 4, next: 0 }).line2);
    await unmount(s4);

    await opened({ game: gameWith({ phase: 'runs', round: 4, finished: true }) }, LONG);
    await expect.element(line2()).toHaveTextContent(words({ finished: true }).line2);
  });

  it('there is no goal notice in a game, where the page without one has one', async () => {
    const plain = await opened({}, LONG);
    await toEnd();
    await expect.element(page.getByTestId('tl-goal-notice')).toBeInTheDocument();
    await unmount(plain);

    await opened({ game: gameWith({ phase: 'runs', round: 1 }) }, LONG);
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
        game: gameWith({ phase: 'runs', round: 1 }),
        withInspector: true,
        inspectorOpen: false,
        onstarter
      },
      LONG
    );
    await expect.element(page.getByTestId('tl-activity')).toBeVisible();
    expect(page.getByTestId('tl-activity').getByText('Try one:').elements()).toHaveLength(0);
  });

  it("the timeline holds to the game's limits: no locked lane; '+' only where a round opens it", async () => {
    const plus = (kind: string) =>
      document.querySelector(`[data-testid="tl-kind-${kind}"] .plus`) !== null;
    const s0 = await opened({ game: gameWith({ phase: 'runs' }) }, LONG);
    await expect.element(page.getByTestId('tl-kind-zoning')).toBeInTheDocument();
    expect(none('tl-locked-lane')).toBeNull();
    expect([plus('zoning'), plus('permitting'), plus('money')]).toEqual([false, false, false]);
    await unmount(s0);

    await opened({ game: gameWith({ phase: 'runs', round: 1 }) }, LONG);
    await expect.element(page.getByTestId('tl-kind-zoning')).toBeInTheDocument();
    expect([plus('zoning'), plus('permitting'), plus('money')]).toEqual([true, false, true]);
  });
});

describe('TimelineMode in a game: the reset and the result (P16, P19)', () => {
  /** The months of LONG: M[k] is the first day of the k-th calendar month from today's. */
  const M = LONG.months;
  /** The goal month under `chunk`'s rows (homes 1,000 + 3k + 1 at month k, base 0). */
  const K = 40;
  const amount = 1001 + 3 * K;
  const state = () => headline().element().getAttribute('data-state');
  const gift = () => page.getByTestId('goal-gift');
  /** Model month k's first day (k >= 1), where a reconciled span starts. */
  const start = (k: number) => monthFirstDay(asOf, k);
  /** Protection over newer lots from `from`, on or off. */
  const from = (day: Day, on: boolean): Policy => ({
    ...protect(5),
    on,
    spans: [{ from: day, to: null, what: { tag: 'protect', years: 5 } }]
  });
  const switchOn = (p: SimPolicy4): SimPolicy4 => ({
    ...p,
    kinds: { ...p.kinds, zoning: p.kinds.zoning.map((x) => ({ ...x, on: true })) }
  });

  /** The playhead by key: Home, then `k` calendar months on. */
  async function keysTo(k: number) {
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(k));
    await expect.poll(() => debug().day).toBe(M[k]);
  }
  /** The page's onedit with `change`, and the lots PolicySync settles, so the edit goes out. */
  async function edit(
    s: Awaited<ReturnType<typeof opened>>,
    change: (p: SimPolicy4) => SimPolicy4
  ) {
    s.edit(change);
    s.setLots({});
    await tick();
  }
  /** The worker's answer to rev `rev`: the whole window again, every value shifted by `base`. */
  async function answer(rev: number, base = 0) {
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(rev);
    emit(compiledMsg(rev, LONG));
    emit(refillMsg(rev, 0));
    emit(filledMsg(rev, 0, WINDOW_MONTHS + 1, { base }));
    await expect.poll(() => debug().stale).toBe(false);
    await expect.poll(() => debug().filledThrough).toBe(WINDOW_MONTHS);
  }
  const game0 = () => gameWith({ phase: 'runs' });

  it('round 0: reaching the goal month gives the win; going back keeps it; no ongift, no gift', async () => {
    await opened({ game: game0(), goalAmount: amount }, LONG);
    await keysTo(K - 1);
    expect(state()).toBe('pending');
    await keysTo(K);
    await expect.poll(state).toBe('win');
    await expect.element(line2()).toHaveTextContent('Current law');
    expect(none('goal-gift')).toBeNull();
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    expect(state()).toBe('win');
  });

  it('the gift shows in a win when the page gives ongift', async () => {
    await opened({ game: game0(), goalAmount: amount, ongift: () => false }, LONG);
    await keysTo(K);
    await expect.element(gift()).toBeVisible();
  });

  it('while the numbers are stale, passing the goal month leaves pending', async () => {
    const s = await opened(
      { game: game0(), goalAmount: amount, initialPolicy: mk(from(start(2), false)) },
      LONG
    );
    await edit(s, switchOn);
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(debug().stale).toBe(true);
    await keysTo(K + 5);
    await tick();
    expect(state()).toBe('pending');
  });

  it('a switch at the window end pauses and puts the playhead at the first month, pending', async () => {
    const s = await opened(
      { game: game0(), goalAmount: amount, initialPolicy: mk(from(start(2), false)) },
      LONG
    );
    await toEnd();
    await expect.poll(state).toBe('win');
    await edit(s, switchOn);
    await expect.poll(() => debug().day).toBe(start(2));
    expect(debug().playing).toBe(false);
    expect(debug().reached).toBe(start(2));
    expect(debug().playFrom).toBeNull();
    expect(state()).toBe('pending');
  });

  it("a switch from today's model month puts the playhead at its first day", async () => {
    const s = await opened(
      { game: game0(), goalAmount: amount, initialPolicy: mk(from(start(1), false)) },
      LONG
    );
    await toEnd();
    await edit(s, switchOn);
    await expect.poll(() => debug().day).toBe(Math.max(asOf, start(1)));
    expect(state()).toBe('pending');
  });

  it('while playing before the first month, a switch pauses and moves the playhead forward to it', async () => {
    const s = await opened(
      { game: game0(), goalAmount: amount, initialPolicy: mk(from(start(30), false)) },
      LONG
    );
    await keysTo(3);
    await page.getByTestId('tl-play').click();
    await expect.poll(() => debug().playing).toBe(true);
    await edit(s, switchOn);
    await expect.poll(() => debug().day).toBe(start(30));
    expect(debug().playing).toBe(false);
    expect(debug().reached).toBe(start(30));
  });

  it('a change after the new goal month: the end is pending; back onto the goal month wins', async () => {
    const s = await opened(
      { game: game0(), goalAmount: amount, initialPolicy: mk(from(start(50), false)) },
      LONG
    );
    await keysTo(3);
    await edit(s, switchOn);
    await expect.poll(() => debug().day).toBe(start(50));
    // The new forecast reaches the goal at month 30, before the reset day.
    await answer(2, 30);
    expect(debug().day).toBe(start(50));
    await toEnd();
    await tick();
    expect(state()).toBe('pending');
    await keysTo(30);
    await expect.poll(state).toBe('win');
  });

  it('adding an off policy moves nothing and keeps a held win', async () => {
    const s = await opened({ game: game0(), goalAmount: amount }, LONG);
    await keysTo(K);
    await expect.poll(state).toBe('win');
    await edit(s, (p) => offerThrough(p, 1, cal));
    await answer(2);
    expect(debug().day).toBe(M[K]);
    expect(state()).toBe('win');
  });

  it('a target before the goal month: at the target the state is late, 2 years late, no gift', async () => {
    const target = M[K - 24];
    await opened(
      {
        game: gameWith({ phase: 'runs', round: 1, target }),
        goalAmount: amount,
        ongift: () => true
      },
      LONG
    );
    await keysTo(K - 25);
    expect(state()).toBe('pending');
    await keysTo(K - 24);
    await expect.poll(state).toBe('late');
    await expect.element(line2()).toHaveTextContent('2 years late');
    expect(none('goal-gift')).toBeNull();
  });

  it('pressing the gift calls ongift with the goal month; taken, the goal stays pending until a change', async () => {
    const ongift = vi.fn(() => true);
    const s = await opened(
      { game: game0(), goalAmount: amount, ongift, initialPolicy: mk(from(start(2), false)) },
      LONG
    );
    await keysTo(K);
    await gift().click();
    expect(ongift).toHaveBeenCalledWith({ goalMonth: M[K] });
    await expect.poll(state).toBe('pending');
    await toEnd();
    await keysTo(K);
    expect(state()).toBe('pending');
    // A change clears it: the forecast is judged afresh.
    await edit(s, switchOn);
    await answer(2);
    await keysTo(K);
    await expect.poll(state).toBe('win');
  });

  it('a gift ongift declines leaves the win standing', async () => {
    const ongift = vi.fn(() => false);
    await opened({ game: game0(), goalAmount: amount, ongift }, LONG);
    await keysTo(K);
    await gift().click();
    expect(ongift).toHaveBeenCalledOnce();
    expect(state()).toBe('win');
  });

  it('at 320 px the win reads in one line beside the status cell and the Menu', async () => {
    await page.viewport(320, 700);
    await opened({ game: game0(), goalAmount: amount, ongift: () => false }, LONG);
    await keysTo(K);
    await expect.poll(state).toBe('win');
    const phone = page.getByTestId('goal-phone').element() as HTMLElement;
    await expect.element(page.getByTestId('goal-phone')).toBeVisible();
    // The rest ends inside the line: nothing of "early" is clipped.
    const rest = phone.querySelector<HTMLElement>('.goal-rest')!.getBoundingClientRect();
    expect(rest.right).toBeLessThanOrEqual(phone.getBoundingClientRect().right + 0.5);
    expect(phone.scrollWidth).toBeLessThanOrEqual(phone.clientWidth);
    const banner = page.getByRole('banner').element() as HTMLElement;
    expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
  });

  it("the ruler's goal flag reads the target at the target", async () => {
    const target = dayFromUtc(2060, 6, 1);
    await opened({ game: gameWith({ phase: 'runs', round: 1, target }) }, LONG);
    const flag = page.getByTestId('tl-goal-flag');
    await expect.element(flag).toHaveTextContent('Target Jun 2060');
  });
});

describe('TimelineMode in a game: one screen, the simulation tool', () => {
  const mode = () => page.getByTestId('tl-mode').element();
  const mapBox = () => page.getByTestId('tl-map-box').element();

  it("gameWith's id is fixed and valid", () => {
    expect(isValidId(GAME_ID)).toBe(true);
    expect(gameWith().currentId).toBe(GAME_ID);
  });

  for (const round of [0, 1]) {
    it(`a game in round ${round} mounts the tool at once: dock, Playhead, chart, speeds`, async () => {
      await opened({ game: gameWith({ phase: 'runs', round }) }, LONG);
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
    await opened({ game: gameWith({ phase: 'runs' }) }, LONG);
    await expect.element(page.getByTestId('tl-play')).toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(debug().playing).toBe(false);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(true);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(false);
  });

  it('a moveend asks for the viewport in a game', async () => {
    await opened({ game: gameWith({ phase: 'runs' }) }, LONG);
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
