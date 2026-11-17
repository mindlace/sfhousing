// TimelineMode composition (timeline-ui rules 1, 18-36): the real TimelineSession and
// TimelineClient over a fake worker, a recording SimMap stub, and the header slots from a host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { REAL_ACTUAL } from '$lib/fzp/fixtures/cards';
import { CALCULATING } from '$lib/fzp/score-view';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { lotsText } from '$lib/paint/rows';
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
import { filledEndDay, indexOfDay } from './playhead';
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
import type { Pool } from '$lib/timelapse/types';
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
  onlotsretry: () => void;
  regionHeight: number;
  inspectorOpen: boolean;
  scoreExpanded: boolean;
}>;

let workers: FakeTimelineWorker[];
const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

function setup(over: Over = {}) {
  const ctl: {
    setPolicy?: (p: SimPolicy4) => void;
    setLots?: (l: Lots | null) => void;
    setLotsFailed?: (f: boolean) => void;
    showResults?: () => Promise<void>;
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
      ...(over.onlotsretry ? { onlotsretry: over.onlotsretry } : {}),
      ...(over.withInspector ? { withInspector: true } : {}),
      ...(over.regionHeight ? { regionHeight: over.regionHeight } : {}),
      ...(over.scoreControls ? { scoreControls: over.scoreControls } : {}),
      ...(over.inspectorOpen !== undefined ? { inspectorOpen: over.inspectorOpen } : {}),
      ...(over.scoreExpanded !== undefined ? { scoreExpanded: over.scoreExpanded } : {})
    }
  });
  return {
    r,
    createWorker,
    setPolicy: (p: SimPolicy4) => ctl.setPolicy!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l),
    setLotsFailed: (f: boolean) => ctl.setLotsFailed!(f),
    showResults: () => ctl.showResults!()
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

  for (const width of [1280, 1024, 390]) {
    it(`at ${width} px the ruler, slider, chart, bars and playhead line share one x scale`, async () => {
      await page.viewport(width, 900);
      await opened(LAST, { initialPolicy: mk(protect(5)) });
      await expect.element(slider()).toBeInTheDocument();
      const near = (a: number, b: number, what: string) =>
        expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(1);
      const rect = (el: Element) => el.getBoundingClientRect();
      const lane = rect(document.querySelector('[data-testid=tl-lane]')!);
      const px = (d: Day) => lane.left + (dayPct(d, asOf, windowEnd) / 100) * lane.width;
      const centre = (r: DOMRect) => r.left + r.width / 2;

      const track = rect(slider().element());
      near(track.left, lane.left, 'track left');
      near(track.width, lane.width, 'track width');

      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard('{PageUp}');
      await expect.poll(() => debug().day).toBeGreaterThan(asOf);
      const d = debug().day;
      await expect.poll(() => slider().element().getAttribute('aria-valuenow')).toBe(String(d));

      near(centre(rect(slider().element().querySelector('.thumb')!)), px(d), 'thumb');
      const line = document.querySelector('[data-testid=tl-playhead-line]')!;
      near(centre(rect(line)), px(d), 'playhead line');

      const label = [...document.querySelectorAll('[data-testid=tl-ruler] span')].find(
        (e) => e.textContent?.trim() === String(y + 5)
      )!;
      near(centre(rect(label)), px(dayFromUtc(y + 5, 1, 1)), 'ruler label');

      const chartLine = rect(page.getByTestId('chart-line').element());
      near(chartLine.right, px(MONTHS[indexOfDay(MONTHS, d)]), 'chart line');

      const mini = document.querySelector('[data-testid=tl-kind-zoning] [data-testid=tl-mini] i')!;
      near(rect(mini).left, px(monthFirstDay(asOf, 2)), 'zoning miniature');

      near(
        rect(page.getByTestId('tl-controls').element()).left,
        rect(page.getByTestId('tl-timeline').element()).left,
        'controls'
      );
      near(rect(line).top, rect(page.getByTestId('tl-axis').element()).top, 'pinned line top');
    });
  }

  // Three zoning policies and Permitting open: the rows overflow the lanes' box from md.
  const many = () => mk(protect(5), { ...protect(3), id: 'b' }, { ...protect(2), id: 'c' });
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const rectOf = (id: string) => page.getByTestId(id).element().getBoundingClientRect();

  async function scrolledLanes() {
    await opened(LAST, { initialPolicy: many() });
    await expect.element(slider()).toBeInTheDocument();
    await page.getByRole('button', { name: 'Zoning', exact: true }).click();
    await page.getByRole('button', { name: 'Permitting', exact: true }).click();
    const lanes = page.getByTestId('tl-lanes').element() as HTMLElement;
    expect(lanes.scrollHeight).toBeGreaterThan(lanes.clientHeight);
    lanes.scrollTop = lanes.scrollHeight;
    await frame();
    return lanes;
  }

  it('from md the controls, ruler and chart stay in view while the rows scroll', async () => {
    const lanes = await scrolledLanes();
    expect(lanes.scrollTop).toBeGreaterThan(0);
    const box = lanes.getBoundingClientRect();
    expect(Math.abs(rectOf('tl-pin').top - box.top)).toBeLessThanOrEqual(1);
    const play = rectOf('tl-play');
    expect(play.top).toBeGreaterThanOrEqual(box.top - 0.5);
    expect(play.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
    const hit = document.elementFromPoint(play.left + play.width / 2, play.top + play.height / 2);
    expect(playButton().element().contains(hit)).toBe(true);
  });

  it('from md a focused bar under the pinned block comes into view below it', async () => {
    const lanes = await scrolledLanes();
    const bar = document.querySelector<HTMLElement>(
      '[data-testid=tl-kind-zoning] [data-testid=tl-bar]'
    )!;
    bar.focus();
    await frame();
    const r = bar.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(rectOf('tl-pin').bottom - 0.5);
    expect(r.bottom).toBeLessThanOrEqual(lanes.getBoundingClientRect().bottom + 0.5);
  });

  it('from md a bar scrolled to the top clears the chart by its 24 px target', async () => {
    await scrolledLanes();
    const bar = document.querySelector<HTMLElement>(
      '[data-testid=tl-kind-zoning] [data-testid=tl-bar]'
    )!;
    bar.scrollIntoView({ block: 'start', behavior: 'instant' });
    await frame();
    const r = bar.getBoundingClientRect();
    // WCAG 2.2 2.5.8: the 24 px circle at the bar's centre stays off the chart's slider.
    expect(r.top + r.height / 2 - 12).toBeGreaterThanOrEqual(rectOf('tl-pin').bottom);
  });

  // A short mode box (360 px): on a phone the rows under the pinned block reach past it.
  it('from md focusing the slider or the chart in the pinned block leaves the rows in place', async () => {
    const lanes = await scrolledLanes();
    const at = lanes.scrollTop;
    expect(at).toBeGreaterThan(0);
    (slider().element() as HTMLElement).focus();
    await frame();
    expect(Math.abs(lanes.scrollTop - at)).toBeLessThanOrEqual(1);
    const overlay = page.getByRole('slider', { name: 'Month in the chart' });
    (overlay.element() as HTMLElement).focus();
    await frame();
    expect(Math.abs(lanes.scrollTop - at)).toBeLessThanOrEqual(1);
  });

  it('on a phone focusing the slider in the stuck pinned block leaves the rows in place', async () => {
    await page.viewport(390, 760);
    await opened(LAST, { regionHeight: 360 });
    await expect.element(slider()).toBeInTheDocument();
    const mode = page.getByTestId('tl-mode').element() as HTMLElement;
    mode.scrollTop = mode.scrollHeight;
    await frame();
    expect(Math.abs(rectOf('tl-pin').top - rectOf('tl-status-line').bottom)).toBeLessThanOrEqual(1);
    const at = mode.scrollTop;
    (slider().element() as HTMLElement).focus();
    await frame();
    expect(Math.abs(mode.scrollTop - at)).toBeLessThanOrEqual(1);
  });

  it('on a phone the controls, ruler and chart stick under the status line', async () => {
    await page.viewport(390, 760);
    await opened(LAST, { regionHeight: 360 });
    await expect.element(slider()).toBeInTheDocument();
    const mode = page.getByTestId('tl-mode').element() as HTMLElement;
    mode.scrollTop = mode.scrollHeight;
    await frame();
    expect(mode.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(rectOf('tl-pin').top - rectOf('tl-status-line').bottom)).toBeLessThanOrEqual(1);
    const inView = (r: DOMRect) => {
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(760);
    };
    inView(slider().element().getBoundingClientRect());
    inView(page.getByTestId('tl-dock').getByRole('figure').element().getBoundingClientRect());
  });

  it('on a phone a focused bar under the pinned block comes into view below it', async () => {
    await page.viewport(390, 760);
    await opened(LAST, { regionHeight: 360 });
    await expect.element(slider()).toBeInTheDocument();
    const mode = page.getByTestId('tl-mode').element() as HTMLElement;
    mode.scrollTop = mode.scrollHeight;
    await frame();
    (
      page.getByRole('button', { name: 'Market conditions, whole window' }).element() as HTMLElement
    ).focus();
    await frame();
    const zoning = page
      .getByRole('button', { name: 'Zoning', exact: true })
      .element() as HTMLElement;
    zoning.focus();
    await frame();
    // Chrome centres a focused control it scrolls to; it lands in the padded part of the box.
    expect(zoning.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      rectOf('tl-pin').bottom - 0.5
    );
    expect(zoning.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      rectOf('tl-mode').bottom + 0.5
    );
  });

  it("the chart's readout paints above the playhead line; the line above the bars", async () => {
    await opened(LAST, { initialPolicy: mk(protect(5)) });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    const line = document.querySelector<HTMLElement>('[data-testid=tl-playhead-line]')!;
    // Ten months back the readout starts left of the line and runs across it.
    const overlay = page.getByRole('slider', { name: 'Month in the chart' });
    (overlay.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowLeft>10/}');
    const readout = page.getByTestId('chart-readout');
    await expect.element(readout).toBeVisible();
    const lr = line.getBoundingClientRect();
    const rr = readout.element().getBoundingClientRect();
    const x = lr.left + lr.width / 2;
    expect(rr.left).toBeLessThan(x);
    expect(rr.right).toBeGreaterThan(x);
    // Both ignore the pointer; hit testing follows paint order once they take it.
    const topAt = (els: HTMLElement[], px: number, py: number) => {
      for (const e of els) e.style.pointerEvents = 'auto';
      const top = document.elementFromPoint(px, py);
      for (const e of els) e.style.pointerEvents = '';
      return top;
    };
    const tip = readout.element() as HTMLElement;
    const onTip = topAt([line, tip], x, rr.top + rr.height / 2);
    expect(onTip === tip || tip.contains(onTip)).toBe(true);
    // The rows' segment still paints above a zoning miniature bar it crosses.
    const outer = [...document.querySelectorAll<HTMLElement>('[data-testid=tl-playhead-line]')][1];
    const mini = document.querySelector<HTMLElement>(
      '[data-testid=tl-kind-zoning] [data-testid=tl-mini] i'
    )!;
    const mr = mini.getBoundingClientRect();
    const or = outer.getBoundingClientRect();
    const ox = or.left + or.width / 2;
    expect(mr.left).toBeLessThan(ox);
    expect(mr.right).toBeGreaterThan(ox);
    expect(topAt([outer, mini], ox, mr.top + mr.height / 2)).toBe(outer);
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

  it('the header shows calculating, then baseline plus the world at lastIndex', async () => {
    await opened(10);
    await expect.element(scoreBar()).toHaveTextContent(CALCULATING);
    emit(filledMsg(1, 11, LAST - 10));
    const view = viewOf([chunk(0, LAST + 1)], STATICS);
    const total = view.baseline.completedNet + view.rows[LAST].completedNet;
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

  it("an edit whose brush query fails isn't left stale: the notice's Retry asks again", async () => {
    const onlotsretry = vi.fn();
    const s = await opened(LAST, { onlotsretry });
    const alerts = page.getByTestId('tl-alerts');
    const failedText = lotsText({ kind: 'failed', keys: [] });
    s.setPolicy(mk(protect(5)));
    s.setLots(null);
    await expect.poll(() => debug().stale).toBe(true);
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'true');
    expect(alerts.getByText(failedText).query()).toBeNull();

    // PolicySync settled with a failure: the forecast stays the last sent document's.
    s.setLotsFailed(true);
    await expect.poll(() => debug().stale).toBe(false);
    await expect.element(playButton()).toHaveAttribute('aria-disabled', 'false');
    await expect.poll(() => statusSlot().element().textContent?.trim()).toBe('');
    await expect.element(alerts.getByText(failedText)).toBeVisible();
    expect(w().all('setPolicy')).toHaveLength(0);

    // A further edit that still needs the failed query is not stale either.
    s.setPolicy(mk(protect(7)));
    await expect.poll(() => debug().policy).toEqual(mk(protect(7)));
    expect(debug().stale).toBe(false);

    await alerts.getByRole('button', { name: 'Retry' }).click();
    expect(onlotsretry).toHaveBeenCalledTimes(1);
    // Asked again: the lots arrive and the edit goes out.
    s.setLotsFailed(false);
    await expect.element(alerts.getByText(failedText)).not.toBeInTheDocument();
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(w().lastOf('setPolicy')!.policy).toEqual(mk(protect(7)));
    expect(debug().stale).toBe(true);
  });

  it('the "What … added" label is the shown view\'s: it changes with its numbers', async () => {
    const s = await opened(LAST, { withInspector: true });
    const results = page.getByTestId('tl-results');
    await expect.element(results).toHaveTextContent('What your policy added');
    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    // The first policy in force flips the comparison; its numbers are not in yet.
    emit(compiledMsg(2, { ...STATICS, compare: 'preFzp' }));
    emit(refillMsg(2, 0));
    await expect.poll(() => debug().filledThrough).toBe(-1);
    expect(debug().stale).toBe(true);
    await expect.element(results).toHaveTextContent('What your policy added');
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().stale).toBe(false);
    await expect.element(results).toHaveTextContent('What the plan added');
  });

  it('while stale the money rows read the held document, not the edited one', async () => {
    const bond = (uncapped: boolean): Pool => ({
      id: 'u-bond',
      kind: 'generalRevenue',
      label: 'Housing bond',
      inflows: [{ kind: 'once', day: monthFirstDay(asOf, 2), dollars: 500_000_000 }],
      uncapped,
      debt: null,
      leverage: 1
    });
    const money = (uncapped: boolean): SimPolicy4 => ({
      schema: 4,
      kinds: {
        zoning: [],
        permitting: [],
        money: [
          {
            id: 'm',
            label: 'Bond',
            preset: null,
            on: true,
            where: { tag: 'fund', pool: 'u-bond' },
            spans: [
              {
                from: monthFirstDay(asOf, 2),
                to: null,
                what: { tag: 'fund', pool: bond(uncapped), programmes: [] }
              }
            ]
          }
        ]
      }
    });
    const filledPools = (rev: number) =>
      emit({
        type: 'filled',
        rev,
        through: LAST,
        series: chunk(0, LAST + 1, { pools: ['u-bond'] })
      });
    const FIN: ScoreStatics = {
      ...baseStatics({ lastIndex: LAST, finance: true }),
      asOf,
      months: MONTHS
    };
    const s = setup({ withInspector: true, initialPolicy: money(false) });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, FIN));
    filledPools(1);
    const results = page.getByTestId('tl-results');
    await results.getByRole('button', { name: /Money details/ }).click();
    const received = () => {
      const table = results.getByTestId('fzp-money-sources').element() as HTMLTableElement;
      const r = [...table.tBodies[0].rows].find((x) => x.cells[0].textContent === 'Pool u-bond');
      return r?.cells[1].textContent?.trim();
    };
    await expect.poll(received).toBeTruthy();
    expect(received()).not.toBe('no limit');

    s.setPolicy(money(true));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(debug().stale).toBe(true);
    expect(received()).not.toBe('no limit');
    emit(compiledMsg(2, FIN));
    emit(refillMsg(2, 0));
    filledPools(2);
    await expect.poll(() => debug().stale).toBe(false);
    await expect.poll(received).toBe('no limit');
  });

  it("a crash before the first fill says the simulation couldn't load", async () => {
    // The client logs each crash; silenced here so signoff's stderr check stays clean.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    w().crash();
    const notices = page.getByTestId('tl-notices');
    await expect.element(notices).toHaveTextContent("The simulation couldn't load.");
    expect(notices.element().textContent).not.toContain('Part of the simulation stopped.');
    await notices.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => workers.length).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    w().crash();
    await expect.element(notices).toHaveTextContent('Part of the simulation stopped.');
    expect(err).toHaveBeenCalledWith('[sim] worker crashed', expect.anything());
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
    const chart = page
      .getByTestId('tl-lanes')
      .getByRole('figure')
      .element()
      .getBoundingClientRect();
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

  // ---- the bottom pane (from md: the timeline and the detail column under the map) ----

  const box = (id: string) => page.getByTestId(id).element().getBoundingClientRect();
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  for (const [vw, vh] of [
    [1280, 900],
    [1024, 768]
  ] as const) {
    it(`at ${vw} px the bottom pane holds the timeline and the detail column; the map is the map alone`, async () => {
      await page.viewport(vw, vh);
      await opened(LAST, { withInspector: true, scoreControls: 'insp' });
      await expect.element(page.getByTestId('host-inspector')).toBeVisible();
      await nextFrame();
      const mode = box('tl-mode');
      const dock = box('tl-dock');
      const lanes = box('tl-lanes');
      const insp = box('tl-inspector');
      const map = box('tl-map');
      expect(Math.abs(dock.height - 0.4 * mode.height)).toBeLessThanOrEqual(2);
      expect(insp.top).toBeGreaterThanOrEqual(dock.top - 0.5);
      expect(insp.bottom).toBeLessThanOrEqual(dock.bottom + 0.5);
      expect(insp.left).toBeGreaterThanOrEqual(dock.left - 0.5);
      expect(insp.right).toBeLessThanOrEqual(dock.right + 0.5);
      expect(insp.left).toBeGreaterThanOrEqual(lanes.right - 0.5);
      expect(insp.width).toBeGreaterThanOrEqual(22 * 16 - 0.5);
      expect(Math.abs(map.width - mode.width)).toBeLessThanOrEqual(0.5);
      expect(map.bottom).toBeLessThanOrEqual(dock.top + 0.5);
    });
  }

  it('at 1280x800 at least 90 px of rows show under the pinned block', async () => {
    await page.viewport(1280, 800);
    await opened(LAST, { withInspector: true });
    await expect.element(slider()).toBeInTheDocument();
    await nextFrame();
    expect(box('tl-mode').height).toBe(700);
    expect(box('tl-lanes').bottom - box('tl-pin').bottom).toBeGreaterThanOrEqual(90);
  });

  // The mode box at 1280x720: 636 px on /sim, 585 px on /s/<id> under the shared banner.
  for (const regionHeight of [636, 585]) {
    it(`at 1280x720 (a ${regionHeight} px mode box) the compact pinned block leaves 90 px of rows`, async () => {
      await page.viewport(1280, 720);
      await opened(LAST, { withInspector: true, regionHeight });
      await expect.element(slider()).toBeInTheDocument();
      await nextFrame();
      expect(box('tl-mode').height).toBe(regionHeight);
      expect(box('tl-lanes').bottom - box('tl-pin').bottom).toBeGreaterThanOrEqual(90);
      // Its targets stay at least 24 px tall.
      const pin = page.getByTestId('tl-pin').element();
      for (const el of pin.querySelectorAll('button, [role=slider]'))
        expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    });
  }

  /** The pinned block's scroll box: tl-lanes from md, tl-mode below md (under the status line). */
  function port(phone: boolean): { top: number; bottom: number } {
    const r = box(phone ? 'tl-mode' : 'tl-lanes');
    return { top: phone ? box('tl-status-line').bottom : r.top, bottom: r.bottom };
  }

  // WCAG 2.2 2.4.11 at 400% zoom (320x256) and 200% (960x540): a block that would leave too
  // little room for the rows scrolls with them, so a focused row is never under it.
  for (const [vw, vh, regionHeight, phone] of [
    [320, 256, 172, true],
    [960, 540, 456, false]
  ] as const) {
    it(`at ${vw}x${vh} the pinned block scrolls with the rows and a focused bar shows whole`, async () => {
      await page.viewport(vw, vh);
      await opened(LAST, {
        initialPolicy: mk(protect(5), { ...protect(3), id: 'b' }, { ...protect(2), id: 'c' }),
        withInspector: true,
        inspectorOpen: false,
        regionHeight
      });
      await expect.element(slider()).toBeInTheDocument();
      // From md the kinds open in place, so the rows run long; below md a kind opens a sheet.
      if (!phone) {
        await page.getByRole('button', { name: 'Zoning', exact: true }).click();
        await page.getByRole('button', { name: 'Permitting', exact: true }).click();
      }
      await nextFrame();
      const pin = page.getByTestId('tl-pin').element();
      await expect.poll(() => getComputedStyle(pin).position).not.toBe('sticky');
      // The last row's bar: the market's, at the bottom of the scroll.
      const bar = page
        .getByRole('button', { name: 'Market conditions, whole window' })
        .element() as HTMLElement;
      bar.focus();
      await nextFrame();
      await nextFrame();
      const r = bar.getBoundingClientRect();
      const p = port(phone);
      expect(r.top).toBeGreaterThanOrEqual(p.top - 0.5);
      expect(r.bottom).toBeLessThanOrEqual(p.bottom + 0.5);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      expect(bar.contains(hit)).toBe(true);
      // Scrolled to the end, the block is gone with the rows above it: nothing covers them.
      expect(pin.getBoundingClientRect().bottom).toBeLessThanOrEqual(r.top + 0.5);
    });
  }

  it('at 1280x720 the compact pinned block stays stuck', async () => {
    await page.viewport(1280, 720);
    await opened(LAST, { withInspector: true, regionHeight: 636 });
    await expect.element(slider()).toBeInTheDocument();
    await nextFrame();
    await nextFrame();
    expect(getComputedStyle(page.getByTestId('tl-pin').element()).position).toBe('sticky');
  });

  it('the pinned block sticks again when its scroll box grows', async () => {
    await page.viewport(960, 540);
    await opened(LAST, { withInspector: true, regionHeight: 456 });
    await expect.element(slider()).toBeInTheDocument();
    const pin = page.getByTestId('tl-pin').element();
    await expect.poll(() => getComputedStyle(pin).position).not.toBe('sticky');
    await page.viewport(1280, 900);
    document.getElementById('map-region')!.style.height = '700px';
    await expect.poll(() => getComputedStyle(pin).position).toBe('sticky');
  });

  it("from md the chart's legend stacks in the label column, legible and clear of axe", async () => {
    await opened(LAST, { withInspector: true });
    await expect.element(page.getByTestId('tl-chart-legend')).toBeVisible();
    const legend = page.getByTestId('tl-chart-legend').element() as HTMLElement;
    const lab = legend.parentElement!.getBoundingClientRect();
    expect(lab.width).toBe(168);
    const names = [...legend.querySelectorAll('li')].map((li) => li.textContent!.trim());
    expect(names).toEqual(['Homes completed', 'State target']);
    for (const li of legend.querySelectorAll('li')) {
      expect(li.getBoundingClientRect().right).toBeLessThanOrEqual(lab.right);
      expect(li.scrollWidth).toBeLessThanOrEqual(li.clientWidth);
      expect(parseFloat(getComputedStyle(li).fontSize)).toBeGreaterThanOrEqual(12);
    }
    expect(legend.getBoundingClientRect().bottom).toBeLessThanOrEqual(lab.bottom);
    // The legend under the plot is gone from md; the plot keeps the lane's width.
    const fig = page.getByTestId('tl-lanes').getByRole('figure');
    expect(getComputedStyle(fig.element().querySelector('.legend')!).display).toBe('none');
    expect(page.getByTestId('chart-svg').element().getBoundingClientRect().height).toBe(64);
    // The legend is the row's label: "Homes completed" once in the pinned block, and the chart
    // keeps its own name.
    // (The figure's sr-only caption is a sentence, not a label; the under-plot legend is not
    // rendered from md.) checkVisibility drops display:none content.
    const labels = [...page.getByTestId('tl-pin').element().querySelectorAll('*')].filter(
      (e) =>
        e.children.length === 0 &&
        e.textContent!.trim() === 'Homes completed' &&
        e.checkVisibility()
    );
    expect(labels).toHaveLength(1);
    expect(legend.contains(labels[0])).toBe(true);
    await expect.element(fig).toHaveAccessibleName('Net new homes by month');
    const res = await axe.run(page.getByTestId('tl-pin').element(), {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });

  it("below md the chart's legend stays under the plot", async () => {
    await page.viewport(390, 760);
    await opened(LAST);
    await expect.element(slider()).toBeInTheDocument();
    expect(document.querySelector('[data-testid=tl-chart-legend]')).toBeNull();
    const lab = page.getByTestId('tl-pin').element().querySelector('.chart-lab')!;
    expect(lab.textContent!.trim()).toBe('Homes completed');
    const fig = page.getByTestId('tl-lanes').getByRole('figure');
    await expect.element(fig).toHaveAccessibleName('Net new homes by month');
    const under = fig.element().querySelector('.legend')!;
    expect(getComputedStyle(under).display).not.toBe('none');
    expect(page.getByTestId('chart-svg').element().getBoundingClientRect().height).toBe(96);
  });

  it('from md the detail column shows Results when nothing is open', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false });
    const insp = page.getByTestId('tl-inspector');
    await expect.element(insp.getByTestId('tl-results')).toBeVisible();
    expect(document.querySelector('[data-testid=host-inspector]')).toBeNull();
  });

  it("from md the map's height holds when a kind opens or the inspector opens", async () => {
    const s = await opened(LAST, { withInspector: true, inspectorOpen: false });
    await expect.element(slider()).toBeInTheDocument();
    await nextFrame();
    const h0 = box('tl-map').height;
    await page.getByRole('button', { name: 'Zoning', exact: true }).click();
    await nextFrame();
    expect(box('tl-map').height).toBe(h0);
    await (await s.r).rerender({ inspectorOpen: true });
    await expect.element(page.getByTestId('host-inspector')).toBeVisible();
    await nextFrame();
    expect(box('tl-map').height).toBe(h0);
  });

  it('below md nothing opens by default', async () => {
    await page.viewport(390, 760);
    await opened(LAST, { withInspector: true, inspectorOpen: false });
    await expect.element(slider()).toBeInTheDocument();
    expect(document.querySelector('[data-testid=tl-inspector]')).toBeNull();
  });

  it('from md the header score has no aria-expanded and controls the detail column', async () => {
    await opened(LAST, {
      withInspector: true,
      scoreControls: 'insp',
      scoreExpanded: true,
      inspectorOpen: false
    });
    await expect.element(scoreBar()).toHaveAttribute('aria-controls', 'insp');
    expect(scoreBar().element().hasAttribute('aria-expanded')).toBe(false);
    expect(document.getElementById('insp')).toBe(page.getByTestId('tl-inspector').element());
  });

  it('below md the header score reports the sheet as expanded', async () => {
    await page.viewport(390, 760);
    await opened(LAST, {
      withInspector: true,
      scoreControls: 'insp',
      scoreExpanded: true,
      inspectorOpen: true
    });
    await expect.element(scoreBar()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(scoreBar()).toHaveAttribute('aria-controls', 'insp');
  });

  it('showResults scrolls the detail column to the top and focuses Results', async () => {
    const s = await opened(LAST, { withInspector: true, inspectorOpen: false });
    const insp = page.getByTestId('tl-inspector');
    await expect.element(insp.getByTestId('tl-results')).toBeVisible();
    const el = insp.element() as HTMLElement;
    await expect.poll(() => el.scrollHeight - el.clientHeight).toBeGreaterThan(200);
    el.scrollTop = 200;
    expect(el.scrollTop).toBe(200);
    await s.showResults();
    expect(el.scrollTop).toBe(0);
    const res = page.getByTestId('tl-results').element();
    expect(document.activeElement).toBe(res);
    // The ring draws inside Results, so the column's scroll box never clips it (WCAG 2.4.7).
    const cs = getComputedStyle(res);
    expect(cs.outlineStyle).not.toBe('none');
    expect(parseFloat(cs.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(parseFloat(cs.outlineOffset)).toBeLessThanOrEqual(-parseFloat(cs.outlineWidth));
  });

  it("swapping the column's content starts it at the top", async () => {
    const s = await opened(LAST, { withInspector: true, inspectorOpen: true });
    const insp = page.getByTestId('tl-inspector');
    await expect.element(insp.getByTestId('host-inspector')).toBeVisible();
    const el = insp.element() as HTMLElement;
    await expect.poll(() => el.scrollHeight - el.clientHeight).toBeGreaterThan(200);
    el.scrollTop = 200;
    expect(el.scrollTop).toBe(200);
    await (await s.r).rerender({ inspectorOpen: false });
    await expect.element(insp.getByTestId('tl-results')).toBeVisible();
    expect(document.querySelector('[data-testid=host-inspector]')).toBeNull();
    await expect.poll(() => el.scrollTop).toBe(0);
  });
});
