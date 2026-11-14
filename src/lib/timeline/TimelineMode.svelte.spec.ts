// TimelineMode composition (timeline-ui rules 1, 18-36): the real TimelineSession and
// TimelineClient over a fake worker, a recording SimMap stub, and the header slots from a host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { REAL_ACTUAL } from '$lib/fzp/fixtures/cards';
import { CALCULATING } from '$lib/fzp/score-view';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { formatCount } from '$lib/scoreboard/format';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { viewOf } from '$lib/sim/world/score/view';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { ParcelSummary, ProjectCard } from '$lib/sim/protocol';
import type { Day } from '$lib/timelapse/time';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { CHANGE_NOT_APPLIED, STALE_NOTE, UPDATING } from './copy';
import { fillStatusText } from './fill';
import { filledEndDay } from './playhead';
import { DEFAULT_POLICY4, queriesOf4, type Policy, type SimPolicy4 } from './policy4';
import { headerOf } from './results';
import { dayPct } from './rows';
import type { Lots } from './session.svelte';
import {
  FakeTimelineWorker,
  compiledMsg,
  errorMsg,
  filledMsg,
  refillMsg
} from './test/fake-timeline-worker';
import { chunk, statics as baseStatics } from './test/fixtures';
import TimelineModeHost from './test/TimelineModeHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));

const manifest: Manifest = parseManifest(manifestJson);
const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const MONTHS: Day[] = Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const STATICS: ScoreStatics = { ...baseStatics({ lastIndex: LAST }), asOf, months: MONTHS };
const windowEnd = monthLastDay(asOf, WINDOW_MONTHS);

const protect = (years: number): Policy => ({
  id: 'a',
  label: 'Protect',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'newerThan' },
  spans: [{ from: monthFirstDay(asOf, 2), to: null, what: { tag: 'protect', years } }]
});
const painted: Policy = {
  id: 'paint',
  label: 'Mission paint',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [
    {
      from: monthFirstDay(asOf, 2),
      to: null,
      what: {
        tag: 'brushes',
        brushes: [
          {
            id: 'b1',
            kind: 'paint',
            strokes: [{ path: [[-122.4, 37.7]], radiusM: 50 }],
            stories: 5
          }
        ]
      }
    }
  ]
};
const mk = (...zoning: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money: [] }
});
const withPaint = mk(painted);
const paintLots: Lots = Object.fromEntries(queriesOf4(withPaint).map((q) => [q.key, ['p1']]));

type Over = Partial<{
  noScenario: boolean;
  initialPolicy: SimPolicy4;
  initialLots: Lots | null;
  onmiss: () => void;
  onundoto: (p: SimPolicy4) => void;
  withInspector: boolean;
  scoreControls: string;
  statusMs: number;
}>;

let workers: FakeTimelineWorker[];
const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

function setup(over: Over = {}) {
  const ctl: { setPolicy?: (p: SimPolicy4) => void; setLots?: (l: Lots | null) => void } = {};
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
      noScenario: over.noScenario ?? false,
      datasetVersion: 'fixture-0',
      reload: async () => ({ manifest, calibration: cal }),
      createWorker,
      initialPolicy: over.initialPolicy ?? DEFAULT_POLICY4,
      initialLots: over.initialLots === undefined ? {} : over.initialLots,
      ctl,
      statusMs: over.statusMs ?? 0,
      ...(over.onmiss ? { onmiss: over.onmiss } : {}),
      ...(over.onundoto ? { onundoto: over.onundoto } : {}),
      ...(over.withInspector ? { withInspector: true } : {}),
      ...(over.scoreControls ? { scoreControls: over.scoreControls } : {})
    }
  });
  return {
    r,
    createWorker,
    setPolicy: (p: SimPolicy4) => ctl.setPolicy!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l)
  };
}

/** Opened, compiled and filled through `through` at rev 1. */
async function opened(through = LAST, over: Over = {}) {
  const s = setup(over);
  await expect.poll(() => workers.length).toBe(1);
  await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
  emit(compiledMsg(1, STATICS));
  emit(filledMsg(1, 0, through + 1));
  return s;
}

const debug = () => window.__sfhFzp!;
const playButton = () => page.getByTestId('tl-play');
const scoreBar = () => page.getByTestId('score-bar');
/** The one live region of the status (rule 32), the same at every width. */
const statusSlot = () => page.getByTestId('tl-status-live');
const slider = () => page.getByRole('slider', { name: 'Date in the simulation' });

