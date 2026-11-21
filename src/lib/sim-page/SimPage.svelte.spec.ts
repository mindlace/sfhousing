/// <reference types="@vitest/browser-playwright" />
// /sim on the timeline (timeline-ui Task 14): the page opens the autosaved schema 4 document (a v1
// schema 3 one migrated, upgraded), edits it through the inspector and the map's tools, undoes
// through the store, reverts a rejected edit, publishes schema 4, and in view mode edits nothing.
// The real TimelineMode, session and client run over a fake timeline worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick, type ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushController } from '$lib/brush/BrushController.svelte';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { REAL_ACTUAL } from '$lib/fzp/fixtures/cards';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { FakeMap, callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { LIMITS_LAYER_ID } from '$lib/map/height/limits-layer';
import { LID_MAX_SPAN_M } from '$lib/map/height/lids';
import { tinyLimits } from '$lib/map/height/test/fixtures';
import type { PackedCell } from '$lib/map/types';
import { OUTLINE_LAYER_ID } from '$lib/paint/outline-layers';
import { DRAFT_DISCARDED, limitAlert } from '$lib/sim-page/funding-copy';
import { BOND_POLICY, policyWith } from '$lib/sim-page/test/funding';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import { upgradePolicy } from '$lib/timeline/upgrade';
import { copyFor } from '$lib/sharing/copy';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import type { LimitOwner } from '$lib/sim/levers/source';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import type { Programme } from '$lib/timelapse/types';
import { CHANGE_NOT_APPLIED, DATES_MOVED_NOTICE } from '$lib/timeline/copy';
import { viewMonthOf } from '$lib/timeline/playhead';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { UPGRADED_TEXT } from '$lib/timeline/session4';
import { SIM_KEY4, parseSimDoc4, serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import {
  FakeTimelineWorker,
  compiledMsg,
  errorMsg,
  filledMsg,
  refillMsg
} from '$lib/timeline/test/fake-timeline-worker';
import { statics as baseStatics } from '$lib/timeline/test/fixtures';
import { formatMonthYear } from '$lib/fzp/format';
import { DEFAULT_VIEW, VIEW_KEY } from '$lib/view/prefs';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { replaceStateCalls } from '../../test-stubs/app/navigation';
import './debug';
import { clampBbox } from './lid-request';
import { DEFAULT_POLICY, SIM_CODEC, SIM_KEY, type SimDoc } from './sim-doc';
import type SimPage from './SimPage.svelte';
import SimPageHost from './test/SimPageHost.svelte';
import { PLUS_NAME } from '$lib/timeline/test/plus';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
const workers = vi.hoisted(() => [] as FakeTimelineWorker[]);
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

const manifest = parseManifest(manifestJson);
const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const MONTHS: Day[] = Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const STATICS: ScoreStatics = { ...baseStatics({ lastIndex: LAST }), asOf, months: MONTHS };
const M = (k: number) => monthFirstDay(asOf, k);

const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);
const debug = () => window.__sfhFzp!;

type Over = Partial<ComponentProps<typeof SimPage>>;
function setup(over: Over = {}) {
  return render(SimPageHost, {
    props: {
      manifest,
      manifestError: false,
      calibration: cal,
      calibrationError: false,
      noScenario: false,
      datasetVersion: 'fixture-0',
      reload: async () => ({ manifest, calibration: cal }),
      ...over
    }
  });
}

/** Opened, compiled and filled at rev 1. */
async function opened(over: Over = {}) {
  const r = setup(over);
  await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
  emit(compiledMsg(1, STATICS));
  emit(filledMsg(1, 0, LAST + 1));
  return r;
}

const doc4 = (policy: SimPolicy4, title?: string): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  ...(title === undefined ? {} : { title }),
  policy
});
const zoning = (...z: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning: z, permitting: [], money: [] }
});
/** Storage holding `d` under the v2 key. */
function seeded(d: SimDoc4): MemoryStorage {
  const mem = new MemoryStorage();
  mem.setItem(SIM_KEY4, JSON.stringify({ v: 1, savedAt: 'x', plan: serializeSimDoc4(d) }));
  return mem;
}
const storedDoc = (mem: MemoryStorage) =>
  JSON.parse(JSON.parse(mem.getItem(SIM_KEY4)!).plan) as SimDoc4;

const painted: Policy = {
  id: 'mission',
  label: 'Mission paint',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [
    { from: M(2), to: monthLastDay(asOf, 13), what: { tag: 'brushes', brushes: [] } },
    { from: M(14), to: null, what: { tag: 'brushes', brushes: [] } }
  ]
};
const historic: Policy = {
  id: 'historic',
  label: 'Protect historic buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'historic' },
  spans: [{ from: M(2), to: null, what: { tag: 'protect', years: null } }]
};

const header = () => page.getByRole('banner');
const undoButton = () => header().getByRole('button', { name: /^Undo/ });
const redoButton = () => header().getByRole('button', { name: /^Redo/ });
const inspector = () => page.getByTestId('inspector');
const inspectorTitle = () => inspector().getByRole('heading', { level: 2 });
const notices = () => page.getByTestId('sim-notices');
/** The map toolbar's Layers toggle and its panel (the switches were the header's View menu). */
const layersToggle = () => page.getByRole('button', { name: 'Map layers' });
const layersPanel = () => page.getByRole('group', { name: 'Map layers' });
/** Opens the Layers panel if it is closed. */
async function openLayers(): Promise<void> {
  if (layersToggle().element().getAttribute('aria-expanded') !== 'true')
    await userEvent.click(layersToggle());
  await expect.element(layersPanel()).toBeVisible();
}
const zoningIds = () => debug().policy.kinds.zoning.map((p) => p.id);

beforeEach(async () => {
  workers.length = 0;
  stub.reset();
  vi.stubEnv('VITE_E2E', '1');
  await page.viewport(1280, 900);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('SimPage opening', () => {
  it('opens with the autosaved v2 document, migrating a v1 record first', async () => {
    const one = await opened({ storage: () => seeded(doc4(zoning(historic))) });
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    await one.unmount();

    // Only a v1 record: it moves to v2 first, and that is what opens.
    const mem = new MemoryStorage();
    const old: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: { ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, historic: true } }
    };
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(old) }));
    await opened({ storage: () => mem });
    expect(storedDoc(mem).schema).toBe(4);
    const sent = w().lastOf('openTimeline')!.policy;
    expect(sent.kinds.zoning.map((p) => p.where)).toEqual([
      { tag: 'category', category: 'historic' }
    ]);
    expect(sent).toEqual(storedDoc(mem).policy);
  });

  it('a v1 schema 3 autosave opens upgraded with the upgraded notice', async () => {
    const mem = new MemoryStorage();
    const old: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: { ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, rentControl: true } }
    };
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: SIM_CODEC.serialize(old) }));
    await opened({ storage: () => mem });
    await expect.element(notices().getByText(UPGRADED_TEXT(formatMonthYear(M(1))))).toBeVisible();
    // A load, not a change: nothing to undo.
    await expect.element(undoButton()).toBeDisabled();
  });

  it('dates moved to fit the data: one notice, its lines behind Details', async () => {
    const off = { ...historic, spans: [{ ...historic.spans[0], from: M(2) + 3 }] };
    await opened({ storage: () => seeded(doc4(zoning(off))) });
    await expect.element(notices().getByText(DATES_MOVED_NOTICE)).toBeVisible();
    const line = `Protect historic buildings: ${formatMonthYear(M(2))} – no end`;
    expect(notices().getByText(line).query()).not.toBeVisible();
    await notices().getByRole('button', { name: 'Details' }).click();
    await expect.element(notices().getByText(line)).toBeVisible();
    expect(page.getByText(DATES_MOVED_NOTICE).elements()).toHaveLength(1);
  });

  it("with no calibration at mount, the document opens after a Retry's reload", async () => {
    setup({
      calibration: null,
      calibrationError: true,
      storage: () => seeded(doc4(zoning(historic)))
    });
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
  });
});

