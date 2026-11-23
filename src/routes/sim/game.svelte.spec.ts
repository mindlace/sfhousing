/// <reference types="@vitest/browser-playwright" />
// /sim in a game (spec #sec-design-game, -playable, -locks, -given, -levelup, -locked-page,
// #sec-tests-component): the page rendered through SimRoute under a provided GameStore, the store
// and the page's autosave on one memory storage. The real SimPage and TimelineMode run over a fake
// timeline worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import type { AfterNavigate } from '@sveltejs/kit';
import '../layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { formatShortMonthYear } from '$lib/fzp/format';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { openGame, type GameStore } from '$lib/game/store.svelte';
import { GOAL_BASE, defaultGoal } from '$lib/goal/goal';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { dateMeasure } from '$lib/sim-page/funding-presets';
import { fundingCalibration } from '$lib/sim-page/test/funding';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { addPolicy } from '$lib/timeline/add';
import { GO_TO_PAINT, lockedSim, winTitle } from '$lib/timeline/game-copy';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { SIM_KEY4, parseSimDoc4, serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import {
  compiledMsg,
  errorMsg,
  filledMsg,
  type FakeTimelineWorker
} from '$lib/timeline/test/fake-timeline-worker';
import { statics as baseStatics } from '$lib/timeline/test/fixtures';
import { gameAt } from '$lib/timeline/test/game';
import { PLUS_NAME } from '$lib/timeline/test/plus';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import GameSimHost from './test/GameSimHost.svelte';

const workers = vi.hoisted(() => [] as FakeTimelineWorker[]);

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/sim/client', async (orig) => {
  const { FakeTimelineWorker } = await import('$lib/timeline/test/fake-timeline-worker');
  return {
    ...(await orig<typeof import('$lib/sim/client')>()),
    spawnSimWorker: () => {
      const w = new FakeTimelineWorker();
      workers.push(w);
      return w;
    }
  };
});
vi.mock('$app/navigation', () => ({
  afterNavigate: (cb: (n: AfterNavigate) => void) => void cb,
  replaceState: () => {}
}));
// A passthrough spy: the page's normalize re-dates a moved given measure through it.
vi.mock('$lib/sim-page/funding-presets', async (orig) => {
  const mod = await orig<typeof import('$lib/sim-page/funding-presets')>();
  return { ...mod, dateMeasure: vi.fn(mod.dateMeasure) };
});

const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const monthsTo = (last: number): Day[] =>
  Array.from({ length: last + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const MONTHS: Day[] = monthsTo(LAST);
/** The whole window's months, so the default goal's deadline is inside it. */
const LONG: ScoreStatics = {
  ...baseStatics({ lastIndex: WINDOW_MONTHS }),
  asOf,
  months: monthsTo(WINDOW_MONTHS)
};
/** The measure at month k is 1000 + base + 3k + 1: this base meets the default goal at month 8. */
const MET_AT_8 = GOAL_BASE.amount - 1025;
const BAR = MONTHS[6];
const fmt = formatShortMonthYear;

const w = () => workers[workers.length - 1];
const debug = () => window.__sfhFzp!;

function data(calibration = cal) {
  return {
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    user: null,
    signInAvailable: true,
    manifest: parseManifest(manifestJson),
    manifestError: false,
    calibration,
    calibrationError: false,
    noScenario: false
  };
}

const EMPTY: SimPolicy4 = { schema: 4, kinds: { zoning: [], permitting: [], money: [] } };
const historic: Policy = {
  id: 'historic',
  label: 'Protect historic buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'historic' },
  spans: [{ from: monthFirstDay(asOf, 2), to: null, what: { tag: 'protect', years: null } }]
};
const ctx = { w: { asOf, months: WINDOW_MONTHS }, month: 2, cal };
const clock = addPolicy(EMPTY, { kind: 'permitting', what: 'preset', preset: 'sb423Clock' }, ctx)
  .doc.kinds.permitting[0];

const doc4 = (policy: SimPolicy4): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy
});
/** Writes `policy` under the policy record key. */
function store(mem: Storage, policy: SimPolicy4): void {
  mem.setItem(
    SIM_KEY4,
    JSON.stringify({
      v: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      plan: serializeSimDoc4(doc4(policy))
    })
  );
}
const storedPolicy = (mem: Storage): SimPolicy4 =>
  (JSON.parse(JSON.parse(mem.getItem(SIM_KEY4)!).plan) as SimDoc4).policy;