function summary(project?: ProjectCard): ParcelSummary {
  return {
    parcelId: 'p1',
    neighborhood: 'Mission',
    landUse: 'residential',
    eligible: true,
    existingUnits: 2,
    envelope: null,
    generated: null,
    ...(project && { project })
  };
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

describe('TimelineMode', () => {
  it('renders map, then timeline; no worker and no timeline without a scenario', async () => {
    const none = setup({ noScenario: true });
    await expect.element(page.getByTestId('fzp-sim-map-stub')).toBeInTheDocument();
    await expect.element(page.getByTestId('fzp-status')).toHaveTextContent("isn't available");
    expect(document.querySelector('[data-testid=tl-dock]')).toBeNull();
    expect(none.createWorker).not.toHaveBeenCalled();
    expect(debug().phase).toBe('no-scenario');
    (await none.r).unmount();

    setup();
    await expect.element(page.getByTestId('fzp-sim-map-stub')).toBeInTheDocument();
    await expect.element(page.getByTestId('tl-dock')).toBeInTheDocument();
    await expect.element(page.getByTestId('tl-timeline')).toBeInTheDocument();
    expect(workers).toHaveLength(1);
    expect(w().lastOf('openTimeline')?.policy).toEqual(DEFAULT_POLICY4);
    await expect.element(page.getByTestId('fzp-status')).toHaveTextContent('Loading');
  });

  it('nothing plays on open; the playhead is at the dataset date', async () => {
    await opened();
    await expect.element(slider()).toBeInTheDocument();
    expect(debug().day).toBe(asOf);
    expect(debug().playing).toBe(false);
    expect(debug().filledThrough).toBe(LAST);
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'false');
    expect(debug().playing).toBe(false);
    expect(callsOf('setTime').at(-1)).toEqual([asOf]);
  });

  it('an edit pauses playback and Play is unavailable until filledThrough === lastIndex', async () => {
    const s = await opened();
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'false');
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(true);

    s.setPolicy(mk(protect(5)));
    await expect.poll(() => debug().playing).toBe(false);
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'true');
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 5));
    emit(filledMsg(2, 5, 10));
    await expect.poll(() => debug().filledThrough).toBe(14);
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'true');
    emit(filledMsg(2, 15, LAST - 14));
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'false');
    expect(debug().policy).toEqual(mk(protect(5)));
  });

  it('filled to lastIndex, End reaches the window end: Play reads Replay, no hatch remains', async () => {
    await opened();
    await expect.element(slider()).toHaveAttribute('aria-valuemax', String(windowEnd));
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect.poll(() => debug().day).toBe(windowEnd);
    await expect.element(page.getByTestId('tl-play-label')).toHaveTextContent('Replay');
    expect(document.querySelectorAll('[data-testid=tl-hatch]')).toHaveLength(0);
  });

  it('sends viewMonth when the playhead enters another month', async () => {
    await opened();
    await expect
      .poll(() =>
        w()
          .all('viewMonth')
          .map((v) => v.month)
      )
      .toEqual([1]);
    (slider().element() as HTMLElement).focus();
    // Model months start on the dataset date's day: two calendar steps reach model month 2.
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect
      .poll(() =>
        w()
          .all('viewMonth')
          .map((v) => v.month)
      )
      .toEqual([1, 2]);
    expect(callsOf('setTime').at(-1)?.[0]).toBe(debug().day);
  });

  it('onResyncNeeded calls resyncMap', async () => {
    await opened();
    await expect.poll(() => stub.resyncCb).not.toBeNull();
    expect(w().all('resyncMap')).toHaveLength(0);
    stub.resyncCb!();
    expect(w().all('resyncMap')).toHaveLength(1);
  });

  it('the status slot says Updating while stale, then Forecast filled to …, then nothing', async () => {
    const s = await opened(5);
    const partly = fillStatusText(viewOf([chunk(0, 6)], STATICS));
    expect(partly).toMatch(/^Forecast filled to \d{4}$/);
    await expect.element(statusSlot()).toHaveTextContent(partly);
    emit(filledMsg(1, 6, LAST - 5));
    await expect.poll(() => statusSlot().element().textContent?.trim()).toBe('');

    s.setPolicy(mk(protect(5)));
    await expect.element(statusSlot()).toHaveTextContent(UPDATING);
    // The explanation waits behind the status (rule 31, F12).
    await expect
      .element(page.getByTestId('tl-status-line').getByRole('button', { name: UPDATING }))
      .toBeInTheDocument();
    expect(debug().stale).toBe(true);
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 3));
    const refilling = fillStatusText(viewOf([chunk(0, 3)], STATICS));
    await expect.element(statusSlot()).toHaveTextContent(refilling);
    expect(debug().stale).toBe(false);
    emit(filledMsg(2, 3, LAST - 2));
    await expect.poll(() => statusSlot().element().textContent?.trim()).toBe('');
  });

  it('rows are hatched past the filled end and the hatch moves after a refill', async () => {
    // Filled short of the last month (filled to it, no hatch remains: the test above).
    const s = await opened(LAST - 1);
    const hatches = () => [...document.querySelectorAll<HTMLElement>('[data-testid=tl-hatch]')];
    const at = (through: number) => dayPct(filledEndDay(MONTHS, through, asOf), asOf, windowEnd);
    await expect.poll(() => hatches().length).toBeGreaterThan(2);
    for (const h of hatches()) expect(parseFloat(h.style.left)).toBeCloseTo(at(LAST - 1), 1);

    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 10));
    // The unfilled part moves back to the refill point.
    await expect.poll(() => parseFloat(hatches()[0].style.left)).toBeCloseTo(at(9), 1);
    for (const h of hatches()) expect(parseFloat(h.style.left)).toBeCloseTo(at(9), 1);
    emit(filledMsg(2, 10, 4));
    await expect.poll(() => parseFloat(hatches()[0].style.left)).toBeCloseTo(at(13), 1);
  });

  it('a provisional open keeps the header calculating until the full document fills', async () => {
    const s = setup({ initialPolicy: withPaint, initialLots: null });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    // The open went out without the brushes (OQ-3).
    expect(w().lastOf('openTimeline')!.policy.kinds.zoning).toHaveLength(0);
    emit(compiledMsg(1, STATICS));
    emit(filledMsg(1, 0, LAST + 1));
    await expect.element(scoreBar()).toHaveTextContent(CALCULATING);
    expect(debug().stale).toBe(true);

    s.setLots(paintLots);
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(w().lastOf('setPolicy')!.policy).toEqual(withPaint);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 2));
    await expect.element(scoreBar()).toHaveTextContent(CALCULATING);
    emit(filledMsg(2, 2, LAST - 1));
    const total = headerOf(viewOf([chunk(0, LAST + 1)], STATICS)).total!;
    await expect.element(scoreBar()).toHaveTextContent(formatCount(total));
    expect(debug().stale).toBe(false);
  });

  it('the header shows calculating, then baseline plus the average at lastIndex', async () => {
    await opened(10);
    await expect.element(scoreBar()).toHaveTextContent(CALCULATING);
    emit(filledMsg(1, 11, LAST - 10));
    const view = viewOf([chunk(0, LAST + 1)], STATICS);
    const total = view.baseline.completedNet + Math.round(view.mean[LAST].completedNet);
    expect(headerOf(view).total).toBe(total);
    await expect.element(scoreBar()).toHaveTextContent(`${formatCount(total)} homes`);
    await expect.element(scoreBar()).toHaveTextContent(`by ${utcParts(MONTHS[LAST]).y}`);
  });

  it('an open card is dimmed while stale and asks again once the refill covers its day', async () => {
    const s = await opened();
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    w().emit({ type: 'parcelSummary', reqId: req.reqId, summary: summary(REAL_ACTUAL) });
    const card = page.getByTestId('tl-card');
    await expect.element(card.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(card.element().hasAttribute('data-stale')).toBe(false);

    s.setPolicy(mk(protect(5)));
    await expect.element(card).toHaveAttribute('data-stale', 'true');
    // Dimmed as muted ink (AA), not by opacity.
    expect(getComputedStyle(card.element().querySelector('h2')!).color).toBe('rgb(75, 85, 99)');
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    // Nothing covers the card's month yet: no new question.
    await expect.poll(() => debug().filledThrough).toBe(-1);
    expect(w().all('parcelSummary')).toHaveLength(1);
    emit(filledMsg(2, 0, 3));
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(2);
    expect(w().lastOf('parcelSummary')).toMatchObject({ parcelId: 'p1', day: asOf });
    await expect.poll(() => card.element().hasAttribute('data-stale')).toBe(false);
  });

  it('a miss tap calls onmiss and opens no card', async () => {
    const onmiss = vi.fn();
    await opened(LAST, { onmiss });
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: null, kind: 'tap' });
    expect(onmiss).toHaveBeenCalledTimes(1);
    expect(w().all('parcelSummary')).toHaveLength(0);
    expect(page.getByTestId('tl-card').element().querySelector('section')).toBeNull();
    // A hover miss is not a tap.
    stub.props.timelinePick!({ projectId: null, kind: 'hover' });
    expect(onmiss).toHaveBeenCalledTimes(1);
  });

  it("on a phone a kind's sheet ends where the mode's box ends, above what follows it", async () => {
    await page.viewport(390, 760);
    await opened();
    await page.getByRole('button', { name: /^Permitting/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' });
    await expect.element(sheet).toBeVisible();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const end = page.getByTestId('tl-mode').element().getBoundingClientRect().bottom;
    expect(end).toBeLessThan(760);
    expect(Math.abs(sheet.element().getBoundingClientRect().bottom - end)).toBeLessThanOrEqual(0.5);
  });

  it('on a phone the playhead and chart stay above an open kind sheet', async () => {
    await page.viewport(390, 760);
    await opened();
    await expect.element(slider()).toBeInTheDocument();
    await page.getByRole('button', { name: /^Permitting/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Permitting' });
    await expect.element(sheet).toBeVisible();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const top = sheet.element().getBoundingClientRect().top;
    const s = slider().element().getBoundingClientRect();
    const chart = page.getByTestId('tl-dock').getByRole('figure').element().getBoundingClientRect();
    expect(s.top).toBeGreaterThanOrEqual(0);
    expect(s.bottom).toBeLessThanOrEqual(top + 0.5);
    expect(chart.top).toBeGreaterThanOrEqual(0);
    expect(chart.bottom).toBeLessThanOrEqual(top + 0.5);
  });

  it('a rejected edit undoes through onundoto to the last accepted document', async () => {
    const onundoto = vi.fn<(p: SimPolicy4) => void>();
    const s = await opened(LAST, { onundoto });
    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(errorMsg(2, 'bad-request'));
    await expect.poll(() => onundoto.mock.calls).toEqual([[DEFAULT_POLICY4]]);
    await expect.element(page.getByTestId('tl-alerts')).toHaveTextContent(CHANGE_NOT_APPLIED);
  });

  it("on a phone the inspector sheet ends where the mode's box ends, above what follows it", async () => {
    // The host's mode box ends at 748 px of a 760 px viewport: the page's footer follows it.
    await page.viewport(390, 760);
    await opened(LAST, { withInspector: true });
    const insp = page.getByTestId('tl-inspector');
    await expect.element(insp.getByTestId('host-inspector')).toBeVisible();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const end = page.getByTestId('tl-mode').element().getBoundingClientRect().bottom;
    expect(end).toBeLessThan(760);
    expect(Math.abs(insp.element().getBoundingClientRect().bottom - end)).toBeLessThanOrEqual(0.5);
  });

  it('on a phone the playhead and chart stay above an open inspector sheet', async () => {
    await page.viewport(390, 760);
    await opened(LAST, { withInspector: true });
    const insp = page.getByTestId('tl-inspector');
    await expect.element(insp.getByTestId('host-inspector')).toBeVisible();
    await expect.element(slider()).toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const top = insp.element().getBoundingClientRect().top;
    const s = slider().element().getBoundingClientRect();
    const chart = page.getByTestId('tl-dock').getByRole('figure').element().getBoundingClientRect();
    expect(s.top).toBeGreaterThanOrEqual(0);
    expect(s.bottom).toBeLessThanOrEqual(top + 0.5);
    expect(chart.top).toBeGreaterThanOrEqual(0);
    expect(chart.bottom).toBeLessThanOrEqual(top + 0.5);
  });

  it('while stale the map canvas, Results, card and header dim; their controls keep full contrast', async () => {
    const s = await opened(LAST, { withInspector: true });
    const canvas = document.createElement('canvas');
    canvas.className = 'maplibregl-canvas';
    page.getByTestId('fzp-sim-map-stub').element().appendChild(canvas);
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    w().emit({ type: 'parcelSummary', reqId: req.reqId, summary: summary(REAL_ACTUAL) });
    await expect
      .element(page.getByTestId('tl-card').getByRole('heading', { level: 2 }))
      .toBeInTheDocument();
    const net = page.getByTestId('fzp-net');
    await expect.element(net).toBeInTheDocument();
    const fresh = getComputedStyle(net.element()).color;

    s.setPolicy(mk(protect(5)));
    await expect.element(page.getByTestId('tl-map')).toHaveAttribute('data-stale', 'true');
    // The map's picture dims; the map, its controls and the controls over it do not.
    expect(getComputedStyle(canvas).opacity).toBe('0.6');
    const opacityOf = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement)
        o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const controls = [
      ...document.querySelectorAll(
        '[data-testid=tl-results] button, [data-testid=tl-card] button, [data-testid=header-pinned] button, [data-testid=fzp-sim-map-stub]'
      )
    ];
    expect(controls.length).toBeGreaterThan(3);
    for (const c of controls) expect(opacityOf(c)).toBe(1);
    // Text dims to the muted ink, which keeps AA contrast.
    await expect.poll(() => getComputedStyle(net.element()).color).not.toBe(fresh);
    expect(getComputedStyle(net.element()).color).toBe('rgb(75, 85, 99)');
    expect(getComputedStyle(scoreBar().element()).color).toBe('rgb(75, 85, 99)');
    const cardText = page.getByTestId('tl-card').getByRole('heading', { level: 2 }).element();
    expect(getComputedStyle(cardText).color).toBe('rgb(75, 85, 99)');
  });

  it('the status slot changes at most once a second; the latest text goes out after the gap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      setup({ statusMs: 1000 });
      await tick();
      expect(workers).toHaveLength(1);
      const live = () => statusSlot().element().textContent?.trim();
      emit(compiledMsg(1, STATICS));
      emit(filledMsg(1, 0, 1));
      await tick();
      const first = fillStatusText(viewOf([chunk(0, 1)], STATICS));
      const second = fillStatusText(viewOf([chunk(0, LAST)], STATICS));
      expect(first).not.toBe(second);
      expect(live()).toBe(first);
      emit(filledMsg(1, 1, LAST - 1));
      await tick();
      expect(live()).toBe(first);
      emit(filledMsg(1, LAST, 1));
      await tick();
      expect(live()).toBe(first);
      vi.advanceTimersByTime(999);
      await tick();
      expect(live()).toBe(first);
      vi.advanceTimersByTime(1);
      await tick();
      // The text wanted in between never showed: the latest goes out.
      expect(live()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  for (const [width, place] of [
    [1280, 'line'],
    [1600, 'header']
  ] as const) {
    it(`at ${width} px exactly one live region speaks the status; it shows in the ${place}`, async () => {
      await page.viewport(width, 900);
      await opened(5);
      const partly = fillStatusText(viewOf([chunk(0, 6)], STATICS));
      await expect.element(statusSlot()).toHaveTextContent(partly);
      const speaking = [...document.querySelectorAll('[role="status"], [aria-live]')].filter(
        (el) => el.textContent?.trim() === partly
      );
      expect(speaking).toHaveLength(1);
      const header = page.getByTestId('tl-status');
      const line = page.getByTestId('tl-status-line');
      await expect.element(place === 'header' ? header : line).toBeVisible();
      await expect.element(place === 'header' ? header : line).toHaveTextContent(partly);
      await expect.element(place === 'header' ? line : header).not.toBeVisible();
    });
  }

  it('below 2xl the line under the bar keeps its height as the status comes and goes', async () => {
    const s = await opened(5);
    const line = page.getByTestId('tl-status-line');
    await expect.element(line).toBeVisible();
    const filling = line.element().getBoundingClientRect().height;
    expect(filling).toBeGreaterThanOrEqual(24);
    emit(filledMsg(1, 6, LAST - 5));
    await expect.poll(() => statusSlot().element().textContent?.trim()).toBe('');
    expect(line.element().getBoundingClientRect().height).toBe(filling);
    s.setPolicy(mk(protect(5)));
    await expect.element(statusSlot()).toHaveTextContent(UPDATING);
    expect(line.element().getBoundingClientRect().height).toBe(filling);
    // Just under the header bar, above the map.
    const header = page.getByTestId('header-status').element().parentElement!;
    expect(line.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().bottom - 0.5
    );
  });

  it('the live region holds only the status text; its explanation sits outside it', async () => {
    await page.viewport(390, 760);
    const s = await opened();
    s.setPolicy(mk(protect(5)));
    const live = statusSlot();
    await expect.element(live).toHaveTextContent(UPDATING);
    const slot = page.getByTestId('tl-status-line').element();
    const before = slot.getBoundingClientRect();
    await page.getByTestId('tl-status-line').getByRole('button', { name: UPDATING }).click();
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toHaveTextContent(STALE_NOTE);
    expect(live.element().contains(tip.element())).toBe(false);
    expect(live.element().querySelector('button')).toBeNull();
    expect(live.element().textContent?.trim()).toBe(UPDATING);
    // Open, it does not widen or deepen the line under the bar.
    const after = slot.getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it('the header score controls the inspector only while it shows', async () => {
    const a = await opened(LAST, { scoreControls: 'insp' });
    await expect.element(scoreBar()).toBeInTheDocument();
    expect(scoreBar().element().hasAttribute('aria-controls')).toBe(false);
    (await a.r).unmount();
    workers = [];
    await opened(LAST, { scoreControls: 'insp', withInspector: true });
    await expect.element(scoreBar()).toHaveAttribute('aria-controls', 'insp');
    expect(document.getElementById('insp')).toBe(page.getByTestId('tl-inspector').element());
  });
});