describe('SimPage editing', () => {
  it('closing the "+" menu puts focus back on that "+"', async () => {
    await opened();
    const add = page.getByRole('button', { name: PLUS_NAME.Permitting });
    await add.click();
    await expect
      .element(inspector().getByRole('group', { name: 'Add to Permitting' }))
      .toBeVisible();
    await inspector().getByRole('button', { name: 'Close editor' }).click();
    await expect.element(inspector()).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(add.element());
  });

  it('adding, switching off, removing and reordering a policy; undo and redo across those', async () => {
    await opened();
    const add = page.getByRole('button', { name: PLUS_NAME.Zoning });
    await add.click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
    await expect.element(inspectorTitle()).toHaveTextContent('Protect historic buildings');
    await expect.element(undoButton()).toHaveAccessibleName(/Added: Protect historic buildings/);

    const on = inspector().getByRole('switch', { name: 'On' });
    await on.click();
    await expect.element(on).toHaveAttribute('aria-checked', 'false');
    expect(debug().policy.kinds.zoning[0].on).toBe(false);

    await add.click();
    await page.getByRole('button', { name: 'Protect rent-controlled buildings' }).click();
    await expect.element(inspectorTitle()).toHaveTextContent('Protect rent-controlled buildings');
    const [first, second] = zoningIds();
    await inspector().getByRole('button', { name: 'Move up' }).click();
    await expect.poll(zoningIds).toEqual([second, first]);

    await inspector().getByRole('button', { name: 'Remove policy' }).click();
    await expect.poll(zoningIds).toEqual([first]);
    // The bar is gone: focus falls back to the kind's "+" (WCAG 2.4.3).
    await expect.poll(() => document.activeElement).toBe(add.element());

    await undoButton().click();
    await expect.poll(zoningIds).toEqual([second, first]);
    await undoButton().click();
    await expect.poll(zoningIds).toEqual([first, second]);
    await redoButton().click();
    await expect.poll(zoningIds).toEqual([second, first]);
    await redoButton().click();
    await expect.poll(zoningIds).toEqual([first]);
    expect(debug().policy.kinds.zoning[0].on).toBe(false);
  });

  it('a paint stroke lands in the selected painted span; with none selected a new painted policy starts at the playhead', async () => {
    await opened({ storage: () => seeded(doc4(zoning(painted))) });
    await page
      .getByTestId('tl-kind-zoning')
      .getByRole('button', { name: /^Zoning/ })
      .click();
    const bars = page.getByTestId('tl-bar');
    await expect.element(bars.nth(1)).toBeVisible();
    await bars.nth(1).click();
    await expect.element(inspectorTitle()).toHaveTextContent('Mission paint');
    await inspector().getByRole('radio', { name: 'Paint' }).click();
    await expect.poll(() => stub.calls.some((c) => c.method === 'setPanEnabled')).toBe(true);

    const canvas = stub.map.getCanvas();
    const stroke = () => {
      const ev = (type: string, x: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: 10,
            pointerId: 1,
            pointerType: 'mouse',
            button: type === 'pointermove' ? -1 : 0,
            isPrimary: true
          })
        );
      ev('pointerdown', 10);
      for (let x = 20; x <= 80; x += 10) ev('pointermove', x);
      ev('pointerup', 80);
    };
    const brushes = (p: Policy | undefined, i: number) => {
      const what = p?.spans[i]?.what;
      return what?.tag === 'brushes' ? what.brushes.length : -1;
    };

    stroke();
    await expect.poll(() => brushes(debug().policy.kinds.zoning[0], 1)).toBe(1);
    expect(brushes(debug().policy.kinds.zoning[0], 0)).toBe(0);
    await expect.element(undoButton()).toHaveAccessibleName(/^Undo: Allowed \d+ stor/);

    // Nothing selected, Paint still chosen: the stroke starts a painted policy at the playhead.
    await inspector().getByRole('button', { name: 'Close editor' }).click();
    await expect.element(inspector()).not.toBeInTheDocument();
    stroke();
    await expect.poll(() => debug().policy.kinds.zoning.length).toBe(2);
    const added = debug().policy.kinds.zoning[1];
    expect(added.where).toEqual({ tag: 'painted' });
    expect(added.spans).toHaveLength(1);
    expect(added.spans[0].from).toBe(M(viewMonthOf(asOf, debug().day)));
    expect(brushes(added, 0)).toBe(1);
    await expect.element(inspectorTitle()).toHaveTextContent(added.label);
    // One change: one undo takes the policy and its stroke away.
    await undoButton().click();
    await expect.poll(() => debug().policy.kinds.zoning.length).toBe(1);
  });

  it('a tap on an empty lot selects the policy that sets its limit', async () => {
    await opened({ storage: () => seeded(doc4(zoning(historic, painted))) });
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    stub.map.fire('click', { lngLat: { lng: -122.42, lat: 37.76 } });
    await expect.poll(() => w().lastOf('lotAt')).toBeTruthy();
    const req = w().lastOf('lotAt')!;
    expect(req.point).toEqual([-122.42, 37.76]);
    emit({
      type: 'lotAt',
      reqId: req.reqId,
      result: {
        ok: true,
        parcelId: 'p1',
        owner: { kind: 'paint', policy: 'mission' } as unknown as LimitOwner
      }
    });
    await expect.element(inspectorTitle()).toHaveTextContent('Mission paint');
    // Its kind opened, the span at the playhead (the first: month 1 is before it) pressed.
    const pressed = page.getByTestId('tl-bar').and(page.getByRole('button', { pressed: true }));
    await expect.element(pressed).toBeVisible();
    expect(w().all('parcelSummary')).toHaveLength(0);
  });

  it('a tap on a building opens its card and selects nothing', async () => {
    await opened({ storage: () => seeded(doc4(zoning(painted))) });
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    stub.map.fire('click', { lngLat: { lng: -122.42, lat: 37.76 } });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    emit({
      type: 'parcelSummary',
      reqId: req.reqId,
      summary: {
        parcelId: 'p1',
        neighborhood: 'Mission',
        landUse: 'residential',
        eligible: true,
        existingUnits: 2,
        envelope: null,
        generated: null,
        project: REAL_ACTUAL
      }
    });
    await expect
      .element(page.getByTestId('tl-card').getByRole('heading', { level: 2 }))
      .toBeInTheDocument();
    expect(w().all('lotAt')).toHaveLength(0);
    expect(inspector().query()).toBeNull();
  });

  it('bad-request from the worker undoes the edit and shows "That change couldn\'t be applied."', async () => {
    await opened();
    await page.getByRole('button', { name: PLUS_NAME.Zoning }).click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(errorMsg(2, 'bad-request'));
    await expect.element(page.getByTestId('tl-alerts')).toHaveTextContent(CHANGE_NOT_APPLIED);
    await expect.poll(() => debug().policy.kinds.zoning).toEqual([]);
    // Undone in the store's history: nothing left to undo, the edit to redo.
    await expect.element(undoButton()).toBeDisabled();
    await expect.element(redoButton()).toBeEnabled();
  });

  it("a stroke whose lots can't be found leaves the page current; the notice's Retry finds them", async () => {
    await opened({ storage: () => seeded(doc4(zoning(painted))) });
    await page
      .getByTestId('tl-kind-zoning')
      .getByRole('button', { name: /^Zoning/ })
      .click();
    await page.getByTestId('tl-bar').nth(1).click();
    await inspector().getByRole('radio', { name: 'Paint' }).click();
    await expect.poll(() => callsOf('setPanEnabled').at(-1)?.[0]).toBe(false);
    const canvas = stub.map.getCanvas();
    const ev = (type: string, x: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: 10,
          pointerId: 1,
          pointerType: 'mouse',
          button: type === 'pointermove' ? -1 : 0,
          isPrimary: true
        })
      );
    ev('pointerdown', 10);
    for (let x = 20; x <= 80; x += 10) ev('pointermove', x);
    ev('pointerup', 80);
    await expect.poll(() => debug().stale).toBe(true);

    let answered = 0;
    /** Answers every resolveBrush asked so far. */
    const answer = (ok: boolean) => {
      for (const q of w().all('resolveBrush').slice(answered)) {
        emit({
          type: 'brushLots',
          reqId: q.reqId,
          result: ok
            ? { ok: true, lots: ['P0'], points: Float64Array.from([0, 0]) }
            : { ok: false, reason: 'data-missing', message: 'no lots' }
        });
        answered++;
      }
    };
    await expect.poll(() => w().all('resolveBrush').length).toBeGreaterThan(0);
    answer(false);
    const alerts = page.getByTestId('tl-alerts');
    await expect.element(alerts.getByText("Couldn't find lots")).toBeVisible();
    await expect.poll(() => debug().stale).toBe(false);
    expect(w().all('setPolicy')).toHaveLength(0);

    await alerts.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => w().all('resolveBrush').length).toBeGreaterThan(answered);
    answer(true);
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(Object.values(w().lastOf('setPolicy')!.lots)).toContainEqual(['P0']);
    await expect.element(alerts.getByText("Couldn't find lots")).not.toBeInTheDocument();
  });

  it("an edit that leaves a programme's term unsourced drops it, with today's notice", async () => {
    const F = fundingOnly();
    const guarantee: Programme = {
      ...F.programmes[0],
      id: 'u-g',
      label: 'Loan guarantee',
      instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 }
    };
    const fund: Policy = {
      id: 'fund',
      label: 'Added pool',
      preset: null,
      on: true,
      where: { tag: 'fund', pool: 'u-pool-1' },
      spans: [
        { from: M(2), to: null, what: { tag: 'fund', pool: F.pools[0], programmes: [guarantee] } }
      ]
    };
    const terms: Policy = {
      id: 'terms',
      label: 'Market terms',
      preset: null,
      on: true,
      where: { tag: 'terms' },
      spans: [{ from: M(2), to: null, what: { tag: 'terms', terms: { guaranteeRateCut: 0.01 } } }]
    };
    const policy: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [], permitting: [], money: [fund, terms] }
    };
    const mem = seeded(doc4(policy));
    await opened({ storage: () => mem });
    expect(w().lastOf('openTimeline')!.policy).toEqual(policy);

    await page
      .getByTestId('tl-kind-money')
      .getByRole('button', { name: /^Public money/ })
      .click();
    await page.getByRole('button', { name: /^Market terms, / }).click();
    await expect.element(inspectorTitle()).toHaveTextContent('Market terms');
    await inspector().getByRole('button', { name: 'Remove policy' }).click();

    await expect
      .element(notices().getByText(/^Some changes to public money didn't fit/))
      .toBeVisible();
    const what = () => debug().policy.kinds.money[0]?.spans[0].what;
    await expect
      .poll(() => (what()?.tag === 'fund' ? what() : null))
      .toMatchObject({
        programmes: []
      });
    await expect.poll(() => storedDoc(mem).policy.kinds.money).toHaveLength(1);
    expect(parseSimDoc4(serializeSimDoc4(storedDoc(mem)), asOf).ok).toBe(true);
  });
});