function mount(game: GameStore, storage: Storage, calibration = cal) {
  return render(GameSimHost, { props: { data: data(calibration), game, storage } });
}

/** Mounted, opened, compiled and filled through month LAST at rev 1. */
async function opened(
  game: GameStore,
  storage: Storage,
  opts: { statics?: ScoreStatics; base?: number; calibration?: Calibration } = {}
) {
  const r = mount(game, storage, opts.calibration);
  await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
  w().emit(compiledMsg(1, opts.statics ?? LONG));
  w().emit(filledMsg(1, 0, LAST + 1, opts.base === undefined ? {} : { base: opts.base }));
  return r;
}
type Calibration = ReturnType<typeof fixtureCalibration>;

const saveState = () => page.getByTestId('header-status').getByTestId('save-state');
const publish = () => page.getByTestId('publish-open');
const inspector = () => page.getByTestId('inspector');
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
const win = () => page.getByTestId('tl-win');
const none = (sel: string) => document.querySelector(sel);

/** Adds "SB 423 approval clock" from Permitting's "+". */
async function addClock() {
  await page.getByRole('button', { name: PLUS_NAME.Permitting }).click();
  await inspector().getByRole('button', { name: 'SB 423 approval clock' }).click();
}

/** The playhead by key: Home, then calendar months on to month `k`. */
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

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

async function noViolations(el: Element) {
  for (const s of ['light', 'dark'] as const) {
    await scheme(s);
    expect((await axe.run(el)).violations).toEqual([]);
  }
}

beforeEach(async () => {
  workers.length = 0;
  stub.reset();
  vi.stubEnv('VITE_E2E', '1');
  await page.viewport(1280, 900);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await scheme('light');
});

