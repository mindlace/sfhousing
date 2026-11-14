/// <reference types="@vitest/browser-playwright" />
// /sim on the timeline (timeline-ui Task 14): the page opens the autosaved schema 4 document (a v1
// schema 3 one migrated, upgraded), edits it through the inspector and the map's tools, undoes
// through the store, reverts a rejected edit, publishes schema 4, and in view mode edits nothing.
// The real TimelineMode, session and client run over a fake timeline worker; SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { REAL_ACTUAL } from '$lib/fzp/fixtures/cards';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { stub } from '$lib/fzp/test/sim-map-stub';
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
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { DEFAULT_POLICY, SIM_CODEC, SIM_KEY, type SimDoc } from './sim-doc';
import type SimPage from './SimPage.svelte';
import SimPageHost from './test/SimPageHost.svelte';

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
    const add = page.getByRole('button', { name: 'Add Permitting policy' });
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
    const add = page.getByRole('button', { name: 'Add Zoning policy' });
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
    await page.getByRole('button', { name: 'Add Zoning policy' }).click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(errorMsg(2, 'bad-request'));
    await expect.element(page.getByTestId('tl-alerts')).toHaveTextContent(CHANGE_NOT_APPLIED);
    await expect.poll(() => debug().policy.kinds.zoning).toEqual([]);
    // Undone in the store's history: nothing left to undo, the edit to redo.
    await expect.element(undoButton()).toBeDisabled();
    await expect.element(redoButton()).toBeEnabled();
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
    await page.getByRole('button', { name: 'Add Zoning policy' }).click();
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

  it('the view menu is offered at all times', async () => {
    const viewButton = () => header().getByRole('button', { name: 'View', exact: true });
    const r = await opened();
    await expect.element(viewButton()).toBeVisible();
    // After an edit and mid-refill: still there.
    await page.getByRole('button', { name: 'Add Zoning policy' }).click();
    await page.getByRole('button', { name: 'Protect historic buildings' }).click();
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 3));
    await expect.element(viewButton()).toBeVisible();
    await r.unmount();
    await opened({ mode: 'view', persist: 'off', initialText: serializeSimDoc4(doc4(zoning())) });
    await expect.element(viewButton()).toBeVisible();
    await userEvent.click(viewButton());
    await expect.element(page.getByRole('checkbox', { name: /height limits/i })).toBeVisible();
  });
});