describe('SimPage publish and view', () => {
  it('publishes a schema 4 document', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'AbCdEfGh' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    await opened({ fetchFn: fetchFn as unknown as typeof fetch });
    const publish = page.getByTestId('publish-open');
    await expect.element(publish).toBeDisabled();
    await page.getByRole('button', { name: PLUS_NAME.Zoning }).click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
    await expect.element(publish).toBeEnabled();
    await publish.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabelText('Title').fill('Historic');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .element(dialog.getByLabelText('Link'))
      .toHaveValue(`${location.origin}/s/AbCdEfGh`);
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
    const parsed = parseSimDoc4(body, asOf);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schema).toBe(4);
    expect(parsed.value.title).toBe('Historic');
    expect(parsed.value.policy.kinds.zoning.map((p) => p.label)).toEqual([
      'Protect historic buildings'
    ]);
  });

  it('view mode renders no editable control', async () => {
    await opened({
      mode: 'view',
      persist: 'off',
      initialText: serializeSimDoc4(doc4(zoning(historic)))
    });
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    await expect.element(page.getByTestId('tl-timeline')).toBeVisible();
    expect(page.getByRole('button', { name: /^Add .* policy$/ }).elements()).toHaveLength(0);
    expect(header().getByRole('button', { name: /^Undo/ }).elements()).toHaveLength(0);
    expect(page.getByTestId('publish-open').elements()).toHaveLength(0);
    await page
      .getByTestId('tl-kind-zoning')
      .getByRole('button', { name: /^Zoning/ })
      .click();
    await page.getByTestId('tl-bar').first().click();
    await expect.element(inspectorTitle()).toHaveTextContent('Protect historic buildings');
    expect(inspector().getByRole('button', { name: 'Remove policy' }).elements()).toHaveLength(0);
    expect(inspector().getByRole('switch').elements()).toHaveLength(0);
    expect(inspector().getByRole('spinbutton').elements()).toHaveLength(0);
  });

  it('view mode takes a document the route already opened, with its notices', async () => {
    const shared = doc4(zoning(historic), 'SD');
    await opened({
      mode: 'view',
      persist: 'off',
      initialText: '{"not":"opened again"}',
      opened: { doc: shared, notices: [{ id: 'upgraded', text: 'Was older.', tone: 'info' }] }
    });
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    await expect.element(notices().getByText('Was older.')).toBeVisible();
  });

  it("a shared text that won't open after a Retry is an alert", async () => {
    setup({
      mode: 'view',
      persist: 'off',
      calibration: null,
      calibrationError: true,
      initialText: '{"schema":4}'
    });
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect
      .element(page.getByRole('alert').getByText(copyFor('sim').unparsable))
      .toBeVisible();
  });

  it('the header has no View; Layers on the map lists stops, capacity and limits in order', async () => {
    const r = await opened();
    await expect.element(layersToggle()).toBeVisible();
    expect(header().getByRole('button', { name: 'View', exact: true }).elements()).toEqual([]);
    expect(header().element().contains(layersToggle().element())).toBe(false);
    expect(page.getByTestId('map-key-control').element().contains(layersToggle().element())).toBe(
      true
    );
    await userEvent.click(layersToggle());
    const names = () =>
      layersPanel()
        .getByRole('checkbox')
        .elements()
        .map((e) => e.closest('label')!.textContent!.trim());
    await expect.element(layersPanel()).toBeVisible();
    expect(names()).toEqual([
      'Transit stops',
      'Transit capacity within a 10-minute walk',
      'Zoning height limits'
    ]);
    // After an edit and mid-refill: still there.
    await page.getByRole('button', { name: PLUS_NAME.Zoning }).click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 3));
    await expect.element(layersToggle()).toBeVisible();
    await r.unmount();
    // The read-only view offers them too.
    await opened({ mode: 'view', persist: 'off', initialText: serializeSimDoc4(doc4(zoning())) });
    await expect.element(layersToggle()).toBeVisible();
    expect(header().getByRole('button', { name: 'View', exact: true }).elements()).toEqual([]);
    await userEvent.click(layersToggle());
    await expect.element(page.getByRole('checkbox', { name: /height limits/i })).toBeVisible();
  });

  it('at 1024 px signed in, /sim fits with Autosave off and the status cell is not clipped', async () => {
    await page.viewport(1024, 800);
    // Every storage call fails: autosave is off, and its chip is the widest save state.
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      }
    } as unknown as Storage;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await opened({ storage: () => blocked, headerUser: { handle: 'a'.repeat(24) } } as Over);
    const chip = header().getByRole('button', { name: 'Autosave off' });
    await expect.element(chip).toBeVisible();
    // The playhead at the end: the headline's longest date.
    (page.getByRole('slider').first().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    const cell = document.querySelector<HTMLElement>('[data-header-status]')!;
    const banner = header().element() as HTMLElement;
    expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
    expect(cell.scrollWidth, 'the status cell clips its content').toBeLessThanOrEqual(
      cell.clientWidth
    );
    expect(chip.element().getBoundingClientRect().right).toBeLessThanOrEqual(
      cell.getBoundingClientRect().right + 0.5
    );
    expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(
      page.getByTestId('score-bar').element().getBoundingClientRect().left
    );
    const account = header().getByRole('link', { name: `@${'a'.repeat(24)}` });
    await expect.element(account).toBeVisible();
  });
});

// ---- ported from the schema 3 page: map tools, overlays, persistence (kept by rule 41) ----