describe('/sim in a game', () => {
  it('level 1 shows the locked page', async () => {
    const mem = new MemoryStorage();
    mount(gameAt(1, { storage: mem }), mem);
    const locked = page.getByTestId('sim-locked');
    await expect.element(locked).toBeVisible();
    expect(lockedSim(GOAL_BASE.amount, GOAL_BASE.measure.unit)).toBe(
      'Paint room for 82,069 homes to unlock the simulation.'
    );
    await expect
      .element(locked.getByText('Paint room for 82,069 homes to unlock the simulation.'))
      .toBeVisible();
    await expect
      .element(locked.getByRole('link', { name: GO_TO_PAINT }))
      .toHaveAttribute('href', '/');
    expect(none('[data-testid=tl-mode]')).toBeNull();
    expect(workers.length).toBe(0);
  });

  it('level 3 publishes the playable document and stores the whole one', async () => {
    const mem = new MemoryStorage();
    const whole: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [historic], permitting: [clock], money: [] }
    };
    store(mem, whole);
    const game = gameAt(3, { bar: BAR, storage: mem });
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'AbCdEfGh' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', spy);
    await opened(game, mem);
    // The worker runs the playable document.
    expect(w().lastOf('openTimeline')!.policy.kinds.zoning).toEqual([]);
    await publish().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabelText('Title').fill('Clock');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .element(dialog.getByLabelText('Link'))
      .toHaveValue(`${location.origin}/s/AbCdEfGh`);
    const body = (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
    const parsed = parseSimDoc4(body, asOf);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.policy.kinds.zoning).toEqual([]);
    expect(parsed.value.policy.kinds.permitting.map((p) => p.id)).toEqual([clock.id]);
    expect(storedPolicy(mem).kinds.zoning.map((p) => p.id)).toEqual(['historic']);
    expect(storedPolicy(mem).kinds.permitting.map((p) => p.id)).toEqual([clock.id]);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect.element(publish()).toHaveTextContent('Share link');
  });

  it('level 3 has no brush', async () => {
    const mem = new MemoryStorage();
    await opened(gameAt(3, { bar: BAR, storage: mem }), mem);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('b');
    await tick();
    expect(page.getByRole('button', { name: 'Stop painting' }).elements()).toHaveLength(0);
    expect(debug().playing).toBe(false);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(true);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(false);

    await page.viewport(375, 700);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('b');
    await tick();
    expect(page.getByTestId('palette-strip').elements()).toHaveLength(0);
  });

  it('Ctrl+Z works with zoning locked', async () => {
    const mem = new MemoryStorage();
    await opened(gameAt(3, { bar: BAR, storage: mem }), mem);
    await addClock();
    await expect.poll(() => debug().policy.kinds.permitting).toHaveLength(1);
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.poll(() => debug().policy.kinds.permitting).toEqual([]);
  });

  it('an edit the worker rejects keeps the locked policies', async () => {
    const mem = new MemoryStorage();
    store(mem, { schema: 4, kinds: { zoning: [historic], permitting: [], money: [] } });
    await opened(gameAt(3, { bar: BAR, storage: mem }), mem);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    await addClock();
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(w().lastOf('setPolicy')!.policy.kinds.zoning).toEqual([]);
    w().emit(errorMsg(2, 'bad-request'));
    await expect.poll(() => debug().policy.kinds.permitting).toEqual([]);
    expect(debug().policy.kinds.zoning.map((p) => p.id)).toEqual(['historic']);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    expect(storedPolicy(mem).kinds.zoning.map((p) => p.id)).toEqual(['historic']);
    expect(storedPolicy(mem).kinds.permitting).toEqual([]);
  });

  it('an autosave write touches the game once', async () => {
    const mem = new MemoryStorage();
    const game = gameAt(3, { bar: BAR, storage: mem });
    await opened(game, mem);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    const touched = vi.spyOn(game, 'touched');
    await addClock();
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saving');
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    await tick();
    expect(touched).toHaveBeenCalledTimes(1);
    expect(storedPolicy(mem).kinds.permitting.map((p) => p.label)).toEqual([clock.label]);
  });

  it('an edit undone inside the debounce touches the game once', async () => {
    const mem = new MemoryStorage();
    const game = gameAt(3, { bar: BAR, storage: mem });
    await opened(game, mem);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    const before = mem.getItem(SIM_KEY4);
    const touched = vi.spyOn(game, 'touched');
    await addClock();
    expect(saveState().element().getAttribute('data-save-status')).toBe('saving');
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    await tick();
    expect(touched).toHaveBeenCalledTimes(1);
    expect(mem.getItem(SIM_KEY4)).toBe(before);
  });

  it("an edit then at once New game lands in the old game's save", async () => {
    const mem = new MemoryStorage();
    const game = gameAt(3, { bar: BAR, storage: mem });
    const r = await opened(game, mem);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    const oldId = game.currentId;
    await addClock();
    expect(game.newGame()).toEqual({ ok: true });
    const fresh = game.read(game.currentId);
    expect(fresh).not.toBeNull();
    const old = game.read(oldId)!;
    const rec = JSON.parse(old.policy!) as { plan: string };
    const policy = (JSON.parse(rec.plan) as SimDoc4).policy;
    expect(policy.kinds.permitting.map((p) => p.label)).toEqual([clock.label]);
    await tick();
    r.unmount();
    expect(mem.getItem(SIM_KEY4)).toBeNull();
    // The flush's write touches like any write; after an `ok` change the store ignores it.
    expect(game.read(game.currentId)).toEqual(fresh);
  });

  it('the page registers one flush and removes it on unmount', async () => {
    const mem = new MemoryStorage();
    const game = gameAt(3, { bar: BAR, storage: mem });
    const real = game.beforeLeave.bind(game);
    let remover: ReturnType<typeof vi.fn> | null = null;
    const leave = vi.spyOn(game, 'beforeLeave').mockImplementation((fn) => {
      const off = real(fn);
      remover = vi.fn(off);
      return remover as unknown as () => void;
    });
    const r = await opened(game, mem);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leave.mock.calls[0][0]).toBeTypeOf('function');
    r.unmount();
    expect(remover).not.toBeNull();
    expect(remover!).toHaveBeenCalledTimes(1);

    const open = openGame();
    const none = vi.spyOn(open, 'beforeLeave');
    const r2 = await opened(open, new MemoryStorage());
    r2.unmount();
    expect(none).not.toHaveBeenCalled();
  });

  it('a moved given measure is re-dated once, Undo does not re-date', async () => {
    const fcal = fundingCalibration();
    const made = addPolicy(
      EMPTY,
      { kind: 'money', what: 'preset', preset: 'housing-bond' },
      { w: { asOf: fcal.asOf, months: WINDOW_MONTHS }, month: 13, cal: fcal }
    );
    const mem = new MemoryStorage();
    store(mem, made.doc);
    const game = gameAt(5, { bar: BAR, storage: mem });
    await opened(game, mem, { calibration: fcal });
    await page
      .getByTestId('tl-kind-money')
      .getByRole('button', { name: /^Public money/ })
      .click();
    const bar = page.getByTestId('tl-kind-money').getByTestId('tl-bar').first();
    await expect.element(bar).toBeVisible();
    const spy = vi.mocked(dateMeasure);
    spy.mockClear();
    const from = () => debug().policy.kinds.money[0].spans[0].from;
    const was = from();
    (bar.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(from).not.toBe(was);
    expect(spy).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.poll(from).toBe(was);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('the open game shows no game part', async () => {
    const game = openGame();
    await opened(game, new MemoryStorage(), { base: MET_AT_8 });
    expect(none('[data-testid=sim-locked]')).toBeNull();
    for (const kind of ['Zoning', 'Permitting', 'Public money'] as const) {
      await expect.element(page.getByRole('button', { name: PLUS_NAME[kind] })).toBeVisible();
    }
    await keysTo(8);
    const deadline = defaultGoal(asOf).deadline;
    await expect
      .element(page.getByTestId('tl-goal-notice'))
      .toHaveTextContent(`Goal reached in ${fmt(MONTHS[8])}, by the ${fmt(deadline)} deadline.`);
    expect(game.offer).toBeNull();
    expect(none('[data-testid=tl-locked-lane]')).toBeNull();
    expect(none('[data-locked]')).toBeNull();
    expect(none('[data-testid=tl-win]')).toBeNull();
  });

  it('a level up opens the new kind and says so', async () => {
    const mem = new MemoryStorage();
    const game = gameAt(2, { storage: mem });
    await opened(game, mem, { base: MET_AT_8 });
    const toggle = () =>
      document.querySelector('[data-testid="tl-kind-permitting"] button.toggle')!;
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await keysTo(8);
    await expect.element(win()).toHaveTextContent(winTitle(MONTHS[8]));
    await win().getByRole('button', { name: 'Level up' }).click();
    await expect.poll(() => game.progress.level).toBe(3);
    await tick();
    await expect.poll(() => toggle().getAttribute('aria-expanded')).toBe('true');
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Level 3. Permitting unlocked.' }))
      .toBeInTheDocument();
  });

  it('a level that falls (a new game) announces nothing', async () => {
    const mem = new MemoryStorage();
    const game = gameAt(3, { bar: BAR, storage: mem });
    await opened(game, mem);
    expect(game.newGame()).toEqual({ ok: true });
    game.setOffer({ on: null, datasetVersion: 'fixture-0' });
    game.levelUp();
    expect(game.progress.level).toBe(2);
    await tick();
    await tick();
    expect(
      page
        .getByRole('status')
        .filter({ hasText: /Level \d/ })
        .elements()
    ).toHaveLength(0);
  });

  it('new controls pass axe in light and dark', async () => {
    const mem = new MemoryStorage();
    const locked = mount(gameAt(1, { storage: mem }), mem);
    await expect.element(page.getByTestId('sim-locked')).toBeVisible();
    const link = page.getByRole('link', { name: GO_TO_PAINT }).element().getBoundingClientRect();
    expect(Math.min(link.width, link.height)).toBeGreaterThanOrEqual(24);
    await noViolations(page.getByTestId('sim-locked').element());
    (await locked).unmount();

    const mem2 = new MemoryStorage();
    store(mem2, { schema: 4, kinds: { zoning: [historic], permitting: [], money: [] } });
    const r = await opened(gameAt(2, { storage: mem2 }), mem2, { base: MET_AT_8 });
    const timeline = page.getByTestId('tl-timeline');
    await expect.element(timeline).toBeVisible();
    await noViolations(timeline.element());
    await page
      .getByTestId('tl-kind-zoning')
      .getByRole('button', { name: /^Zoning/ })
      .click();
    await expect
      .element(
        page.getByTestId('tl-kind-zoning').getByText('Protect historic buildings', { exact: true })
      )
      .toBeVisible();
    await noViolations(timeline.element());

    await keysTo(8);
    await expect.element(win()).toBeVisible();
    await noViolations(win().element());
    r.unmount();
  });
});
