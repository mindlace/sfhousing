/// <reference types="@vitest/browser-playwright" />
// SimRoute's edit page in a game (game-sim #sec-design-limits, -publish, -route, -removed,
// #sec-files-new): the page rendered through SimRoute under a provided GameStore, the store and
// the page's autosave on one memory storage. The real SimPage and TimelineMode run over a fake
// timeline worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import type { AfterNavigate } from '@sveltejs/kit';
import axe from 'axe-core';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { LIMITS_LAYER_ID } from '$lib/map/height/limits-layer';
import { LID_MAX_SPAN_M } from '$lib/map/height/lids';
import { tinyLimits } from '$lib/map/height/test/fixtures';
import { clampBbox } from '$lib/sim-page/lid-request';
import { E2E_GOAL_KEY } from '$lib/game/e2e';
import { isFixed } from '$lib/game/limits';
import { offerThrough } from '$lib/game/offer';
import { openGame, type GameStore } from '$lib/game/store.svelte';
import { stubTouchLaptop } from '$lib/paint/test/pointer-stub';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { dateMeasure } from '$lib/sim-page/funding-presets';
import { fundingCalibration } from '$lib/sim-page/test/funding';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { GameState } from '$lib/game/state';
import type { Day } from '$lib/timelapse/time';
import { addPolicy } from '$lib/timeline/add';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { SIM_KEY4, parseSimDoc4, serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import {
  compiledMsg,
  errorMsg,
  filledMsg,
  refillMsg,
  type FakeTimelineWorker
} from '$lib/timeline/test/fake-timeline-worker';
import { statics as baseStatics } from '$lib/timeline/test/fixtures';
import { gameWith } from '$lib/timeline/test/game';
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

type Calibration = ReturnType<typeof fixtureCalibration>;

const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const monthsTo = (last: number): Day[] =>
  Array.from({ length: last + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
/** The whole window's months, so the default goal's deadline is inside it. */
const LONG: ScoreStatics = {
  ...baseStatics({ lastIndex: WINDOW_MONTHS }),
  asOf,
  months: monthsTo(WINDOW_MONTHS)
};

const w = () => workers[workers.length - 1];
const debug = () => window.__sfhFzp!;

function data(calibration: Calibration = cal) {
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
const ctx = { w: { asOf, months: WINDOW_MONTHS }, month: 2, cal };
const clock = addPolicy(EMPTY, { kind: 'permitting', what: 'preset', preset: 'sb423Clock' }, ctx)
  .doc.kinds.permitting[0];
const historic: Policy = {
  id: 'historic',
  label: 'Protect historic buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'historic' },
  spans: [{ from: monthFirstDay(asOf, 2), to: null, what: { tag: 'protect', years: null } }]
};

/**
 * A finished game at round 0: every lever but painted zoning (Permitting's "+" offers the SB 423
 * clock), and no catalogue policy added on load, so each test reads its document as stored.
 */
const inRuns = (mem: Storage) => gameWith({ phase: 'runs', finished: true }, { storage: mem });

/** The page is the simulation tool: the bottom pane is up. */
async function inTool() {
  await expect.element(page.getByTestId('tl-dock')).toBeVisible();
}

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
const storedDoc = (mem: Storage): SimDoc4 =>
  JSON.parse(JSON.parse(mem.getItem(SIM_KEY4)!).plan) as SimDoc4;
const storedPolicy = (mem: Storage): SimPolicy4 => storedDoc(mem).policy;

function mount(game: GameStore, storage: Storage, calibration = cal, siteHeader = false) {
  return render(GameSimHost, { props: { data: data(calibration), game, storage, siteHeader } });
}

/** Mounted, opened, compiled and filled through month LAST at rev 1. */
async function opened(
  game: GameStore,
  storage: Storage,
  opts: { calibration?: Calibration; siteHeader?: boolean } = {}
) {
  const r = mount(game, storage, opts.calibration, opts.siteHeader);
  await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
  w().emit(compiledMsg(1, LONG));
  w().emit(filledMsg(1, 0, LAST + 1, {}));
  return r;
}

const saveState = () => page.getByTestId('header-status').getByTestId('save-state');
const publish = () => page.getByTestId('publish-open');
const inspector = () => page.getByTestId('inspector');

/** Adds "SB 423 approval clock" from Permitting's "+". */
async function addClock() {
  await page.getByRole('button', { name: PLUS_NAME.Permitting }).click();
  await inspector().getByRole('button', { name: 'SB 423 approval clock' }).click();
}

beforeEach(async () => {
  workers.length = 0;
  stub.reset();
  vi.stubEnv('VITE_E2E', '1');
  await page.viewport(1280, 900);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SimRoute in a game', () => {
  it("Publish sends runnable's document; autosave keeps the whole one", async () => {
    const mem = new MemoryStorage();
    const painted = addPolicy(EMPTY, { kind: 'zoning', what: 'paint' }, ctx).doc.kinds.zoning[0];
    // A protection (free once a stop type is offered) keeps the runnable document from being empty.
    const whole: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [painted, historic], permitting: [{ ...clock, on: false }], money: [] }
    };
    store(mem, whole);
    const game = inRuns(mem);
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'AbCdEfGh' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', spy);
    await opened(game, mem);
    // The worker runs the runnable document: no painted area, the clock as it stands.
    const run = w().lastOf('openTimeline')!.policy;
    expect(run.kinds.zoning.map((p) => p.id)).toEqual(['historic']);
    expect(run.kinds.permitting.map((p) => [p.id, p.on])).toEqual([[clock.id, false]]);

    await publish().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabelText('Title').fill('Clock');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .element(dialog.getByLabelText('Link'))
      .toHaveValue(`${location.origin}/s/AbCdEfGh`);
    expect(spy).toHaveBeenCalledTimes(1);
    const published = (): SimDoc4 => {
      const body = (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
      const parsed = parseSimDoc4(body, asOf);
      if (!parsed.ok) throw new Error('the published body did not parse');
      return parsed.value;
    };
    expect(published().policy.kinds.zoning.some((p) => p.where.tag === 'painted')).toBe(false);
    expect(published().policy.kinds.permitting[0].on).toBe(false);
    // The published title reaches the autosave, which writes the whole document.
    await expect.poll(() => storedDoc(mem).title).toBe('Clock');
    const saved = () => storedDoc(mem);
    expect(saved().policy.kinds.zoning.some((p) => p.where.tag === 'painted')).toBe(true);
    expect(saved().policy.kinds.permitting.map((p) => [p.id, p.on])).toEqual([[clock.id, false]]);
    await dialog.getByRole('button', { name: 'Done' }).click();
  });

  it('no brush in a game', async () => {
    const mem = new MemoryStorage();
    await opened(inRuns(mem), mem);
    await inTool();
    await expect.poll(() => stub.props.tapCards).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('b');
    await tick();
    expect(page.getByRole('button', { name: 'Stop painting' }).elements()).toHaveLength(0);
    expect(stub.props.tapCards).toBe(true);
    // Space plays and pauses: there is no brush to take it.
    expect(debug().playing).toBe(false);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(true);
    await userEvent.keyboard(' ');
    await expect.poll(() => debug().playing).toBe(false);

    await page.viewport(375, 700);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('b');
    await tick();
    expect(stub.props.tapCards).toBe(true);
    expect(document.querySelector('[data-testid=palette-strip]')).toBeNull();
  });

  for (const round of [0, 1]) {
    it(`a game in round ${round} lands in the simulation tool`, async () => {
      const mem = new MemoryStorage();
      await opened(gameWith({ phase: 'runs', round }, { storage: mem }), mem);
      await expect.element(page.getByTestId('tl-dock')).toBeVisible();
      await expect.element(page.getByTestId('tl-play')).toBeVisible();
      expect(document.querySelector('[data-testid=game-tree-pane]')).toBeNull();
      expect(document.querySelector('[data-testid=run-waiting]')).toBeNull();
      expect(document.querySelector('[data-testid=game-back]')).toBeNull();
      expect(page.getByTestId('tl-mode').element().hasAttribute('data-phase')).toBe(false);
      (document.activeElement as HTMLElement | null)?.blur();
      await userEvent.keyboard(' ');
      await expect.poll(() => debug().playing).toBe(true);
    });
  }

  it('in a game the document loads with every policy offered so far, off, and no undo step', async () => {
    const mem = new MemoryStorage();
    store(mem, { schema: 4, kinds: { zoning: [historic], permitting: [], money: [] } });
    await opened(gameWith({ phase: 'runs', round: 1 }, { storage: mem }), mem);
    await inTool();
    const want = offerThrough(
      { schema: 4, kinds: { zoning: [historic], permitting: [], money: [] } },
      1,
      cal
    );
    expect(want.kinds.zoning.map((p) => p.id)).toEqual(['historic', 'transit-rail']);
    await expect.poll(() => debug().policy).toEqual(want);
    expect(debug().policy.kinds.permitting.every((p) => !p.on)).toBe(true);
    expect(debug().policy.kinds.permitting.map((p) => p.label)).toEqual(['SB 423 clock']);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Control>}z{/Control}');
    await tick();
    expect(debug().policy).toEqual(want);
  });

  it('a game in the opening renders nothing', async () => {
    const storage = new MemoryStorage();
    // A first win is held, so the same game can leave its opening below.
    const game = gameWith({ firstWinAt: '2026-11-25T00:00:00.000Z' }, { storage });
    render(GameSimHost, { props: { data: data(), game, storage } });
    await tick();
    await tick();
    expect(document.getElementById('map-region')!.children).toHaveLength(0);
    expect(document.querySelector('[data-testid=sim-locked]')).toBeNull();
    expect(workers).toHaveLength(0);
    // The witness: SimRoute is past its mount gate, so the empty region above was the opening's.
    expect(game.startRuns()).toEqual({ ok: true });
    await expect
      .poll(() => document.getElementById('map-region')!.children.length)
      .toBeGreaterThan(0);
    await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
  });

  it("the open game shows today's page", async () => {
    await opened(openGame(), new MemoryStorage());
    await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
    expect(page.getByTestId('tl-mode').element().hasAttribute('data-phase')).toBe(false);
    for (const kind of ['Zoning', 'Permitting', 'Public money'] as const) {
      await expect.element(page.getByRole('button', { name: PLUS_NAME[kind] })).toBeVisible();
    }
    expect(document.querySelector('[data-testid=tl-locked-lane]')).toBeNull();
    expect(document.querySelector('[data-locked]')).toBeNull();
  });

  it("an edit the worker rejects keeps the policies the game doesn't run", async () => {
    const mem = new MemoryStorage();
    // Painted zoning never runs in a game, even a finished one.
    const painted = addPolicy(EMPTY, { kind: 'zoning', what: 'paint' }, ctx).doc.kinds.zoning[0];
    store(mem, { schema: 4, kinds: { zoning: [painted], permitting: [], money: [] } });
    await opened(inRuns(mem), mem);
    await inTool();
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    await addClock();
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(w().lastOf('setPolicy')!.policy.kinds.zoning).toEqual([]);
    w().emit(errorMsg(2, 'bad-request'));
    await expect.poll(() => debug().policy.kinds.permitting).toEqual([]);
    expect(debug().policy.kinds.zoning.map((p) => p.id)).toEqual([painted.id]);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    expect(storedPolicy(mem).kinds.zoning.map((p) => p.id)).toEqual([painted.id]);
    expect(storedPolicy(mem).kinds.permitting).toEqual([]);
  });

  it('an autosave write touches the game once', async () => {
    const mem = new MemoryStorage();
    const game = inRuns(mem);
    await opened(game, mem);
    await inTool();
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
    const game = inRuns(mem);
    await opened(game, mem);
    await inTool();
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
    const game = inRuns(mem);
    const r = await opened(game, mem);
    await inTool();
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
    const game = inRuns(mem);
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
    const game = inRuns(mem);
    await opened(game, mem, { calibration: fcal });
    await inTool();
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
});

// ---- the tool in a game: Undo and Redo, the map's view, the header's controls ----

const undoButton = () => page.getByTestId('header-actions').getByRole('button', { name: /^Undo/ });
const redoButton = () => page.getByTestId('header-actions').getByRole('button', { name: /^Redo/ });
const presets = () => debug().policy.kinds.permitting.map((p) => p.preset);
/** The page has had its map: TimelineMode's onMapReady (which ends in the page's) has run. */
const mapReady = () => expect.poll(() => callsOf('setBarMode').length).toBeGreaterThan(0);
const overlayIds = () =>
  ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
/** The map moved to `zoom` (the stub's bounds) and its `moveend` fired. */
function moveTo(zoom: number): void {
  stub.map.zoom = zoom;
  stub.map.fire('moveend');
}
async function scheme(value: 'light' | 'dark'): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}
const violations = async (el: Element) => (await axe.run(el)).violations;

describe('SimRoute in a game: the tool', () => {
  it('Undo and Redo act in a game, from the header and the keys', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    await opened(inRuns(mem), mem);
    await inTool();
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    await addClock();
    await expect.poll(presets).toEqual([clock.preset]);
    await undoButton().click();
    await expect.poll(presets).toEqual([]);
    await redoButton().click();
    await expect.poll(presets).toEqual([clock.preset]);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.poll(presets).toEqual([]);
  });

  it("a game's map view is read at each moveend: lids are asked and the limits show", async () => {
    const mem = new MemoryStorage();
    mount(gameWith({ phase: 'runs' }, { storage: mem }), mem);
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    await mapReady();
    w().emit(compiledMsg(1, LONG));
    const { city } = tinyLimits();
    w().emit({ type: 'heights', rev: 1, city: { ...city, rev: 1 } });
    stub.map.bounds = [-122.44, 37.75, -122.43, 37.76];
    moveTo(15);
    await expect.poll(() => w().all('heightLids').length).toBe(1);
    const c = stub.map.getCenter();
    expect(w().lastOf('heightLids')!.bbox).toEqual(
      clampBbox(stub.map.bounds, LID_MAX_SPAN_M, [c.lng, c.lat])
    );
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
  });

  it("the header's controls pass axe in light and dark", async () => {
    const mem = new MemoryStorage();
    await opened(inRuns(mem), mem);
    await inTool();
    try {
      for (const s of ['light', 'dark'] as const) {
        await scheme(s);
        expect(await violations(page.getByTestId('header-actions').element())).toEqual([]);
      }
    } finally {
      await scheme('light');
    }
  });
});

// ---- taking a win: the gift, the explainers, the offered policies ----

describe('SimRoute in a game: taking a win', () => {
  /** The goal month's index in LONG, and the amount the fake worker's rows reach there. */
  const K = 5;
  const GOAL = 1001 + 3 * K;
  const fcal = fundingCalibration();
  const M = LONG.months;
  const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });
  const gift = () => page.getByTestId('goal-gift');
  const dialog = () => page.getByTestId('gift-dialog');
  const accept = () => page.getByTestId('gift-accept');
  const policies = (doc: SimPolicy4): Policy[] => [
    ...doc.kinds.zoning,
    ...doc.kinds.permitting,
    ...doc.kinds.money
  ];

  /** A game in the runs at `round`; the goal is the amount the rows reach at month K. */
  function seed(mem: Storage, round: number, over: Partial<GameState> = {}): GameStore {
    mem.setItem(E2E_GOAL_KEY, String(GOAL));
    return gameWith({ phase: 'runs', round, ...over }, { storage: mem });
  }

  /** Mounted, opened, compiled and filled through the whole window at rev 1. */
  async function openedLong(game: GameStore, mem: Storage) {
    const r = mount(game, mem, fcal);
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    w().emit(compiledMsg(1, LONG));
    w().emit(filledMsg(1, 0, WINDOW_MONTHS + 1, {}));
    await expect.poll(() => debug().filledThrough).toBe(WINDOW_MONTHS);
    await inTool();
    // A game past round 0 adds the offered policies after the open: their lots are resolved and
    // that edit is answered too.
    if (game.state.round > 0) {
      let asked = 0;
      await expect
        .poll(() => {
          for (const q of w().all('resolveBrush').slice(asked)) {
            w().emit({
              type: 'brushLots',
              reqId: q.reqId,
              result: { ok: true, lots: [], points: new Float64Array() }
            });
            asked++;
          }
          return w().lastOf('setPolicy')?.rev;
        })
        .toBe(2);
      w().emit(compiledMsg(2, LONG));
      w().emit(refillMsg(2, 0));
      w().emit(filledMsg(2, 0, WINDOW_MONTHS + 1, {}));
      await expect.poll(() => debug().stale).toBe(false);
    }
    return r;
  }

  /** The playhead to month K by key: the win is seen. */
  async function seeWin() {
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(K));
    await expect.poll(() => debug().day).toBe(M[K]);
    await expect.element(gift()).toBeVisible();
  }

  async function acceptAll(n: number) {
    for (let i = 0; i < n; i++) await accept().click();
    await expect.poll(() => document.querySelector('[data-testid=gift-dialog]')).toBeNull();
  }

  it('the gift takes the win: round 1, the target, and the three policies off, before any Accept', async () => {
    const mem = new MemoryStorage();
    const game = seed(mem, 0);
    await openedLong(game, mem);
    await seeWin();
    await gift().click();
    expect(game.state.round).toBe(1);
    expect(game.state.target).toBe(M[K]);
    expect(game.state.wins).toHaveLength(1);
    await expect.element(dialog()).toBeVisible();
    const doc = debug().policy;
    expect(policies(doc).map((p) => [p.label, p.on])).toEqual([
      ['Taller near BART and Caltrain', false],
      ['SB 423 clock', false],
      ['Housing bond', false]
    ]);
    // The autosave was flushed: the policy record holds them too.
    await expect.poll(() => policies(storedPolicy(mem)).length).toBe(3);
    await expect.element(gift()).not.toBeInTheDocument();
  });

  it('the explainers: one per policy, three Accepts close it, focus on the goal, each fixed', async () => {
    const mem = new MemoryStorage();
    const game = seed(mem, 0);
    await openedLong(game, mem);
    await seeWin();
    await gift().click();
    await expect
      .element(page.getByRole('heading', { name: 'Taller near BART and Caltrain' }))
      .toBeVisible();
    await expect.element(page.getByTestId('gift-step')).toHaveTextContent('1 of 3');
    await expect.element(accept()).toHaveTextContent('Accept');
    await accept().click();
    await expect.element(page.getByRole('heading', { name: 'SB 423 clock' })).toBeVisible();
    await accept().click();
    await expect.element(page.getByRole('heading', { name: 'Housing bond' })).toBeVisible();
    await expect.element(page.getByTestId('gift-step')).toHaveTextContent('3 of 3');
    await accept().click();
    await expect.poll(() => document.querySelector('[data-testid=gift-dialog]')).toBeNull();
    await expect.element(page.getByTestId('goal-headline-button')).toHaveFocus();
    const doc = debug().policy;
    expect(policies(doc)).toHaveLength(3);
    for (const p of policies(doc)) expect(isFixed(p, game.limits)).toBe(true);
    expect(page.getByTestId('goal-headline').element().getAttribute('data-state')).toBe('pending');
  });

  it('after the gift Undo is not possible; switching a rule on then Undo and Redo keeps the policies and the game', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    const game = seed(mem, 0);
    await openedLong(game, mem);
    await seeWin();
    await gift().click();
    await acceptAll(3);
    await expect.element(undoButton()).toBeDisabled();
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Control>}z{/Control}');
    await tick();
    expect(policies(debug().policy)).toHaveLength(3);
    const before = structuredClone($state.snapshot(game.state));

    await page
      .getByTestId('tl-kind-zoning')
      .getByRole('button', { name: /^Zoning/ })
      .click();
    await page.getByTestId('tl-kind-zoning').getByTestId('tl-bar').first().click();
    const on = inspector().getByRole('switch', { name: 'On' });
    await expect.element(on).toHaveAttribute('aria-checked', 'false');
    await on.click();
    const rail = () => debug().policy.kinds.zoning.find((p) => p.id === 'transit-rail')!;
    await expect.poll(() => rail().on).toBe(true);
    await expect.element(undoButton()).toBeEnabled();
    await undoButton().click();
    await expect.poll(() => rail().on).toBe(false);
    expect(policies(debug().policy)).toHaveLength(3);
    await redoButton().click();
    await expect.poll(() => rail().on).toBe(true);
    expect(policies(debug().policy)).toHaveLength(3);
    expect($state.snapshot(game.state)).toEqual(before);
  });

  it('in round 1 with the rail rule on, the gift makes it editable; the rest stay fixed', async () => {
    const mem = new MemoryStorage();
    const seeded = offerThrough(EMPTY, 1, fcal);
    store(mem, {
      ...seeded,
      kinds: {
        ...seeded.kinds,
        zoning: seeded.kinds.zoning.map((p) => ({ ...p, on: true }))
      }
    });
    const game = seed(mem, 1, { target: M[K + 6] });
    await openedLong(game, mem);
    const railOf = () => debug().policy.kinds.zoning.find((p) => p.id === 'transit-rail')!;
    expect(railOf().on).toBe(true);
    expect(isFixed(railOf(), game.limits)).toBe(true);
    await seeWin();
    await gift().click();
    await expect.element(dialog()).toBeVisible();
    expect(game.state.round).toBe(2);
    expect(game.state.editable).toEqual(['transit-rail']);
    await acceptAll(3);
    expect(isFixed(railOf(), game.limits)).toBe(false);
    const rest = policies(debug().policy).filter((p) => p.id !== 'transit-rail');
    // Round 1's other two, and the three of round 2 just offered.
    expect(rest).toHaveLength(5);
    for (const p of rest) expect(isFixed(p, game.limits)).toBe(true);
    expect(rest.filter((p) => p.on)).toEqual([]);
  });

  it('a refused store write changes nothing and the win stands', async () => {
    const mem = new MemoryStorage();
    const game = seed(mem, 0);
    await openedLong(game, mem);
    await seeWin();
    const before = structuredClone($state.snapshot(game.state));
    const doc = debug().policy;
    const refuse = vi.spyOn(game, 'takeWin').mockReturnValue({ ok: false, reason: 'storage' });
    await gift().click();
    expect(refuse).toHaveBeenCalledTimes(1);
    expect($state.snapshot(game.state)).toEqual(before);
    expect(debug().policy).toEqual(doc);
    expect(document.querySelector('[data-testid=gift-dialog]')).toBeNull();
    await expect.element(gift()).toBeVisible();
    expect(page.getByTestId('goal-headline').element().getAttribute('data-state')).toBe('win');
    // The win is still takeable once the store accepts it.
    refuse.mockRestore();
    await gift().click();
    expect(game.state.round).toBe(1);
  });

  it('a win in a finished game opens no dialog and leaves focus where it was', async () => {
    const mem = new MemoryStorage();
    const game = seed(mem, 4, { finished: true, target: M[K + 6] });
    await openedLong(game, mem);
    await seeWin();
    const focused = gift().element();
    focused.focus();
    await gift().click();
    expect(game.state.finished).toBe(true);
    expect(game.state.target).toBe(M[K]);
    expect(document.querySelector('[data-testid=gift-dialog]')).toBeNull();
  });
});