/** A tick and two animation frames: what an answer or a state change started has run. */
const frames = async () => {
  await tick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
};
const sunset: Policy = { ...painted, id: 'sunset', label: 'Sunset paint' };
const transit: Policy = {
  id: 'near-bart',
  label: 'Taller near BART',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [{ from: M(2), to: null, what: { tag: 'bands', bands: [{ maxM: 400, stories: 8 }] } }]
};
const openZoning = () =>
  page
    .getByTestId('tl-kind-zoning')
    .getByRole('button', { name: /^Zoning/ })
    .click();
const ev = (type: string, x: number, pointerId = 1) =>
  stub.map.getCanvas().dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 10,
      pointerId,
      pointerType: 'mouse',
      button: type === 'pointermove' ? -1 : 0,
      isPrimary: true
    })
  );
/** Pointer down and moves to `to`: a stroke in progress. */
function drag(from: number, to: number, pointerId = 1): void {
  ev('pointerdown', from, pointerId);
  for (let x = from + 10; x <= to; x += 10) ev('pointermove', x, pointerId);
}
const toolKey = async (key: 'b' | 'e' | 'v') => {
  (document.activeElement as HTMLElement | null)?.blur();
  await userEvent.keyboard(key);
};

describe('SimPage map overlays', () => {
  type LimitsLayerLike = {
    id: string;
    props: { city: unknown; lids: unknown; mode: unknown; theme: string };
  };
  const overlays = () => (callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as LimitsLayerLike[];
  const overlayIds = () => overlays().map((l) => l.id);
  const lastLayer = () => overlays().find((l) => l.id === LIMITS_LAYER_ID);
  /** The worker posts the zoning in force at the last view month. */
  function emitHeights() {
    const { city } = tinyLimits();
    emit({ type: 'heights', rev: 1, city: { ...city, rev: 1 } });
  }
  function moveTo(zoom: number) {
    stub.map.zoom = zoom;
    stub.map.fire('moveend');
  }
  async function scheme(value: 'light' | 'dark') {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value }]
    });
  }
  function answerLids() {
    const { lids } = tinyLimits();
    emit({
      type: 'heightLids',
      reqId: w().lastOf('heightLids')!.reqId,
      result: { ok: true, lids, missing: 0 }
    });
    return lids;
  }

  it('the limits layer draws plain, at the default view', async () => {
    await opened();
    expect(stub.props.view).toEqual(DEFAULT_VIEW);
    emitHeights();
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    expect(lastLayer()!.props).toMatchObject({ lids: null, mode: { kind: 'plain' } });
  });

  it('at zoom ≥ 14.5 the page asks heightLids for the view; below, it asks nothing', async () => {
    await opened();
    emitHeights();
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    moveTo(14);
    const centre = { lng: -122.44, lat: 37.76 };
    stub.map.getCenter = () => centre;
    moveTo(14.5);
    // One question: the z14 view asked none.
    await expect.poll(() => w().all('heightLids').length).toBe(1);
    const asked = w().lastOf('heightLids')!.bbox;
    expect(asked).toEqual(clampBbox(stub.map.bounds, LID_MAX_SPAN_M, [centre.lng, centre.lat]));
    const lids = answerLids();
    await expect.poll(() => lastLayer()?.props.lids).toBe(lids);
    // Zoomed out again: the lids go, the contours stay.
    moveTo(13);
    await expect.poll(() => lastLayer()?.props.lids).toBeNull();
    expect(lastLayer()!.props.city).not.toBeNull();
    expect(w().all('heightLids')).toHaveLength(1);
  });

  it('a theme change or a tool change rebuilds the layer without a new heightLids', async () => {
    await opened();
    emitHeights();
    moveTo(15);
    await expect.poll(() => w().all('heightLids').length).toBe(1);
    const lids = answerLids();
    await expect.poll(() => lastLayer()?.props.lids).toBe(lids);
    try {
      await scheme('dark');
      await expect.poll(() => lastLayer()?.props.theme).toBe('dark');
      await toolKey('b');
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'paint' });
      await toolKey('v');
      await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
      expect(lastLayer()!.props.lids).toBe(lids);
      expect(w().all('heightLids')).toHaveLength(1);
    } finally {
      await scheme('light');
    }
  });

  it('no-session drops the lids, keeps the contours and asks again on the next client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await opened();
    const first = w();
    emitHeights();
    moveTo(15);
    await expect.poll(() => first.all('heightLids').length).toBe(1);
    const lids = answerLids();
    await expect.poll(() => lastLayer()?.props.lids).toBe(lids);
    stub.map.bounds = [-122.44, 37.75, -122.43, 37.76];
    moveTo(15);
    await expect.poll(() => first.all('heightLids').length).toBe(2);
    first.crash();
    await expect.poll(() => lastLayer()?.props.lids).toBeNull();
    expect(lastLayer()!.props.city).not.toBeNull();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => w()).not.toBe(first);
    await expect.poll(() => w().all('heightLids').length).toBe(1);
  });

  it('a stored heightLimits: false draws nothing until turned on', async () => {
    const mem = new MemoryStorage();
    mem.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: false, transitAccess: true, heightLimits: false })
    );
    await opened({ storage: () => mem });
    emitHeights();
    moveTo(15);
    await frames();
    expect(overlayIds()).not.toContain(LIMITS_LAYER_ID);
    expect(w().all('heightLids')).toHaveLength(0);
    await openLayers();
    await page.getByRole('checkbox', { name: 'Zoning height limits' }).click();
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    await expect.poll(() => w().all('heightLids').length).toBe(1);
  });

  it('selecting a transit policy sets rule mode on its id; the plan row sets fzp mode', async () => {
    await opened({ storage: () => seeded(doc4(zoning(transit))) });
    emitHeights();
    await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
    await openZoning();
    await page.getByTestId('tl-bar').first().click();
    await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'rule', ruleId: 'near-bart' });
    // Rule mode wins over a stroke tool.
    await toolKey('b');
    await frames();
    expect(lastLayer()!.props.mode).toEqual({ kind: 'rule', ruleId: 'near-bart' });
    await toolKey('v');
    await page.getByRole('button', { name: 'Current law, whole window' }).click();
    await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'fzp' });
    await inspector().getByRole('button', { name: 'Close editor' }).click();
    await expect.poll(() => lastLayer()?.props.mode).toEqual({ kind: 'plain' });
  });

  it('selecting a Transit rule row turns the limits layer on (as through View before)', async () => {
    for (const which of ['policy', 'plan'] as const) {
      stub.reset();
      const mem = seeded(doc4(zoning(transit)));
      mem.setItem(
        VIEW_KEY,
        JSON.stringify({ transitStops: false, transitAccess: true, heightLimits: false })
      );
      const r = await opened({ storage: () => mem });
      emitHeights();
      await frames();
      expect(overlayIds()).not.toContain(LIMITS_LAYER_ID);
      await openZoning();
      if (which === 'policy') await page.getByTestId('tl-bar').first().click();
      else await page.getByRole('button', { name: 'Current law, whole window' }).click();
      await expect.poll(overlayIds).toContain(LIMITS_LAYER_ID);
      expect(lastLayer()!.props.mode).toEqual(
        which === 'policy' ? { kind: 'rule', ruleId: 'near-bart' } : { kind: 'fzp' }
      );
      expect(JSON.parse(mem.getItem(VIEW_KEY)!).heightLimits).toBe(true);
      // The Layers switch shows it on.
      await openLayers();
      await expect
        .element(layersPanel().getByRole('checkbox', { name: 'Zoning height limits' }))
        .toBeChecked();
      await r.unmount();
    }
  });

  it('without manifest.transit Layers lists the limits row only', async () => {
    await opened({ manifest: { ...manifest, transit: undefined } });
    await openLayers();
    expect(layersPanel().getByRole('checkbox').elements()).toHaveLength(1);
    await expect
      .element(page.getByRole('checkbox', { name: 'Zoning height limits' }))
      .toBeChecked();
  });

  it('the rows follow the manifest the map renders: a Retry after a failed load brings transit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ manifest: null, manifestError: true });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect.element(retry).toBeVisible();
    // No map, no toolbar: nothing to switch until the map is there.
    expect(layersToggle().elements()).toHaveLength(0);
    await retry.click();
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, STATICS));
    emit(filledMsg(1, 0, LAST + 1));
    await openLayers();
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeVisible();
    expect(layersPanel().getByRole('checkbox').elements()).toHaveLength(3);
  });

  it('the prefs are read from and written to the page storage', async () => {
    const mem = new MemoryStorage();
    mem.setItem(VIEW_KEY, JSON.stringify({ transitStops: true, transitAccess: true }));
    await opened({ storage: () => mem });
    await expect
      .poll(() => stub.props.view)
      .toEqual({ transitStops: true, transitAccess: true, heightLimits: true });
    await openLayers();
    // The stored choices are on in the panel.
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeChecked();
    await expect.element(page.getByRole('checkbox', { name: /Transit capacity/ })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Zoning height limits' }).click();
    await expect
      .poll(() => JSON.parse(mem.getItem(VIEW_KEY) ?? '{}'))
      .toEqual({ transitStops: true, transitAccess: true, heightLimits: false });
  });
});

