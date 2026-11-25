/// <reference types="@vitest/browser-playwright" />
// SimRoute's edit page in a game (game-sim #sec-design-limits, -publish, -route, -removed,
// #sec-files-new): the page rendered through SimRoute under a provided GameStore, the store and
// the page's autosave on one memory storage. The real SimPage and TimelineMode run over a fake
// timeline worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { AfterNavigate } from '@sveltejs/kit';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { NODES } from '$lib/game/catalogue/nodes';
import { RUNGS } from '$lib/game/ladder';
import type { MetRung } from '$lib/game/state';
import { openGame, type GameStore } from '$lib/game/store.svelte';
import type { TreeNode } from '$lib/game/tree';
import { editName, endingReached, endingState, switchName } from '$lib/game/ui/words';
import { historyName } from '$lib/paint/history';
import { stubTouchLaptop } from '$lib/paint/test/pointer-stub';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { BUTTON_PRIMARY } from '$lib/shell/ui';
import { DRAFT_DISCARDED } from '$lib/sim-page/funding-copy';
import type { FundingDrafts } from '$lib/sim-page/funding-drafts.svelte';
import { newOwnPool } from '$lib/sim-page/funding-edit';
import { dateMeasure } from '$lib/sim-page/funding-presets';
import { RHNA_DEADLINE } from '$lib/sim/scenario/score';
import { BACK_TO_TREE, boughtLabel, restoredLabel } from '$lib/timeline/game-copy';
import { fundingCalibration } from '$lib/sim-page/test/funding';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { addPolicy } from '$lib/timeline/add';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { SIM_KEY4, parseSimDoc4, serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import {
  compiledMsg,
  errorMsg,
  filledMsg,
  type FakeTimelineWorker
} from '$lib/timeline/test/fake-timeline-worker';
import { statics as baseStatics } from '$lib/timeline/test/fixtures';
import { gameWith } from '$lib/timeline/test/game';
import { PLUS_NAME } from '$lib/timeline/test/plus';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import GameSimHost from './test/GameSimHost.svelte';

const workers = vi.hoisted(() => [] as FakeTimelineWorker[]);
/** Each FundingDrafts the page made: a draft cannot be opened from the UI in a game. */
const madeDrafts = vi.hoisted(() => [] as FundingDrafts[]);

vi.mock('$lib/sim-page/funding-drafts.svelte', async (orig) => {
  const mod = await orig<typeof import('$lib/sim-page/funding-drafts.svelte')>();
  class Recorded extends mod.FundingDrafts {
    constructor() {
      super();
      madeDrafts.push(this);
    }
  }
  return { ...mod, FundingDrafts: Recorded };
});

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

/** A Hands node: Edit on it enters the workshop with nothing selected and no change. */
const HANDS = NODES.find((n) => n.branch === 'hands' && n.after.length === 0)!;

/**
 * A game in its runs with `bought` (default the SB 423 clock: Permitting's "+" offers it), and
 * `HANDS`, so `toWorkshop` reaches the workshop without changing the document.
 */
const inRuns = (mem: Storage, bought: Record<string, number> = { 'sb423-clock': 1 }) =>
  gameWith({ phase: 'runs', runs: 1, bought: { ...bought, [HANDS.id]: 1 } }, { storage: mem });

const phaseNow = () => page.getByTestId('tl-mode').element().getAttribute('data-phase');

/** From the tree (where a game with a settled run lands), Edit on `HANDS`: the workshop. */
async function toWorkshop() {
  await page.getByRole('button', { name: editName(HANDS.label), exact: true }).click();
  await expect.element(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'workshop');
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

function mount(game: GameStore, storage: Storage, calibration = cal) {
  return render(GameSimHost, { props: { data: data(calibration), game, storage } });
}

/** Mounted, opened, compiled and filled through month LAST at rev 1. */
async function opened(game: GameStore, storage: Storage, opts: { calibration?: Calibration } = {}) {
  const r = mount(game, storage, opts.calibration);
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
  madeDrafts.length = 0;
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
    // A protection (free once a stop type is bought) keeps the runnable document from being empty.
    const whole: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [painted, historic], permitting: [{ ...clock, on: false }], money: [] }
    };
    store(mem, whole);
    const game = inRuns(mem, { 'sb423-clock': 1, 'stop-rail': 1 });
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'AbCdEfGh' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', spy);
    await opened(game, mem);
    // The worker runs the runnable document: no painted area, the bought clock as it stands.
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
    await toWorkshop();
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
    await expect.element(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'starting');
  });

  it("the open game shows today's page", async () => {
    await opened(openGame(), new MemoryStorage());
    await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
    const phases = [...document.querySelectorAll('[data-phase]')].map((e) =>
      e.getAttribute('data-phase')
    );
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.every((p) => p === 'none')).toBe(true);
    for (const kind of ['Zoning', 'Permitting', 'Public money'] as const) {
      await expect.element(page.getByRole('button', { name: PLUS_NAME[kind] })).toBeVisible();
    }
    expect(document.querySelector('[data-testid=tl-locked-lane]')).toBeNull();
    expect(document.querySelector('[data-locked]')).toBeNull();
  });

  it("an edit the worker rejects keeps the policies the game doesn't run", async () => {
    const mem = new MemoryStorage();
    store(mem, { schema: 4, kinds: { zoning: [historic], permitting: [], money: [] } });
    await opened(inRuns(mem), mem);
    await toWorkshop();
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
    const game = inRuns(mem);
    await opened(game, mem);
    await toWorkshop();
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
    await toWorkshop();
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
    await toWorkshop();
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
    const game = inRuns(mem, { 'housing-bond': 1 });
    await opened(game, mem, { calibration: fcal });
    await toWorkshop();
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

// ---- the tree: buying, Edit, switching, Back (game-sim #sec-design-buy, -workshop, -switch) ----

/** A game with a settled run (it lands in the tree) and units enough for any ring-0 node. */
const rich = (mem: Storage, bought: Record<string, number> = {}) =>
  gameWith({ phase: 'runs', runs: 1, units: { home: 1_000_000 }, bought }, { storage: mem });

const undoButton = () => page.getByTestId('header-actions').getByRole('button', { name: /^Undo/ });
const treeNode = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid=tree-node][data-node="${CSS.escape(id)}"]`);
/** The node's own switch (not a child node's). */
const nodeSwitch = (id: string) =>
  treeNode(id)?.querySelector<HTMLElement>(':scope > div > [data-testid=tree-node-on]') ?? null;
const presets = () => debug().policy.kinds.permitting.map((p) => p.preset);

/** The first tree-node in the tree whose data-state is `state`, as its catalogue node. */
async function firstNode(state: 'ready' | 'short'): Promise<TreeNode> {
  await expect.element(page.getByTestId('tree')).toBeVisible();
  const el = document.querySelector<HTMLElement>(`[data-testid=tree-node][data-state=${state}]`);
  expect(el).not.toBeNull();
  const node = NODES.find((n) => n.id === el!.dataset.node);
  expect(node).toBeDefined();
  return node!;
}

/** The preset a permitting node's first level grants. */
function presetOf(node: TreeNode): string {
  const g = node.levels[0].grant;
  if (g.tag !== 'preset') throw new Error(`${node.id} grants no preset`);
  return g.preset;
}

/** Opens the node's detail and presses its Buy (as a DOM click: a short Buy is aria-disabled). */
async function pressBuy(node: TreeNode): Promise<void> {
  await page.getByRole('button', { name: node.label, exact: true }).click();
  await expect.element(page.getByTestId('tree-buy')).toBeInTheDocument();
  page
    .getByTestId('tree-buy')
    .element()
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await tick();
}

/** Mounted in the tree, then the first ready node (a permitting one) bought. */
async function bought(mem: Storage, game: GameStore): Promise<TreeNode> {
  await opened(game, mem);
  await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
  const node = await firstNode('ready');
  expect(node.branch).toBe('permitting');
  expect(presets()).toEqual([]);
  await pressBuy(node);
  return node;
}

describe('SimRoute in a game: the tree', () => {
  it('a buy applies the grant as one undo step named by boughtLabel and writes the document at once', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    const game = rich(mem);
    const node = await bought(mem, game);
    // Read at once: inside the autosave's 500 ms debounce, so only the buy's own write can be it.
    const stored = storedPolicy(mem).kinds.permitting.map((p) => p.preset);
    expect(stored).toEqual([presetOf(node)]);
    expect(game.state.bought[node.id]).toBe(1);
    expect(presets()).toEqual([presetOf(node)]);
    expect(storedDoc(mem).policy).toEqual(debug().policy);
    await expect
      .element(undoButton())
      .toHaveAccessibleName(historyName('undo', boughtLabel(node, 1)));
    // Said in the page's status (the tree's own live region says it in its words).
    await expect.element(page.getByText(boughtLabel(node, 1), { exact: true })).toBeInTheDocument();
    // One step: a single Undo leaves nothing more to undo.
    await undoButton().click();
    await expect.poll(presets).toEqual([]);
    await expect.element(undoButton()).toBeDisabled();
  });

  it('a refused buy changes neither', async () => {
    const mem = new MemoryStorage();
    const game = gameWith({ phase: 'runs', runs: 1, units: { home: 0 } }, { storage: mem });
    await opened(game, mem);
    await expect.element(saveState()).toHaveAttribute('data-save-status', 'saved');
    const node = await firstNode('short');
    const policy = debug().policy;
    const record = mem.getItem(SIM_KEY4);
    await pressBuy(node);
    await tick();
    expect(game.state.bought).toEqual({});
    expect(game.state.units).toEqual({ home: 0 });
    expect(debug().policy).toBe(policy);
    expect(mem.getItem(SIM_KEY4)).toBe(record);
    expect(saveState().element().getAttribute('data-save-status')).toBe('saved');
    expect(page.getByText(boughtLabel(node, 1), { exact: true }).elements()).toHaveLength(0);
    expect(page.getByTestId('tree-live').element().textContent).toBe('');
  });

  it('Undo after a buy removes the policy and leaves the node bought', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    const game = rich(mem);
    const node = await bought(mem, game);
    const units = game.state.units;
    expect(presets()).toEqual([presetOf(node)]);
    await undoButton().click();
    await expect.poll(presets).toEqual([]);
    expect(game.state.bought[node.id]).toBe(1);
    expect(game.state.units).toEqual(units);
    expect(treeNode(node.id)?.dataset.level).toBe('1');
    await expect.poll(() => storedPolicy(mem).kinds.permitting).toEqual([]);
    expect(game.state.bought[node.id]).toBe(1);
  });

  it('Edit re-adds a removed policy, enters workshop and selects it', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    const game = rich(mem);
    const node = await bought(mem, game);
    await undoButton().click();
    await expect.poll(presets).toEqual([]);
    expect(phaseNow()).toBe('tree');
    await page.getByRole('button', { name: editName(node.label), exact: true }).click();
    await expect.element(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'workshop');
    expect(presets()).toEqual([presetOf(node)]);
    const policy = debug().policy.kinds.permitting[0];
    await expect
      .element(inspector().getByRole('heading', { level: 2 }))
      .toHaveTextContent(policy.label);
    await expect
      .element(undoButton())
      .toHaveAccessibleName(historyName('undo', restoredLabel(node)));
    expect(game.state.bought[node.id]).toBe(1);
  });

  it('the tree\'s switch switches its policy as one undo step "Switched off: {label}"; the Inspector\'s switch still works', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    const game = rich(mem);
    const node = await bought(mem, game);
    const sw = page.getByRole('switch', { name: switchName(node.label), exact: true });
    await expect.element(sw).toHaveAttribute('aria-checked', 'true');
    const on = () => debug().policy.kinds.permitting[0].on;
    expect(on()).toBe(true);

    await sw.click();
    await expect.poll(on).toBe(false);
    await expect
      .element(undoButton())
      .toHaveAccessibleName(historyName('undo', `Switched off: ${node.label}`));
    await expect.element(sw).toHaveAttribute('aria-checked', 'false');
    expect(treeNode(node.id)?.dataset.on).toBe('false');
    await expect
      .element(page.getByText(`Switched off: ${node.label}`, { exact: true }))
      .toBeInTheDocument();
    expect(game.state.bought[node.id]).toBe(1);
    // One step: Undo turns it back on and names the buy again.
    await undoButton().click();
    await expect.poll(on).toBe(true);
    await expect
      .element(undoButton())
      .toHaveAccessibleName(historyName('undo', boughtLabel(node, 1)));

    // Off again; Edit leaves it off, and the Inspector's switch turns it on.
    await sw.click();
    await expect.poll(on).toBe(false);
    await page.getByRole('button', { name: editName(node.label), exact: true }).click();
    await expect.element(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'workshop');
    expect(on()).toBe(false);
    const label = debug().policy.kinds.permitting[0].label;
    const inspectorSwitch = inspector().getByRole('switch', { name: 'On', exact: true });
    await expect.element(inspectorSwitch).toHaveAttribute('aria-checked', 'false');
    await inspectorSwitch.click();
    await expect.poll(on).toBe(true);
    await expect
      .element(undoButton())
      .toHaveAccessibleName(historyName('undo', `Switched on: ${label}`));
  });

  it('on has no entry for a node whose policy was removed', async () => {
    stubTouchLaptop();
    const mem = new MemoryStorage();
    const game = rich(mem);
    const node = await bought(mem, game);
    await expect.poll(() => nodeSwitch(node.id)).not.toBeNull();
    expect(treeNode(node.id)?.dataset.on).toBe('true');
    await undoButton().click();
    await expect.poll(presets).toEqual([]);
    await expect.poll(() => nodeSwitch(node.id)).toBeNull();
    expect(treeNode(node.id)?.dataset.on).toBeUndefined();
    expect(treeNode(node.id)?.dataset.level).toBe('1');
  });

  it("ending is set once the last rung is met and Publish from the tree opens the header's dialog", async () => {
    // One rung short: no ending.
    const short = new MemoryStorage();
    const metRung = (rung: number): MetRung => ({
      rung,
      reachedOn: asOf + 30 * (rung + 1),
      datasetVersion: 'fixture-0',
      at: '2026-11-25T00:00:00.000Z'
    });
    const allMet = Array.from({ length: RUNGS }, (_, r) => metRung(r));
    const r1 = await opened(
      gameWith(
        { phase: 'runs', runs: RUNGS, rung: RUNGS - 1, met: allMet.slice(0, RUNGS - 1) },
        { storage: short }
      ),
      short
    );
    await expect.element(page.getByTestId('tree')).toBeVisible();
    expect(page.getByTestId('tree-ending').elements()).toHaveLength(0);
    r1.unmount();

    const mem = new MemoryStorage();
    // Something to publish: Publish refuses an empty document.
    store(mem, { schema: 4, kinds: { zoning: [historic], permitting: [], money: [] } });
    await opened(
      gameWith({ phase: 'runs', runs: RUNGS, rung: RUNGS - 1, met: allMet }, { storage: mem }),
      mem
    );
    const ending = page.getByTestId('tree-ending');
    await expect.element(ending).toBeVisible();
    await expect.element(ending).toHaveTextContent(endingReached(allMet[RUNGS - 1].reachedOn));
    await expect.element(ending).toHaveTextContent(endingState(RHNA_DEADLINE));
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await page.getByTestId('tree-publish').click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await expect.element(page.getByRole('dialog').getByLabelText('Title')).toBeInTheDocument();
  });

  it('Back to the tree discards a draft, clears the selection and returns', async () => {
    const mem = new MemoryStorage();
    const game = rich(mem, { [HANDS.id]: 1 });
    const node = await bought(mem, game);
    expect(page.getByTestId('game-back').elements()).toHaveLength(0);
    await page.getByRole('button', { name: editName(node.label), exact: true }).click();
    await expect.element(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'workshop');
    await expect.element(inspector().getByRole('heading', { level: 2 })).toBeInTheDocument();
    // The page's one FundingDrafts, with a draft open (no "+" in a game offers one).
    expect(madeDrafts).toHaveLength(1);
    const drafts = madeDrafts[0];
    drafts.open({ kind: 'pool', pool: newOwnPool(asOf) });
    await tick();

    const back = page.getByTestId('game-back');
    await expect.element(back).toBeVisible();
    const first = page.getByTestId('header-actions').element().querySelector('button');
    expect(first).toBe(back.element());
    expect(back.element().className).toBe(BUTTON_PRIMARY);
    expect(back.element().textContent?.trim()).toBe(BACK_TO_TREE);

    await back.click();
    await expect.element(page.getByTestId('tl-mode')).toHaveAttribute('data-phase', 'tree');
    expect(drafts.isOpen).toBe(false);
    await expect.element(page.getByText(DRAFT_DISCARDED, { exact: true })).toBeInTheDocument();
    expect(page.getByTestId('game-back').elements()).toHaveLength(0);
    // Selection, "+" and panel cleared: the workshop opens again with nothing in the column.
    await toWorkshop();
    expect(page.getByTestId('inspector').elements()).toHaveLength(0);
    expect(presets()).toEqual([presetOf(node)]);
  });
});