describe('SimPage tools', () => {
  it('B and E pick Paint and Erase; V goes back to Move', async () => {
    await opened({ storage: () => seeded(doc4(zoning(painted))) });
    await openZoning();
    await page.getByTestId('tl-bar').first().click();
    await expect.element(inspector().getByRole('radio', { name: 'Move' })).toBeChecked();
    await toolKey('e');
    await expect.element(inspector().getByRole('radio', { name: 'Erase' })).toBeChecked();
    await toolKey('b');
    await expect.element(inspector().getByRole('radio', { name: 'Paint' })).toBeChecked();
    await toolKey('v');
    await expect.element(inspector().getByRole('radio', { name: 'Move' })).toBeChecked();
  });

  // Rule 19: with a stroke tool a tap strokes, so the tool must stay visible to turn off. From md
  // the painted policy's editor holds the tools; with it out of view (closed, another selection,
  // Details) the header offers "Stop painting" / "Stop erasing". Below md the palette strip does.
  it('on desktop a stroke tool with its editor closed shows in the header and turns off there', async () => {
    await opened({ storage: () => seeded(doc4(zoning(painted))) });
    const stop = () => header().getByRole('button', { name: /^Stop (painting|erasing)$/ });
    await openZoning();
    await page.getByTestId('tl-bar').first().click();
    await inspector().getByRole('radio', { name: 'Paint' }).click();
    // The editor's own tools are on show: no second control.
    expect(stop().elements()).toHaveLength(0);
    await inspector().getByRole('button', { name: 'Close editor' }).click();
    await expect.element(stop()).toHaveTextContent('Stop painting');
    expect(stub.props.tapCards).toBe(false);
    await toolKey('e');
    await expect.element(stop()).toHaveTextContent('Stop erasing');
    await stop().click();
    await expect.element(stop()).not.toBeInTheDocument();
    await expect.poll(() => stub.props.tapCards).toBe(true);
    // A tap on a building opens its card again.
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
  });

  it('"Stop painting" shows while "+" or a pool draft hides the painted policy’s tools', async () => {
    await opened({ storage: () => seeded(doc4(zoning(painted))) });
    const stop = () => header().getByRole('button', { name: 'Stop painting' });
    await openZoning();
    await page.getByTestId('tl-bar').first().click();
    await inspector().getByRole('radio', { name: 'Paint' }).click();
    expect(stop().elements()).toHaveLength(0);

    // "+" over the selected painted policy: its menu hides the tools.
    await page.getByRole('button', { name: PLUS_NAME.Permitting }).click();
    await expect
      .element(inspector().getByRole('group', { name: 'Add to Permitting' }))
      .toBeVisible();
    await expect.element(stop()).toBeVisible();

    // A pool draft hides them too.
    await page.getByRole('button', { name: PLUS_NAME['Public money'] }).click();
    await page.getByRole('button', { name: 'Your own pool' }).click();
    await expect.element(inspectorTitle()).toHaveTextContent('Your own pool');
    await expect.element(stop()).toBeVisible();
    await stop().click();
    await expect.poll(() => stub.props.tapCards).toBe(true);
  });

  it('the transit catalog is asked for once, when the editor first shows', async () => {
    await opened();
    expect(w().all('brushCatalog')).toHaveLength(0);
    const add = page.getByRole('button', { name: PLUS_NAME.Zoning });
    await add.click();
    await expect.poll(() => w().all('brushCatalog')).toHaveLength(1);
    await inspector().getByRole('button', { name: 'Close editor' }).click();
    await add.click();
    await expect.element(inspector().getByRole('group', { name: 'Add to Zoning' })).toBeVisible();
    expect(w().all('brushCatalog')).toHaveLength(1);
  });

  it('closing a pool draft puts focus on the Public money "+"', async () => {
    await opened();
    const add = page.getByRole('button', { name: PLUS_NAME['Public money'] });
    await add.click();
    await page.getByRole('button', { name: 'Your own pool' }).click();
    await expect.element(inspectorTitle()).toHaveTextContent('Your own pool');
    await inspector().getByRole('button', { name: 'Close editor' }).click();
    await expect.element(inspector()).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(add.element());
  });
});

describe('SimPage live preview', () => {
  const preview = () => window.__sfhSim?.preview;
  const feedbackIds = () =>
    ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[])
      .map((l) => l.id)
      .filter((id) => id.startsWith('sim-feedback-'));
  function more(from: number, to: number, pointerId = 1): void {
    for (let x = from; x <= to; x += 10) ev('pointermove', x, pointerId);
  }
  function pack(): PackedCell {
    const c = stub.map.getCenter();
    const d = 1e-4;
    const ring = [c.lng, c.lat, c.lng, c.lat + d, c.lng + d, c.lat + d, c.lng + d, c.lat];
    return {
      cellId: 'preview',
      parcelIds: ['P0'],
      parcelMeta: Uint32Array.from([4, 1, 3, 0]),
      partCount: 1,
      startIndices: Uint32Array.from([0, 5]),
      positions: Float64Array.from([...ring, c.lng, c.lat]),
      partTopM: Float32Array.from([10]),
      partSlot: Uint32Array.from([0]),
      partAppearance: Uint8Array.from([0]),
      partTypology: Uint8Array.from([0])
    };
  }
  /** Answers the `n`th (1-based) resolveBrush: P0 at the centre, FAR out of view. */
  function answerLots(n: number): void {
    const c = stub.map.getCenter();
    emit({
      type: 'brushLots',
      reqId: w().all('resolveBrush')[n - 1].reqId,
      result: { ok: true, lots: ['P0', 'FAR'], points: Float64Array.from([c.lng, c.lat, 0, 0]) }
    });
  }
  function answerBuildings(n: number): void {
    emit({
      type: 'previewBuildings',
      reqId: w().all('previewBuildings')[n - 1].reqId,
      result: { ok: true, pack: pack(), built: 1, missing: 0 }
    });
  }
  /** /sim open with `key`'s tool (B Paint, E Erase) and nothing selected. */
  async function readyToPaint(key: 'b' | 'e' = 'b') {
    await opened();
    await toolKey(key);
    await expect.poll(() => callsOf('setPanEnabled').at(-1)?.[0]).toBe(false);
  }
  async function liveStroke() {
    drag(10, 40);
    await expect.poll(() => w().all('resolveBrush').length).toBe(1);
    answerLots(1);
    await expect.poll(() => w().all('previewBuildings').length).toBe(1);
    answerBuildings(1);
    await expect.poll(preview).toBe('live');
  }
  const motion = (value: 'reduce' | 'no-preference') =>
    cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }]
    });

  afterEach(async () => {
    await motion('reduce');
  });

  it('a Paint drag asks previewBuildings mid-stroke and fades on release', async () => {
    await motion('no-preference');
    await readyToPaint();
    expect(preview()).toBe('none');
    drag(10, 40);
    await expect.poll(() => w().all('resolveBrush').length).toBe(1);
    expect(w().lastOf('resolveBrush')!.query).toMatchObject({ kind: 'freehand' });
    answerLots(1);
    await expect.poll(() => w().all('previewBuildings').length).toBe(1);
    expect(w().lastOf('previewBuildings')).toMatchObject({ lots: ['P0'], stories: 6 });
    answerBuildings(1);
    await expect.poll(preview).toBe('live');
    expect(feedbackIds()).toEqual(['sim-feedback-1']);
    more(50, 80);
    await expect.poll(() => w().all('resolveBrush').length).toBe(2);
    ev('pointerup', 80);
    expect(preview()).toBe('fading');
  });

  it('release before an answer arrives: the late answer is dropped', async () => {
    await motion('no-preference');
    await readyToPaint();
    await liveStroke();
    more(50, 80);
    await expect.poll(() => w().all('resolveBrush').length).toBe(2);
    answerLots(2);
    await expect.poll(() => w().all('previewBuildings').length).toBe(2);
    ev('pointerup', 80);
    expect(preview()).toBe('fading');
    answerBuildings(2);
    await frames();
    expect(preview()).not.toBe('live');
    expect(feedbackIds()).not.toContain('sim-feedback-2');
  });

  it('Escape mid-stroke clears the buildings at once; the cancelled preview is answered', async () => {
    const done = vi.spyOn(BrushController.prototype, 'previewDone');
    await readyToPaint();
    await liveStroke();
    expect(done).toHaveBeenCalledTimes(1);
    more(50, 80);
    await expect.poll(() => w().all('resolveBrush').length).toBe(2);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
    answerLots(2);
    await expect.poll(() => done.mock.calls.length).toBe(2);
    expect(w().all('previewBuildings')).toHaveLength(1);
    expect(preview()).toBe('none');
    ev('pointerup', 80);
    drag(10, 40, 2);
    await expect.poll(() => w().all('resolveBrush').length).toBe(3);
    ev('pointerup', 40, 2);
  });

  it('a new map mid-stroke clears the live buildings and drops the answers still on their way', async () => {
    await readyToPaint();
    await liveStroke();
    more(50, 80);
    await expect.poll(() => w().all('resolveBrush').length).toBe(2);
    stub.map = new FakeMap();
    stub.fireReady();
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
    answerLots(2);
    await frames();
    expect(w().all('previewBuildings')).toHaveLength(1);
    expect(preview()).toBe('none');
  });

  it('an Erase drag shows no buildings, and each of its previews is answered', async () => {
    const done = vi.spyOn(BrushController.prototype, 'previewDone');
    await readyToPaint('e');
    drag(10, 40);
    await expect.poll(() => done.mock.calls.length).toBe(1);
    more(50, 80);
    await expect.poll(() => done.mock.calls.length).toBe(2);
    expect(w().all('resolveBrush')).toHaveLength(0);
    expect(w().all('previewBuildings')).toHaveLength(0);
    expect(preview()).toBe('none');
    ev('pointerup', 80);
    await frames();
    expect(w().all('previewBuildings')).toHaveLength(0);
    expect(feedbackIds()).toEqual([]);
  });

  it('under reduced motion a release clears the buildings at once', async () => {
    await readyToPaint();
    await liveStroke();
    ev('pointerup', 40);
    expect(preview()).toBe('none');
    expect(feedbackIds()).toEqual([]);
  });
});

describe('SimPage painted areas', () => {
  const brushLots = ['P0', 'P1'];
  const withArea: Policy = {
    ...painted,
    spans: [
      {
        from: M(2),
        to: null,
        what: {
          tag: 'brushes',
          brushes: [
            {
              id: 'b1',
              kind: 'paint',
              strokes: [{ path: [[-122.42, 37.76]], radiusM: 50 }],
              stories: 6
            }
          ]
        }
      }
    ]
  };
  const overlayIds = () =>
    ((callsOf('setOverlayLayers').at(-1)?.[0] ?? []) as { id: string }[]).map((l) => l.id);
  const areaRows = () =>
    page
      .getByRole('list', { name: 'Painted areas' })
      .getByRole('button', { name: /^(\d+ stor(y|ies)|Erased) · / });
  function answerOutlines() {
    const req = w().lastOf('lotOutlines')!;
    const c = stub.map.getCenter();
    const d = 1e-3;
    emit({
      type: 'lotOutlines',
      reqId: req.reqId,
      result: {
        ok: true,
        lots: req.lots,
        ringLot: Uint32Array.from([0]),
        starts: Uint32Array.from([0, 4]),
        positions: Float64Array.from([
          c.lng,
          c.lat,
          c.lng + d,
          c.lat,
          c.lng + d,
          c.lat + d,
          c.lng,
          c.lat + d
        ]),
        missing: 0
      }
    });
  }
  /** The painted policy open in the editor, its area's lots found. */
  async function withPaintedArea() {
    await opened({ storage: () => seeded(doc4(zoning(withArea))) });
    await expect.poll(() => w().all('resolveBrush').length).toBe(1);
    emit({
      type: 'brushLots',
      reqId: w().lastOf('resolveBrush')!.reqId,
      result: { ok: true, lots: brushLots, points: new Float64Array(4) }
    });
    await openZoning();
    await page.getByTestId('tl-bar').first().click();
    await expect.element(areaRows().first()).toHaveAccessibleName('6 stories · 1 stroke · 2 lots');
  }

  it('selecting a painted area asks for its outlines; unselecting drops them', async () => {
    await withPaintedArea();
    await areaRows().first().click();
    await expect.poll(() => w().lastOf('lotOutlines')?.lots).toEqual(brushLots);
    answerOutlines();
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
    await areaRows().first().click();
    await expect.poll(overlayIds).not.toContain(OUTLINE_LAYER_ID);
  });

  it('Erase with no area picked outlines the span’s painted lots', async () => {
    await withPaintedArea();
    await inspector().getByRole('radio', { name: 'Erase' }).click();
    await expect.poll(() => w().lastOf('lotOutlines')?.lots).toEqual(brushLots);
  });

  it('Remove on the selected area is one change Undo names; the selection and outline go', async () => {
    await withPaintedArea();
    await areaRows().first().click();
    await expect.poll(() => w().lastOf('lotOutlines')?.lots).toEqual(brushLots);
    answerOutlines();
    await expect.poll(overlayIds).toContain(OUTLINE_LAYER_ID);
    const asked = w().all('lotOutlines').length;
    await page.getByRole('button', { name: /^Remove:/ }).click();
    expect(areaRows().elements()).toHaveLength(0);
    await expect.poll(overlayIds).not.toContain(OUTLINE_LAYER_ID);
    await expect.element(undoButton()).toHaveAccessibleName('Undo: Removed: 6 stories');
    await undoButton().click();
    await expect.element(areaRows().first()).toHaveAttribute('aria-pressed', 'false');
    await frames();
    expect(overlayIds()).not.toContain(OUTLINE_LAYER_ID);
    expect(w().all('lotOutlines')).toHaveLength(asked);
  });
});

describe('SimPage map selection guards', () => {
  const X = { lng: -122.42, lat: 37.76 };
  function tapLot(): void {
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    stub.map.fire('click', { lngLat: X });
  }
  function answer(policy: string | null, n?: number): void {
    const all = w().all('lotAt');
    const req = n === undefined ? all.at(-1)! : all[n - 1];
    const owner = policy === null ? { kind: 'fzp' } : { kind: 'paint', policy };
    emit({
      type: 'lotAt',
      reqId: req.reqId,
      result: { ok: true, parcelId: 'X', owner: owner as unknown as LimitOwner }
    });
  }
  async function ready() {
    await opened({ storage: () => seeded(doc4(zoning(painted, sunset))) });
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
  }

  it('only the latest click answer counts', async () => {
    await ready();
    tapLot();
    tapLot();
    expect(w().all('lotAt')).toHaveLength(2);
    answer('sunset', 2);
    await expect.element(inspectorTitle()).toHaveTextContent('Sunset paint');
    answer('mission', 1);
    await frames();
    await expect.element(inspectorTitle()).toHaveTextContent('Sunset paint');
    // An older answer arriving before the latest one is dropped too.
    tapLot();
    tapLot();
    answer('mission', 3);
    await frames();
    await expect.element(inspectorTitle()).toHaveTextContent('Sunset paint');
    answer('mission', 4);
    await expect.element(inspectorTitle()).toHaveTextContent('Mission paint');
  });

  it('a no-session answer changes nothing', async () => {
    await ready();
    tapLot();
    answer('mission');
    await expect.element(inspectorTitle()).toHaveTextContent('Mission paint');
    tapLot();
    emit({
      type: 'lotAt',
      reqId: w().lastOf('lotAt')!.reqId,
      result: { ok: false, reason: 'no-session', message: 'x' }
    });
    await frames();
    await expect.element(inspectorTitle()).toHaveTextContent('Mission paint');
  });

  it('the plan selects its fixed row; no lot clears the selection', async () => {
    await ready();
    tapLot();
    answer(null);
    await expect.element(inspectorTitle()).toHaveTextContent('Current law');
    tapLot();
    emit({
      type: 'lotAt',
      reqId: w().lastOf('lotAt')!.reqId,
      result: { ok: true, parcelId: null, owner: null }
    });
    await expect.element(inspector()).not.toBeInTheDocument();
  });

  /** A press on the map's canvas (a pointer down, mouse or touch). */
  const press = (pointerType: string) =>
    stub.map.getCanvas().dispatchEvent(new PointerEvent('pointerdown', { pointerType }));

  it('a touch tap on a lot selects: the mouse events a tap sends after it keep the miss', async () => {
    await ready();
    // A tap's events in order: its press, the miss (SimMap picks on the pointer's release), then
    // the mousedown and click the browser sends for a tap.
    press('touch');
    stub.map.fire('touchstart');
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    stub.map.fire('mousedown');
    stub.map.fire('click', { lngLat: X });
    await expect.poll(() => w().all('lotAt')).toHaveLength(1);
  });

  it('a miss whose click never came is forgotten at the next press', async () => {
    await ready();
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    // The next tap lands on a building: its press, its card, its click.
    press('mouse');
    stub.map.fire('mousedown');
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    stub.map.fire('click', { lngLat: X });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    expect(w().all('lotAt')).toHaveLength(0);
  });

  it('a stroke tool selects nothing on a tap', async () => {
    await ready();
    await toolKey('b');
    await expect.poll(() => stub.props.tapCards).toBe(false);
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    stub.map.fire('click', { lngLat: X });
    await toolKey('v');
    tapLot();
    // Only the Move tap asked.
    await expect.poll(() => w().all('lotAt')).toHaveLength(1);
  });

  it('the listener goes with a replaced map and on unmount', async () => {
    const r = await opened();
    const old = stub.map;
    await expect.poll(() => old.listenerCount('click')).toBe(1);
    stub.map = new FakeMap();
    stub.fireReady();
    expect(old.listenerCount('click')).toBe(0);
    expect(old.listenerCount('mousedown')).toBe(0);
    expect(stub.map.listenerCount('click')).toBe(1);
    await r.unmount();
    expect(stub.map.listenerCount('click')).toBe(0);
  });
});

describe('SimPage autosave and publish', () => {
  const SIM = copyFor('sim');
  const publish = () => page.getByTestId('publish-open');
  const addHistoric = async () => {
    await page.getByRole('button', { name: PLUS_NAME.Zoning }).click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
  };

  it('quota errors show Autosave off and recover', async () => {
    const mem = new MemoryStorage();
    await opened({ storage: () => mem });
    await expect
      .element(header().getByTestId('save-state'))
      .toHaveAttribute('data-save-status', 'saved');
    mem.failWrites = true;
    await addHistoric();
    await expect
      .element(header().getByTestId('save-state'))
      .toHaveAttribute('data-save-status', 'off');
    // The fake worker never refills, so "Updating" covers the chip in the status cell.
    await expect.element(header().getByTestId('tl-status-shown')).toHaveTextContent('Updating');
    await expect.element(header().getByTestId('save-state')).not.toBeVisible();
    // Covered, the save state still announces the change, from a region screen readers reach.
    const live = header().getByTestId('save-live');
    await expect.element(live).toHaveTextContent('Autosave off');
    expect(live.element().closest('[aria-hidden="true"], [inert]')).toBeNull();
    expect(getComputedStyle(live.element()).visibility).toBe('visible');
    mem.failWrites = false;
    await page.getByRole('button', { name: PLUS_NAME.Zoning }).click();
    await page.getByRole('button', { name: 'Protect rent-controlled buildings' }).click();
    await expect
      .element(header().getByTestId('save-state'))
      .toHaveAttribute('data-save-status', 'saved');
    expect(storedDoc(mem).policy.kinds.zoning).toHaveLength(2);
  });

  it('a corrupt record is kept and the page starts on the default', async () => {
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY4, '{nope');
    await opened({ storage: () => mem });
    await expect.element(notices().getByText(SIM.n1)).toBeVisible();
    const kept = mem.keys().filter((k) => k.startsWith('sfhousing:sim:corrupt:'));
    expect(kept).toHaveLength(1);
    expect(mem.getItem(kept[0])).toBe('{nope');
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning());
    await expect.element(publish()).toBeDisabled();
  });

  it('the save state sits in the header status slot, apart from the actions', async () => {
    await page.viewport(375, 700);
    await opened();
    await expect
      .element(header().getByTestId('save-state'))
      .toHaveAttribute('data-save-status', 'saved');
    // Publish waits in the closed Menu with the other actions.
    expect(publish().element().checkVisibility()).toBe(false);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect.element(publish()).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it('a remix hand-off loads the document, toasts once and clears the history state', async () => {
    replaceStateCalls.length = 0;
    const mem = new MemoryStorage();
    await opened({
      storage: () => mem,
      remix: { from: 'SD permits', doc: serializeSimDoc4(doc4(zoning(historic), 'SD permits')) }
    });
    await expect
      .element(notices().getByText("Remixed from SD permits. You're editing your own copy."))
      .toBeVisible();
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    expect(replaceStateCalls).toEqual([{ url: '', state: {} }]);
    expect(storedDoc(mem).title).toBe('SD permits');
  });

  it('Share link after publish, Publish again after an edit', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'AbCdEfGh' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    const mem = new MemoryStorage();
    await opened({ storage: () => mem, fetchFn: fetchFn as unknown as typeof fetch });
    await addHistoric();
    await publish().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabelText('Title').fill('Historic');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .element(dialog.getByLabelText('Link'))
      .toHaveValue(`${location.origin}/s/AbCdEfGh`);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect.element(publish()).toHaveTextContent('Share link');
    const rec = JSON.parse(mem.getItem(SIM_KEY4)!);
    expect(rec.lastPublished.id).toBe('AbCdEfGh');
    expect(JSON.parse(rec.plan).title).toBe('Historic');
    await page.getByRole('button', { name: PLUS_NAME.Zoning }).click();
    await page.getByRole('button', { name: 'Protect rent-controlled buildings' }).click();
    await expect.element(publish()).toHaveTextContent('Publish');
  });

  describe('the header score', () => {
    const scoreBar = () => header().getByTestId('score-bar');
    const details = () => page.getByTestId('tl-details');
    const activity = () => page.getByTestId('tl-activity');
    const column = () => page.getByTestId('tl-inspector');

    it('from md Activity shows at rest, and the header score has no aria-expanded', async () => {
      await opened();
      await expect.element(activity()).toBeVisible();
      expect(details().elements()).toHaveLength(0);
      expect(scoreBar().element().hasAttribute('aria-expanded')).toBe(false);
      expect(scoreBar().element().getAttribute('aria-controls')).toBe(
        page.getByTestId('tl-inspector').element().id
      );
    });

    it('the header score from md opens Details and clears a selection', async () => {
      await opened({ storage: () => seeded(doc4(zoning(historic))) });
      await openZoning();
      await page.getByTestId('tl-bar').first().click();
      await expect.element(inspector()).toBeVisible();
      await scoreBar().click();
      await expect.poll(() => inspector().elements().length).toBe(0);
      await expect.element(details()).toBeVisible();
      expect(
        page
          .getByTestId('tl-bar')
          .and(page.getByRole('button', { pressed: true }))
          .elements()
      ).toHaveLength(0);
      await expect.poll(() => document.activeElement).toBe(details().element());
    });

    it('from md the header score discards an open pool draft and says so', async () => {
      await opened();
      await page.getByRole('button', { name: PLUS_NAME['Public money'] }).click();
      await page.getByRole('button', { name: 'Your own pool' }).click();
      await expect.element(inspectorTitle()).toHaveTextContent('Your own pool');
      await scoreBar().click();
      await expect.poll(() => inspector().elements().length).toBe(0);
      await expect.element(page.getByText(DRAFT_DISCARDED)).toBeInTheDocument();
      await expect.element(details()).toBeVisible();
    });

    it('from md with nothing open the header score scrolls Details to the top and focuses it', async () => {
      await opened();
      const col = page.getByTestId('tl-inspector').element();
      col.scrollTop = 200;
      await scoreBar().click();
      await expect.poll(() => col.scrollTop).toBe(0);
      await expect.poll(() => document.activeElement).toBe(details().element());
    });

    it('from md a bar selected after the header score opens its editor at the top', async () => {
      await opened({ storage: () => seeded(doc4(zoning(historic))) });
      await openZoning();
      await scoreBar().click();
      await expect.element(details()).toBeVisible();
      const col = page.getByTestId('tl-inspector').element();
      await expect.poll(() => col.scrollHeight - col.clientHeight).toBeGreaterThan(100);
      col.scrollTop = 100;
      expect(col.scrollTop).toBe(100);
      await page.getByTestId('tl-bar').first().click();
      await expect.element(inspector()).toBeVisible();
      await expect.poll(() => col.scrollTop).toBe(0);
    });

    it('selecting a policy shows its editor; closing it returns to the rest face', async () => {
      await opened({ storage: () => seeded(doc4(zoning(historic))) });
      await openZoning();
      await scoreBar().click();
      await expect.element(details()).toBeVisible();
      await page.getByTestId('tl-bar').first().click();
      await expect.element(inspector()).toBeVisible();
      expect(details().elements()).toHaveLength(0);
      await page.getByRole('button', { name: 'Close editor' }).click();
      await expect.poll(() => inspector().elements().length).toBe(0);
      await expect.element(activity()).toBeVisible();
      expect(details().elements()).toHaveLength(0);
    });

    it("a starter adds its policy at the playhead's month, selects it and announces Added: Transit rule", async () => {
      await opened();
      const starter = activity().getByRole('button', { name: 'Taller near transit' });
      await expect.element(starter).toBeVisible();
      await starter.click();
      await expect.element(inspectorTitle()).toHaveTextContent('Transit rule');
      const added = debug().policy.kinds.zoning;
      expect(added).toHaveLength(1);
      expect(added[0].where.tag).toBe('transit');
      // The playhead is at today: the add menu's month, the window's first.
      expect(added[0].spans.map((x) => [x.from, x.to])).toEqual([
        [monthFirstDay(asOf, viewMonthOf(asOf, debug().day)), null]
      ]);
      expect(added[0].spans[0].from).toBe(M(1));
      // One undoable change, named as the "+" menu names it, and announced.
      await expect.element(undoButton()).toHaveAccessibleName(/Added: Transit rule/);
      await expect
        .element(page.getByRole('status').filter({ hasText: 'Added: Transit rule' }))
        .toBeInTheDocument();
      // Selected: its bar is pressed (the kind opened) and focus is on the editor's title.
      await expect
        .element(page.getByTestId('tl-kind-zoning').getByRole('button', { pressed: true }))
        .toBeVisible();
      await expect.poll(() => document.activeElement).toBe(inspectorTitle().element());
      // Undo takes it back, and the starters return with nothing in force.
      await undoButton().click();
      await expect.poll(() => debug().policy.kinds.zoning.length).toBe(0);
      await expect.element(starter).toBeVisible();
    });

    it('a starter a funding limit refuses adds nothing and announces the limit', async () => {
      // The pool limit filled by policies that are off: nothing is in force, so starters show.
      const pools = Array.from({ length: FINANCE_LIMITS.pools }, (_, i) => ({
        ...BOND_POLICY.funding.pools[0],
        id: `u-pool-${i + 1}`
      }));
      const money = upgradePolicy(policyWith({ pools, programmes: [] }), asOf).kinds.money.map(
        (p) => ({ ...p, on: false })
      );
      await opened({
        storage: () => seeded(doc4({ schema: 4, kinds: { zoning: [], permitting: [], money } }))
      });
      const starter = activity().getByRole('button', { name: 'A housing bond' });
      await expect.element(starter).toBeVisible();
      const before = debug().policy;
      await starter.click();
      await expect
        .element(page.getByRole('status').filter({ hasText: limitAlert('pools') }))
        .toBeInTheDocument();
      expect(debug().policy).toEqual(before);
      expect(inspector().elements()).toHaveLength(0);
    });

    it("Activity's Details opens Details and focuses it", async () => {
      await opened();
      await activity().getByRole('button', { name: 'Details' }).click();
      await expect.element(details()).toBeVisible();
      expect(activity().elements()).toHaveLength(0);
      await expect.poll(() => document.activeElement).toBe(details().element());
    });

    it('from md the header pressed again on Details keeps its chart view and focus', async () => {
      await opened();
      await scoreBar().click();
      await expect.element(details()).toBeVisible();
      const source = details().getByRole('radio', { name: 'By source' });
      await source.click();
      await expect
        .element(page.getByTestId('tl-lanes').getByRole('figure'))
        .toHaveAttribute('data-lens', 'source');
      const el = details().element();
      await scoreBar().click();
      await expect.poll(() => document.activeElement).toBe(el);
      // The same Details, not a new one: the chosen view stays.
      expect(details().element()).toBe(el);
      await expect.element(source).toBeChecked();
      await expect
        .element(page.getByTestId('tl-lanes').getByRole('figure'))
        .toHaveAttribute('data-lens', 'source');
    });

    it("Details' Activity button shows Activity; below md it opens Activity in the sheet", async () => {
      await opened();
      await scoreBar().click();
      await details().getByRole('button', { name: 'Activity' }).click();
      await expect.element(activity()).toBeVisible();
      expect(details().elements()).toHaveLength(0);
      await expect.poll(() => document.activeElement).toBe(activity().element());
      // Closing Details put the chart back on Homes.
      await expect
        .element(page.getByTestId('tl-lanes').getByRole('figure'))
        .toHaveAttribute('data-lens', 'homes');
    });

    it('below md Details and Activity share the sheet, each reaching the other', async () => {
      await page.viewport(375, 700);
      await opened();
      expect(activity().elements()).toHaveLength(0);
      await scoreBar().click();
      await expect.element(details()).toBeVisible();
      await details().getByRole('button', { name: 'Activity' }).click();
      await expect.element(column().getByTestId('tl-activity')).toBeVisible();
      expect(details().elements()).toHaveLength(0);
      await expect.poll(() => document.activeElement).toBe(activity().element());
      // The sheet is open: the header score says so, and pressing it closes the sheet.
      await expect.element(scoreBar()).toHaveAttribute('aria-expanded', 'true');
      await activity().getByRole('button', { name: 'Details' }).click();
      await expect.element(details()).toBeVisible();
      await expect.poll(() => document.activeElement).toBe(details().element());
      await details().getByRole('button', { name: 'Activity' }).click();
      await expect.element(activity()).toBeVisible();
      await scoreBar().click();
      await expect.element(scoreBar()).toHaveAttribute('aria-expanded', 'false');
      expect(activity().elements()).toHaveLength(0);
      expect(column().elements()).toHaveLength(0);
    });

    it('below md the header score toggles the Details sheet; aria-expanded follows it', async () => {
      await page.viewport(375, 700);
      await opened();
      await expect.element(scoreBar()).toHaveAttribute('aria-expanded', 'false');
      expect(details().elements()).toHaveLength(0);
      await scoreBar().click();
      await expect.element(scoreBar()).toHaveAttribute('aria-expanded', 'true');
      await expect.element(details()).toBeVisible();
      await scoreBar().click();
      await expect.element(scoreBar()).toHaveAttribute('aria-expanded', 'false');
      expect(details().elements()).toHaveLength(0);
    });
  });
});
