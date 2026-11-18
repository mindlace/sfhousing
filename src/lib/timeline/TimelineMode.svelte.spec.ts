// TimelineMode composition (timeline-ui rules 1, 18-36): the real TimelineSession and
// TimelineClient over a fake worker, a recording SimMap stub, and the header slots from a host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { SaveStatus } from '$lib/sharing/autosave.svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { REAL_ACTUAL } from '$lib/fzp/fixtures/cards';
import { CALCULATING, fromPolicyText } from '$lib/fzp/score-view';
import { GOAL } from '$lib/goal/goal';
import { formatShortMonthYear } from '$lib/fzp/format';
import { dayFromUtc, monthStart, utcParts } from '$lib/fzp/time';
import { callsOf, stub } from '$lib/fzp/test/sim-map-stub';
import { lotsText } from '$lib/paint/rows';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { viewOf } from '$lib/sim/world/score/view';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { ParcelSummary, ProjectCard } from '$lib/sim/protocol';
import type { Day } from '$lib/timelapse/time';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { CHANGE_NOT_APPLIED, STALE_NOTE, UPDATING, goalNote, homesBy, playFromText } from './copy';
import { filledEndDay, indexOfDay } from './playhead';
import { DEFAULT_POLICY4, queriesOf4, type Policy, type SimPolicy4 } from './policy4';
import { headlineAt, headlineSpoken, headlineText } from './results';
import { dayPct } from './rows';
import { scanned } from './reveal';
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
import { pointerBetween } from './test/pointer';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
// The reveal rules as they are, with `scanned` counted (when the page scans, and what it ended).
vi.mock('./reveal', async (importOriginal) => {
  const real = await importOriginal<typeof import('./reveal')>();
  return { ...real, scanned: vi.fn(real.scanned) };
});

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
  /** The page's save state (the real SaveIndicator), in the header's status slot. */
  saveStatus: SaveStatus;
}>;

let workers: FakeTimelineWorker[];
const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

function setup(over: Over = {}) {
  const ctl: {
    setPolicy?: (p: SimPolicy4) => void;
    setLots?: (l: Lots | null) => void;
    setLotsFailed?: (f: boolean) => void;
    setSaveStatus?: (s: SaveStatus) => void;
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
      ...(over.scoreExpanded !== undefined ? { scoreExpanded: over.scoreExpanded } : {}),
      ...(over.saveStatus ? { saveStatus: over.saveStatus } : {})
    }
  });
  return {
    r,
    createWorker,
    setPolicy: (p: SimPolicy4) => ctl.setPolicy!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l),
    setLotsFailed: (f: boolean) => ctl.setLotsFailed!(f),
    setSaveStatus: (st: SaveStatus) => ctl.setSaveStatus!(st),
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
/** The status as shown in the header's slot (beside the invisible sizer). */
const statusShown = () => page.getByTestId('tl-status-shown');
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
    await expect.element(playButton()).toHaveAccessibleName('Play');
    expect(debug().playing).toBe(false);
    expect(callsOf('setTime').at(-1)).toEqual([asOf]);
  });

  /** The x of day `d` on the ruler's track. */
  const trackX = (d: Day) => {
    const t = page.getByTestId('tl-track').element().getBoundingClientRect();
    return t.left + (dayPct(d, asOf, windowEnd) / 100) * t.width;
  };
  const zone = (id: string) => page.getByTestId(id).element().getBoundingClientRect();

  it('on opening the playhead is at today and everything ahead is unseen', async () => {
    await opened();
    await expect.element(page.getByTestId('tl-flag')).toHaveTextContent('Today');
    expect(debug().reached).toBe(asOf);
    expect(debug().playFrom).toBeNull();
    const track = page.getByTestId('tl-track').element().getBoundingClientRect();
    expect(Math.abs(zone('tl-zone-unseen').left - track.left)).toBeLessThanOrEqual(1);
    expect(zone('tl-zone-shown').width).toBeLessThanOrEqual(1);
    expect(zone('tl-zone-seen').width).toBeLessThanOrEqual(1);
  });

  it('dragging forward moves the furthest date; dragging back leaves it, so ahead is seen', async () => {
    await opened();
    await expect.element(slider()).toBeInTheDocument();
    const ruler = slider().element();
    const r = ruler.getBoundingClientRect();
    const at = (f: number, type: string) =>
      ruler.dispatchEvent(
        new PointerEvent(type, {
          clientX: r.left + r.width * f,
          clientY: r.top + r.height / 2,
          pointerId: 1,
          button: 0,
          bubbles: true
        })
      );
    // The fixture fills two years of the forty: a press at 4% is inside it.
    at(0.04, 'pointerdown');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    const far = debug().day;
    expect(debug().reached).toBe(far);
    at(0.01, 'pointermove');
    at(0.01, 'pointerup');
    await expect.poll(() => debug().day).toBeLessThan(far);
    expect(debug().reached).toBe(far);
    const near = (a: number, b: number, what: string) =>
      expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(1);
    near(zone('tl-zone-seen').left, trackX(debug().day), 'seen from the playhead');
    near(zone('tl-zone-seen').right, trackX(far), 'seen to the furthest date');
    near(zone('tl-zone-unseen').left, trackX(far), 'unseen past it');
  });

  describe('an edit pulls the reveal back', () => {
    /** A policy in force before and after every edit here, so only the numbers can differ. */
    const before = mk(protect(5));
    const playLabelEl = () => page.getByTestId('tl-play-label');
    const lastScan = () => vi.mocked(scanned).mock.results.at(-1)?.value;

    /**
     * Scanned since `calls` was taken: the scan got the edit's search under way and ended it with
     * nothing changed.
     */
    function expectSearchEnded(calls: number) {
      const m = vi.mocked(scanned).mock;
      expect(m.calls.length).toBeGreaterThan(calls);
      expect(m.calls.at(-1)![0].finding).not.toBeNull();
      expect(lastScan()?.finding).toBeNull();
    }

    /** The playhead by key: Home, `k` calendar months on, then `back` months back. */
    async function keysTo(k: number, back = 0) {
      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(k) + '{ArrowLeft}'.repeat(back));
      await expect.poll(() => debug().day).toBe(MONTHS[k - back]);
    }

    /** The store's edit and its lots, as the page's store and PolicySync send them. */
    async function edit(s: Awaited<ReturnType<typeof opened>>, p: SimPolicy4, rev: number) {
      s.setPolicy(p);
      s.setLots({});
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(rev);
    }

    /** The worker's answer: refilled from `from`, unchanged up to `changed`, changed from it. */
    async function answer(rev: number, from: number, changed: number) {
      emit(compiledMsg(rev, STATICS));
      emit(refillMsg(rev, from));
      if (changed > from) emit(filledMsg(rev, from, changed - from));
      if (changed <= LAST) emit(filledMsg(rev, changed, LAST + 1 - changed, { base: 5 }));
      await expect.poll(() => debug().filledThrough).toBe(LAST);
      await tick();
    }

    it('an edit pulls the furthest date back to the first changed month; earlier months stay seen', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      expect(debug().reached).toBe(MONTHS[20]);
      await edit(s, mk(protect(7)), 2);
      await answer(2, 8, 12);
      await expect.poll(() => debug().reached).toBe(MONTHS[12]);
      expect(debug().playFrom).toBe(MONTHS[12]);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
      // Seen from the playhead to the first changed month; unseen past it.
      const near = (a: number, b: number, what: string) =>
        expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThanOrEqual(1);
      near(zone('tl-zone-seen').left, trackX(MONTHS[5]), 'seen from the playhead');
      near(zone('tl-zone-seen').right, trackX(MONTHS[12]), 'seen to the first change');
    });

    it('the furthest date never falls behind the playhead', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(15);
      await edit(s, mk(protect(7)), 2);
      await answer(2, 12, 12);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
      expect(debug().day).toBe(MONTHS[15]);
      expect(debug().reached).toBe(MONTHS[15]);
      expect(debug().playFrom).toBe(MONTHS[12]);
    });

    it('Play from moves the playhead to the first changed month and plays', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      await answer(2, 8, 12);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
      // Read in the press's own task: no frame of playback can come between.
      (playButton().element() as HTMLElement).click();
      expect(debug().day).toBe(MONTHS[12]);
      expect(debug().playing).toBe(true);
      expect(debug().playFrom).toBeNull();
      await expect.element(playButton()).toHaveAccessibleName('Pause');
      await playButton().click();
      await expect.poll(() => debug().playing).toBe(false);
      await expect.element(playLabelEl()).not.toHaveTextContent(/Play from/);
    });

    it('at the last day an edit updates the numbers in place and Play from replaces Replay', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      const lastDay = filledEndDay(MONTHS, LAST, asOf);
      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard('{End}');
      await expect.poll(() => debug().day).toBe(lastDay);
      await expect.element(playLabelEl()).toHaveTextContent('Replay');
      await edit(s, mk(protect(7)), 2);
      await answer(2, 12, 12);
      await expect.poll(() => debug().stale).toBe(false);
      expect(debug().completedNet()[LAST]).toBe(chunk(LAST, 1, { base: 5 }).rows[0].completedNet);
      expect(debug().day).toBe(lastDay);
      expect(debug().reached).toBe(lastDay);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
    });

    it('nothing pulled back while the edit has no refill, and none when nothing changed', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      const calls = vi.mocked(scanned).mock.calls.length;
      await edit(s, mk(protect(7)), 2);
      emit(compiledMsg(2, STATICS));
      await tick();
      // Not scanned while the edit waits for its refill: the newest view is still the old one.
      expect(vi.mocked(scanned).mock.calls.length).toBe(calls);
      expect(debug().reached).toBe(MONTHS[20]);
      emit(refillMsg(2, 8));
      emit(filledMsg(2, 8, LAST - 7));
      await expect.poll(() => debug().filledThrough).toBe(LAST);
      await tick();
      // Scanned once the refill answered, and the search ended with nothing changed.
      expect(vi.mocked(scanned).mock.calls.length).toBeGreaterThan(calls);
      expect(lastScan()?.finding).toBeNull();
      expect(debug().reached).toBe(MONTHS[20]);
      expect(debug().playFrom).toBeNull();
      await expect.element(playLabelEl()).toHaveTextContent(/^Play$/);
    });

    it('a second edit before the first is answered compares with what was seen first', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 8));
      emit(filledMsg(2, 8, 4));
      await expect.poll(() => debug().filledThrough).toBe(11);
      // The second edit while the first's months fill: the view on show is filled only to 11.
      await edit(s, mk(protect(9)), 3);
      // Unchanged from what was seen first throughout; against the half-filled view months past
      // 11 could not be compared and would count as changed.
      await answer(3, 8, LAST + 1);
      expect(lastScan()?.finding).toBeNull();
      expect(debug().reached).toBe(MONTHS[20]);
      expect(debug().playFrom).toBeNull();
      await expect.element(playLabelEl()).toHaveTextContent(/^Play$/);
    });

    it('a rejected edit pulls nothing back', async () => {
      const onundoto = vi.fn<(p: SimPolicy4) => void>();
      const s = await opened(LAST, { initialPolicy: before, onundoto });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      const calls = vi.mocked(scanned).mock.calls.length;
      emit(errorMsg(2, 'bad-request'));
      await expect.poll(() => onundoto.mock.calls).toEqual([[before]]);
      await tick();
      expectSearchEnded(calls);
      expect(debug().reached).toBe(MONTHS[20]);
      expect(debug().playFrom).toBeNull();
      await expect.element(playLabelEl()).toHaveTextContent(/^Play$/);
    });

    it('an edit whose lots fail pulls nothing back', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      s.setPolicy(mk(protect(7)));
      s.setLots(null);
      await expect.poll(() => debug().stale).toBe(true);
      const calls = vi.mocked(scanned).mock.calls.length;
      s.setLotsFailed(true);
      await expect.poll(() => debug().stale).toBe(false);
      await tick();
      expectSearchEnded(calls);
      expect(debug().reached).toBe(MONTHS[20]);
      expect(debug().playFrom).toBeNull();
      await expect.element(playLabelEl()).toHaveTextContent(/^Play$/);
    });

    it('moving the playhead takes Play from away', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      await answer(2, 8, 12);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBe(MONTHS[6]);
      expect(debug().playFrom).toBeNull();
      expect(debug().reached).toBe(MONTHS[12]);
      await expect.element(playLabelEl()).toHaveTextContent(/^Play$/);
    });

    it("lots that failed, then a Retry's answer that changes month 12, pull back to month 12", async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      s.setPolicy(mk(protect(7)));
      s.setLots(null);
      await expect.poll(() => debug().stale).toBe(true);
      s.setLotsFailed(true);
      await expect.poll(() => debug().stale).toBe(false);
      await tick();
      expect(lastScan()?.finding).toBeNull();
      // Retry found the lots: the same document goes out, with no new edit.
      s.setLotsFailed(false);
      s.setLots({});
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      await answer(2, 8, 12);
      await expect.poll(() => debug().reached).toBe(MONTHS[12]);
      expect(debug().playFrom).toBe(MONTHS[12]);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
    });

    /** Protection and a painted area: the open without the painted one is still in force. */
    const full = mk(protect(5), painted);
    const fullLots: Lots = Object.fromEntries(queriesOf4(full).map((q) => [q.key, ['p1']]));

    it('a provisional open whose full answer changes a month already passed pulls back', async () => {
      const s = setup({ initialPolicy: full, initialLots: null });
      await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
      emit(compiledMsg(1, STATICS));
      emit(filledMsg(1, 0, LAST + 1));
      await expect.poll(() => debug().filledThrough).toBe(LAST);
      await keysTo(20, 15);
      s.setLots(fullLots);
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      await answer(2, 8, 12);
      await expect.poll(() => debug().reached).toBe(MONTHS[12]);
      expect(debug().playFrom).toBe(MONTHS[12]);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
    });

    it('a first open with nothing shown yet offers no Play from', async () => {
      const s = setup({ initialPolicy: full, initialLots: null });
      await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
      s.setLots(fullLots);
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      emit(compiledMsg(2, STATICS));
      emit(filledMsg(2, 0, LAST + 1, { base: 5 }));
      await expect.poll(() => debug().filledThrough).toBe(LAST);
      await tick();
      expect(debug().reached).toBe(asOf);
      expect(debug().playFrom).toBeNull();
      await expect.element(playLabelEl()).toHaveTextContent(/^Play$/);
    });

    it('Play from never names a day past the computed edge', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      await answer(2, 8, 12);
      await expect.poll(() => debug().playFrom).toBe(MONTHS[12]);
      // Months from 10 withdrawn again: the offer is clamped as Play clamps it.
      emit(refillMsg(2, 10));
      await expect.poll(() => debug().filledThrough).toBe(9);
      const edge = filledEndDay(MONTHS, 9, asOf);
      expect(debug().playFrom).toBe(edge);
      (playButton().element() as HTMLElement).click();
      expect(debug().day).toBe(edge);
    });

    it('the scan runs as the fill or the pending state changes, never as the playhead moves', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 8));
      await expect.poll(() => debug().filledThrough).toBe(7);
      await tick();
      const calls = vi.mocked(scanned).mock.calls.length;
      // Compared through month 7 with no change: the search goes on from month 8.
      expect(lastScan()?.finding?.next).toBe(8);
      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
      await expect.poll(() => debug().day).toBe(MONTHS[4]);
      await tick();
      expect(vi.mocked(scanned).mock.calls.length).toBe(calls);
      emit(filledMsg(2, 8, 4));
      await expect.poll(() => debug().filledThrough).toBe(11);
      await tick();
      expect(vi.mocked(scanned).mock.calls.length).toBe(calls + 1);
    });
  });

  it('an edit pauses playback and Play works at once; the playhead waits at the computed edge', async () => {
    const s = await opened();
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(true);

    s.setPolicy(mk(protect(5)));
    await expect.poll(() => debug().playing).toBe(false);
    expect(playButton().element().hasAttribute('aria-disabled')).toBe(false);
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 5));
    emit(filledMsg(2, 5, 3));
    await expect.poll(() => debug().filledThrough).toBe(7);
    // Play works while the forecast refills; End and playback wait at the computed edge.
    const edge = filledEndDay(MONTHS, 7, asOf);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect.poll(() => debug().day).toBe(edge);
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(true);
    expect(debug().day).toBe(edge);
    await expect.element(playButton()).toHaveAccessibleName('Pause');
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(false);
    expect(debug().policy).toEqual(mk(protect(5)));
  });

  it("End reaches the last row's month; the header, the flag and Replay agree", async () => {
    await opened();
    const lastDay = filledEndDay(MONTHS, LAST, asOf);
    await expect.element(slider()).toHaveAttribute('aria-valuemax', String(lastDay));
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect.poll(() => debug().day).toBe(lastDay);
    await expect
      .element(page.getByTestId('tl-flag'))
      .toHaveTextContent(formatShortMonthYear(monthStart(debug().day)));
    await expect
      .element(scoreBar())
      .toHaveTextContent(homesBy(FULL().rows[LAST].completedNet, MONTHS[LAST]));
    expect(monthStart(debug().day)).toBe(MONTHS[LAST]);
    await expect.element(page.getByTestId('tl-play-label')).toHaveTextContent('Replay');
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

  it('the status slot says Updating while stale, then nothing; no fill text ever shows', async () => {
    const s = await opened(5);
    const shown = () => statusShown().element().textContent?.trim();
    await expect.poll(() => debug().filledThrough).toBe(5);
    expect(statusSlot().element().textContent?.trim()).toBe('');
    expect(shown()).toBe('');
    expect(document.body.textContent).not.toMatch(/Forecast filled/);

    s.setPolicy(mk(protect(5)));
    await expect.element(statusSlot()).toHaveTextContent(UPDATING);
    await expect.poll(shown).toBe(UPDATING);
    // The explanation waits behind the status (rule 31, F12).
    await expect
      .element(page.getByTestId('tl-status').getByRole('button', { name: UPDATING }))
      .toBeInTheDocument();
    expect(debug().stale).toBe(true);
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 3));
    await expect.poll(() => statusSlot().element().textContent?.trim()).toBe('');
    expect(debug().stale).toBe(false);
    expect(shown()).toBe('');
    emit(filledMsg(2, 3, LAST - 2));
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    expect(statusSlot().element().textContent?.trim()).toBe('');
    expect(document.body.textContent).not.toMatch(/Forecast filled/);
  });

  it('no lane is hatched and the ruler has no markers', async () => {
    // Filled short of the last month: the lanes were hatched past the filled end.
    await opened(LAST - 1, { initialPolicy: mk(protect(5)) });
    await expect.element(slider()).toBeInTheDocument();
    await expect
      .poll(() => document.querySelectorAll('[data-testid=tl-lane]').length)
      .toBeGreaterThan(2);
    for (const lane of document.querySelectorAll('[data-testid=tl-lane]'))
      for (const el of [lane, ...lane.querySelectorAll('*')])
        expect(getComputedStyle(el).backgroundImage).not.toContain('repeating-linear-gradient');
    const pin = page.getByTestId('tl-pin').element();
    expect(pin.textContent).not.toContain('RHNA');
    expect(pin.querySelectorAll('[data-testid=tl-axis] button')).toHaveLength(0);
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

      near(centre(rect(page.getByTestId('tl-thumb').element())), px(d), 'thumb');
      const line = document.querySelector('[data-testid=tl-playhead-line]')!;
      near(centre(rect(line)), px(d), 'playhead line');

      const label = [...document.querySelectorAll('[data-testid=tl-year]')].find(
        (e) => e.textContent?.trim() === String(y + 5)
      )!;
      near(centre(rect(label)), px(dayFromUtc(y + 5, 1, 1)), 'ruler label');

      // The chart's solid zone ends at the day, on the lanes' scale.
      const plot = rect(page.getByTestId('chart-svg').element());
      near(plot.left, lane.left, 'chart left');
      near(plot.width, lane.width, 'chart width');
      const shownW = Number(page.getByTestId('chart-clip-shown').element().getAttribute('width'));
      near(plot.left + (shownW / 1000) * plot.width, px(d), 'chart zone');

      const mini = document.querySelector('[data-testid=tl-kind-zoning] [data-testid=tl-mini] i')!;
      near(rect(mini).left, px(monthFirstDay(asOf, 2)), 'zoning miniature');

      near(
        rect(page.getByTestId('tl-controls').element()).left,
        rect(page.getByTestId('tl-timeline').element()).left,
        'controls'
      );
      // The pinned segment starts under the ruler (the thumb marks the day there).
      near(rect(line).top, rect(page.getByTestId('tl-axis').element()).bottom, 'pinned line top');
    });
  }

  // Three zoning policies and Permitting open: the rows overflow the lanes' box from md.
  const many = () => mk(protect(5), { ...protect(3), id: 'b' }, { ...protect(2), id: 'c' });
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const rectOf = (id: string) => page.getByTestId(id).element().getBoundingClientRect();

  /** Many rows open from md, the rows box scrolled to its end. */
  async function scrolledRows() {
    await opened(LAST, { initialPolicy: many() });
    await expect.element(slider()).toBeInTheDocument();
    await page.getByRole('button', { name: 'Zoning', exact: true }).click();
    await page.getByRole('button', { name: 'Permitting', exact: true }).click();
    const rows = page.getByTestId('tl-rows').element() as HTMLElement;
    expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);
    rows.scrollTop = rows.scrollHeight;
    await frame();
    return rows;
  }
  const firstBar = () =>
    document.querySelector<HTMLElement>('[data-testid=tl-kind-zoning] [data-testid=tl-bar]')!;

  it('from md the rows scroll in their own box under the pinned block', async () => {
    const rows = await scrolledRows();
    expect(rows.scrollTop).toBeGreaterThan(0);
    const lanes = rectOf('tl-lanes');
    const pin = rectOf('tl-pin');
    expect(Math.abs(pin.top - lanes.top)).toBeLessThanOrEqual(1);
    const play = rectOf('tl-play');
    expect(play.top).toBeGreaterThanOrEqual(lanes.top - 0.5);
    expect(play.bottom).toBeLessThanOrEqual(lanes.bottom + 0.5);
    const hit = document.elementFromPoint(play.left + play.width / 2, play.top + play.height / 2);
    expect(playButton().element().contains(hit)).toBe(true);
    const block = page.getByTestId('tl-pin').element();
    for (const k of [0, 1, 2, 3]) {
      const at = document.elementFromPoint(
        pin.left + pin.width / 2,
        pin.top + ((k + 0.5) * pin.height) / 4
      );
      expect(block.contains(at), `point ${k}`).toBe(true);
      expect(rows.contains(at), `point ${k}`).toBe(false);
    }
  });

  it('from md a focused bar lands inside the rows box, 4 px clear of its top', async () => {
    const rows = await scrolledRows();
    const bar = firstBar();
    bar.focus();
    await frame();
    const box = rows.getBoundingClientRect();
    let r = bar.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(box.top + 4 - 0.5);
    expect(r.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
    // Scrolled to the top: the scroll padding keeps its 24 px target off the chart's slider
    // (WCAG 2.2 2.5.8).
    bar.scrollIntoView({ block: 'start', behavior: 'instant' });
    await frame();
    r = bar.getBoundingClientRect();
    expect(Math.abs(r.top - (box.top + 4))).toBeLessThanOrEqual(1);
    expect(r.top + r.height / 2 - 12).toBeGreaterThanOrEqual(rectOf('tl-pin').bottom);
  });

  for (const offset of [5, 11, 17, 23]) {
    it(`from md with the rows scrolled ${offset} px past a row, axe target-size finds nothing`, async () => {
      const rows = await scrolledRows();
      const bar = firstBar();
      const top = bar.getBoundingClientRect().top - rows.getBoundingClientRect().top;
      rows.scrollTop = rows.scrollTop + top + offset;
      await frame();
      expect(bar.getBoundingClientRect().top).toBeLessThan(rows.getBoundingClientRect().top);
      const res = await axe.run(page.getByTestId('tl-dock').element(), {
        runOnly: ['target-size']
      });
      expect(res.violations).toEqual([]);
    });
  }

  it('from md focusing the slider or the chart leaves the rows where they are', async () => {
    const rows = await scrolledRows();
    const at = rows.scrollTop;
    expect(at).toBeGreaterThan(0);
    (slider().element() as HTMLElement).focus();
    await frame();
    expect(Math.abs(rows.scrollTop - at)).toBeLessThanOrEqual(1);
    const overlay = page.getByRole('slider', { name: 'Month in the chart' });
    (overlay.element() as HTMLElement).focus();
    await frame();
    expect(Math.abs(rows.scrollTop - at)).toBeLessThanOrEqual(1);
  });

  // A short mode box (320 px): the map scrolls away, then the rows in their own box. The pinned
  // block is 193 px here, so 320 px leaves a 127 px rows box, shorter than its 166 px of rows.
  it('on a phone the mode box scrolls the map away, then the rows scroll in their own box', async () => {
    await page.viewport(390, 760);
    await opened(LAST, { regionHeight: 320 });
    await expect.element(slider()).toBeInTheDocument();
    const mode = page.getByTestId('tl-mode').element() as HTMLElement;
    mode.scrollTop = mode.scrollHeight;
    await frame();
    expect(mode.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(rectOf('tl-pin').top - rectOf('tl-mode').top)).toBeLessThanOrEqual(1);
    const inView = (r: DOMRect) => {
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(760);
    };
    inView(slider().element().getBoundingClientRect());
    inView(page.getByTestId('tl-dock').getByRole('figure').element().getBoundingClientRect());
    const rows = page.getByTestId('tl-rows').element() as HTMLElement;
    expect(getComputedStyle(rows).overflowY).toBe('auto');
    expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);
    const at = mode.scrollTop;
    const market = page
      .getByRole('button', { name: 'Market conditions, whole window' })
      .element() as HTMLElement;
    market.focus();
    await frame();
    expect(rows.scrollTop).toBeGreaterThan(0);
    const box = rows.getBoundingClientRect();
    const r = market.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(box.top - 0.5);
    expect(r.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
    // Focusing the slider leaves both boxes where they are.
    const rowsAt = rows.scrollTop;
    (slider().element() as HTMLElement).focus();
    await frame();
    expect(Math.abs(mode.scrollTop - at)).toBeLessThanOrEqual(1);
    expect(Math.abs(rows.scrollTop - rowsAt)).toBeLessThanOrEqual(1);
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
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    expect(debug().stale).toBe(false);
  });

  /** The month index of the playhead's day. */
  const playheadMonth = () => indexOfDay(MONTHS, debug().day);
  const FULL = () => viewOf([chunk(0, LAST + 1)], STATICS);
  /** The header's text at month i. Nothing is in force (the default document): no effect part. */
  const textAt = (i: number) =>
    headlineText(
      headlineAt(FULL(), { index: i, atToday: false }, { provisional: false, inForce: false })!
    );

  it('the header reads 0 by today, then follows the playhead month by month', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await opened();
      await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
      const v = FULL();
      (slider().element() as HTMLElement).focus();
      for (let step = 0; step < 2; step++) {
        const before = debug().day;
        await userEvent.keyboard('{PageUp}');
        await expect.poll(() => debug().day).toBeGreaterThan(before);
        const i = playheadMonth();
        await expect
          .element(scoreBar())
          .toHaveTextContent(homesBy(v.rows[i].completedNet, monthStart(debug().day)));
        vi.advanceTimersByTime(1000);
        await expect
          .poll(() => page.getByTestId('score-live').element().textContent)
          .toBe(headlineSpoken(textAt(i)));
      }
      await userEvent.keyboard('{Home}');
      await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the flag and the header name the same month at today, mid-window and at the end', async () => {
    await opened();
    const flag = page.getByTestId('tl-flag');
    await expect.element(flag).toHaveTextContent('Today');
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => playheadMonth()).toBeGreaterThan(0);
    const i = playheadMonth();
    expect(i).toBeLessThan(LAST);
    await expect.element(flag).toHaveTextContent(formatShortMonthYear(MONTHS[i]));
    await expect
      .element(scoreBar())
      .toHaveTextContent(homesBy(FULL().rows[i].completedNet, MONTHS[i]));
    await userEvent.keyboard('{End}');
    await expect.poll(() => playheadMonth()).toBe(LAST);
    await expect.element(flag).toHaveTextContent(formatShortMonthYear(MONTHS[LAST]));
    await expect
      .element(scoreBar())
      .toHaveTextContent(homesBy(FULL().rows[LAST].completedNet, MONTHS[LAST]));
  });

  it("the chart's readout and the header name the same month at every position", async () => {
    await opened();
    const overlay = () =>
      page.getByRole('slider', { name: 'Month in the chart' }).element() as HTMLElement;
    const readout = page.getByTestId('chart-readout');
    const same = async () => {
      overlay().focus();
      await expect.element(readout).toBeVisible();
      expect(readout.element().textContent!.trim()).toBe(scoreBar().element().textContent!.trim());
      overlay().blur();
      (slider().element() as HTMLElement).focus();
    };
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    await same();
    // The fixture fills two years: a year on, three months back, then the end.
    for (const key of ['{PageUp}', '{ArrowLeft>3/}', '{End}']) {
      const before = debug().day;
      await userEvent.keyboard(key);
      await expect.poll(() => debug().day).not.toBe(before);
      await expect
        .element(scoreBar())
        .toHaveTextContent(
          homesBy(FULL().rows[playheadMonth()].completedNet, monthStart(debug().day))
        );
      await same();
    }
    expect(playheadMonth()).toBe(LAST);
  });

  it('the chart draws the held numbers while stale, as the header does', async () => {
    const s = await opened();
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}{PageUp}');
    await expect.poll(() => playheadMonth()).toBeGreaterThan(1);
    const fig = page.getByTestId('tl-dock').getByRole('figure', { name: 'Homes completed' });
    const line = page.getByTestId('chart-line');
    await expect.element(line).toBeInTheDocument();
    const d = line.element().getAttribute('d');
    expect(fig.element().hasAttribute('data-stale')).toBe(false);
    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    await expect.poll(() => debug().filledThrough).toBe(-1);
    // The held view, dimmed, with the held document's legend: nothing was in force.
    await expect.element(fig).toHaveAttribute('data-stale', 'true');
    expect(line.element().getAttribute('d')).toBe(d);
    expect(document.querySelector('[data-testid=chart-law]')).toBeNull();
    emit(filledMsg(2, 0, LAST + 1, { base: 5 }));
    await expect.poll(() => debug().stale).toBe(false);
    expect(fig.element().hasAttribute('data-stale')).toBe(false);
    await expect.element(page.getByTestId('chart-law')).toBeInTheDocument();
    expect(line.element().getAttribute('d')).not.toBe(d);
  });

  it('nothing in force: no effect in the header and the current-law copy, whatever the worker compares', async () => {
    // The worker's statics say 'plan' and the plan effect is non-zero; the page's rule decides.
    await opened(LAST, { withInspector: true });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    const i = playheadMonth();
    expect(STATICS.compare).toBe('plan');
    expect(FULL().planEffect[i].completedNetNew).not.toBe(0);
    await expect.element(scoreBar()).toHaveTextContent(textAt(i).main);
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    await expect.element(page.getByTestId('score-detail')).toHaveTextContent(/of the goal$/);
    const results = page.getByTestId('tl-results');
    await expect.element(results).toHaveTextContent('What current law added');
    expect(results.element().textContent).not.toContain('your policy');
  });

  it('a policy in force: the header shows the plan effect and Results the your-policy copy', async () => {
    await opened(LAST, { withInspector: true, initialPolicy: mk(protect(5)) });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    const i = playheadMonth();
    await expect
      .element(page.getByTestId('score-delta'))
      .toHaveTextContent(fromPolicyText(FULL().planEffect[i].completedNetNew));
    await expect
      .element(page.getByTestId('tl-results'))
      .toHaveTextContent('What your policy added');
  });

  it('while stale the header shows the held numbers, dimmed, not calculating', async () => {
    const s = await opened();
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}{PageUp}');
    await expect.poll(() => playheadMonth()).toBeGreaterThan(1);
    const i = playheadMonth();
    await expect.element(scoreBar()).toHaveTextContent(textAt(i).main);
    const text = scoreBar().element().textContent;
    s.setPolicy(mk(protect(5)));
    const box = page.getByTestId('score-box');
    await expect.element(box).toHaveAttribute('data-stale', 'true');
    expect(scoreBar().element().textContent).toBe(text);
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    await expect.poll(() => debug().filledThrough).toBe(-1);
    expect(scoreBar().element().textContent).toBe(text);
    expect(scoreBar().element().textContent).not.toContain(CALCULATING);
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().stale).toBe(false);
    expect(box.element().hasAttribute('data-stale')).toBe(false);
    await expect
      .element(scoreBar())
      .toHaveTextContent(homesBy(FULL().rows[i].completedNet, monthStart(debug().day)));
  });

  it('right after an edit with the playhead at today the header reads 0 by today', async () => {
    const s = await opened();
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    await expect.poll(() => debug().filledThrough).toBe(-1);
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    expect(scoreBar().element().textContent).not.toContain(CALCULATING);
  });

  // The session holds the view from before a refill until the fill is back to the playhead's
  // month, so a withdrawn month reads the held numbers, dimmed; "calculating" shows only where no
  // view covers the month (the provisional open above).
  it('a refill that withdraws the playhead month holds its numbers, dimmed, until filled again', async () => {
    await opened();
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}{PageUp}');
    await expect.poll(() => playheadMonth()).toBeGreaterThan(1);
    const i = playheadMonth();
    await expect.element(scoreBar()).toHaveTextContent(textAt(i).main);
    emit(refillMsg(1, 1));
    await expect.poll(() => debug().filledThrough).toBe(0);
    await expect.element(page.getByTestId('score-box')).toHaveAttribute('data-stale', 'true');
    expect(scoreBar().element().textContent).toContain(textAt(i).main);
    emit(filledMsg(1, 1, LAST));
    await expect.poll(() => debug().stale).toBe(false);
    expect(page.getByTestId('score-box').element().hasAttribute('data-stale')).toBe(false);
    await expect.element(scoreBar()).toHaveTextContent(textAt(i).main);
  });

  it('with nothing filled and the playhead at today the header reads 0 by today', async () => {
    await opened();
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    emit(refillMsg(1, 0));
    await expect.poll(() => debug().filledThrough).toBe(-1);
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    expect(scoreBar().element().textContent).not.toContain(CALCULATING);
  });

  // No wall clock: the playhead is dragged in steps of a few days, so most steps stay inside a
  // calendar month whatever the frame rate.
  it('the header writes the DOM only on the steps where the playhead changes month', async () => {
    await opened();
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    expect(debug().playing).toBe(false);
    const track = slider().element() as HTMLElement;
    const r = track.getBoundingClientRect();
    const xOf = (d: Day) => r.left + ((d - asOf) / (windowEnd - asOf)) * r.width;
    const pointer = (type: string, d: Day) =>
      track.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientX: xOf(d),
          clientY: r.top + r.height / 2
        })
      );
    const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
    const box = page.getByTestId('score-box').element();
    let records = 0;
    const obs = new MutationObserver((m) => (records += m.length));
    obs.observe(box, { childList: true, characterData: true, subtree: true });
    /** Mutation records so far, the queued ones included. */
    const written = () => records + obs.takeRecords().length;

    const from = MONTHS[2] + 1;
    pointer('pointerdown', from);
    await expect.poll(() => debug().day).toBe(from);
    await expect.element(scoreBar()).toHaveTextContent(textAt(2).main);
    let wrote = written();
    let changes = 0;
    for (let d = from + 3; d < MONTHS[5] + 10; d += 3) {
      const month = monthStart(debug().day);
      pointer('pointermove', d);
      await expect.poll(() => debug().day).toBe(d);
      await frame();
      const now = written();
      const crossed = monthStart(d) !== month;
      if (crossed) changes++;
      // The header's text changes exactly on the steps that cross into another month.
      expect({ d, crossed, wrote: now > wrote }).toEqual({ d, crossed, wrote: crossed });
      wrote = now;
    }
    pointer('pointerup', MONTHS[5] + 10);
    obs.disconnect();
    expect(changes).toBe(3);
    await expect.element(scoreBar()).toHaveTextContent(textAt(playheadMonth()).main);
    expect(debug().playing).toBe(false);
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
    expect(alerts.getByText(failedText).query()).toBeNull();

    // PolicySync settled with a failure: the forecast stays the last sent document's.
    s.setLotsFailed(true);
    await expect.poll(() => debug().stale).toBe(false);
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

  it("the comparison wording is the shown numbers' document's: it changes with them", async () => {
    const s = await opened(LAST, { withInspector: true });
    const results = page.getByTestId('tl-results');
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    await expect.element(results).toHaveTextContent('What current law added');
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    await expect.poll(() => debug().filledThrough).toBe(-1);
    // Updating: the held numbers are the nothing-in-force document's, and so is the wording.
    expect(debug().stale).toBe(true);
    expect(debug().policy).toEqual(mk(protect(5)));
    await expect.element(results).toHaveTextContent('What current law added');
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().stale).toBe(false);
    await expect.element(results).toHaveTextContent('What your policy added');
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent(/from your policy$/);
  });

  /** Results and the header keep the current-law wording now; after `answer` the policy's. */
  async function heldWordingThenPolicy(answer: () => void) {
    const results = page.getByTestId('tl-results');
    await tick();
    expect(debug().stale).toBe(true);
    await expect.element(results).toHaveTextContent('What current law added');
    expect(page.getByTestId('score-delta').elements()).toEqual([]);
    answer();
    await expect.poll(() => debug().stale).toBe(false);
    await expect.element(results).toHaveTextContent('What your policy added');
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent(/from your policy$/);
  }

  it("a Retry's send after failed lots holds the shown numbers' document until the refill", async () => {
    const s = await opened(LAST, { withInspector: true });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    s.setPolicy(withPaint);
    s.setLots(null);
    await expect.poll(() => debug().stale).toBe(true);
    s.setLotsFailed(true);
    await expect.poll(() => debug().stale).toBe(false);
    await expect
      .element(page.getByTestId('tl-results'))
      .toHaveTextContent('What current law added');
    // Retry found the lots: the painted document goes out with no new edit.
    s.setLotsFailed(false);
    s.setLots(paintLots);
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    await heldWordingThenPolicy(() => {
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 0));
      emit(filledMsg(2, 0, LAST + 1));
    });
  });

  it("a provisional open's full send holds the opened document until its numbers fill", async () => {
    const s = setup({ initialPolicy: withPaint, initialLots: null, withInspector: true });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, STATICS));
    emit(filledMsg(1, 0, LAST + 1));
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    s.setLots(paintLots);
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    await heldWordingThenPolicy(() => {
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 0));
      emit(filledMsg(2, 0, LAST + 1));
    });
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
    // The host's mode box ends at 748 px of a 760 px viewport: the sheet stops there, not at the viewport's edge.
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

  it('the chart step is the goal amount minus the homes built before today', async () => {
    // Month 0 is Jan 2030, so the goal's deadline (Jan 2031) is month 12 of the window.
    const need = 40;
    const base = baseStatics({ lastIndex: LAST });
    const statics: ScoreStatics = {
      ...base,
      asOf: dayFromUtc(2030, 1, 1),
      months: Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(2030, 1 + i, 1)),
      baseline: { ...base.baseline, units: GOAL.amount - need }
    };
    setup({});
    await expect.poll(() => workers.length).toBe(1);
    await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, statics));
    emit(filledMsg(1, 0, LAST + 1));
    const target = page.getByTestId('chart-target');
    await expect.element(target).toBeInTheDocument();
    // The step is drawn, so the stacked legend names the goal.
    const legend = page.getByTestId('tl-chart-legend').element();
    expect([...legend.querySelectorAll('li')].map((li) => li.textContent!.trim())).toEqual([
      'Homes completed',
      'Goal'
    ]);
    // It is labelled as the homes still needed by the deadline's month.
    await expect
      .element(page.getByTestId('chart-target-note'))
      .toHaveTextContent(goalNote(need, statics.months[12]));
    // At today the scale is the goal's: niceCeil(40) = 50.
    expect(Number(target.element().getAttribute('y1'))).toBeCloseTo(2 + (1 - need / 50) * 96, 1);
    // At the end the scale holds the most homes any month has (3 * LAST + 1 = 70): 100.
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect
      .poll(() => Number(target.element().getAttribute('y1')))
      .toBeCloseTo(2 + (1 - need / 100) * 96, 1);
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
    const net = page.getByTestId('fzp-built');
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
    const s = await opened(LAST, { statusMs: 1000 });
    const live = () => statusSlot().element().textContent?.trim();
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      s.setPolicy(mk(protect(5)));
      await expect.poll(live).toBe(UPDATING);
      s.setLots({});
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 3));
      await expect.poll(() => debug().stale).toBe(false);
      expect(live()).toBe(UPDATING);
      vi.advanceTimersByTime(999);
      await tick();
      expect(live()).toBe(UPDATING);
      vi.advanceTimersByTime(1);
      await tick();
      // The text wanted in the gap goes out when it ends.
      expect(live()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  for (const width of [375, 1280, 1600]) {
    it(`at ${width} px exactly one live region speaks the status; it shows in the header`, async () => {
      await page.viewport(width, 900);
      const s = await opened();
      s.setPolicy(mk(protect(5)));
      await expect.element(statusSlot()).toHaveTextContent(UPDATING);
      const speaking = [...document.querySelectorAll('[role="status"], [aria-live]')].filter(
        (el) => el.textContent?.trim() === UPDATING
      );
      expect(speaking).toHaveLength(1);
      const slot = document.querySelector('[data-header-status]')!;
      const status = page.getByTestId('tl-status');
      await expect.element(status).toBeVisible();
      expect(slot.contains(status.element())).toBe(true);
      await expect.element(statusShown()).toBeVisible();
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      expect(document.querySelector('[data-testid=tl-status-line]')).toBeNull();
    });
  }

  /** The boxes that must hold still as the status comes and goes. */
  function stillBoxes(): Record<string, DOMRect> {
    const name = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });
    const lead = name.elements().length
      ? name.element()
      : page.getByRole('button', { name: 'Menu' }).element();
    const out: Record<string, DOMRect> = { lead: lead.getBoundingClientRect() };
    for (const id of ['score-bar', 'tl-map', 'tl-dock', 'tl-pin'])
      out[id] = page.getByTestId(id).element().getBoundingClientRect();
    return out;
  }
  function same(a: Record<string, DOMRect>, b: Record<string, DOMRect>): void {
    for (const k of Object.keys(a))
      for (const side of ['left', 'top', 'width', 'height'] as const)
        expect(Math.abs(a[k][side] - b[k][side]), `${k} ${side}`).toBeLessThanOrEqual(0.5);
  }

  for (const width of [375, 768, 1280]) {
    it(`at ${width} px nothing moves when Updating comes and goes`, async () => {
      await page.viewport(width, 900);
      // A policy in force throughout: the first one widens the score (its effect line), apart
      // from the status.
      const s = await opened(LAST, { initialPolicy: mk(protect(5)) });
      await expect.element(scoreBar()).toBeVisible();
      await frame();
      const before = stillBoxes();
      s.setPolicy(mk(protect(3)));
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      await expect.element(statusShown()).toBeVisible();
      await frame();
      same(before, stillBoxes());
      s.setLots({});
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 0));
      emit(filledMsg(2, 0, LAST + 1));
      await expect.poll(() => statusShown().element().textContent?.trim()).toBe('');
      await frame();
      same(before, stillBoxes());
    });
  }

  for (const width of [375, 1280]) {
    it(`at ${width} px Updating takes the save state's place in one cell`, async () => {
      await page.viewport(width, 900);
      const s = await opened(LAST, { saveStatus: 'saving' });
      const saving = page.getByTestId('save-text');
      await expect.element(saving).toBeVisible();
      s.setPolicy(mk(protect(5)));
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      await expect.element(statusShown()).toBeVisible();
      await expect.element(saving).not.toBeVisible();
      const a = saving.element().getBoundingClientRect();
      const b = statusShown().element().getBoundingClientRect();
      expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(0.5);
    });
  }

  for (const width of [375, 1280]) {
    it(`at ${width} px with autosave off an update covers the chip; nothing moves; the popover closes`, async () => {
      await page.viewport(width, 900);
      // A policy in force throughout, so the score's effect line is there before and after.
      const s = await opened(LAST, { saveStatus: 'off', initialPolicy: mk(protect(5)) });
      const chip = page.getByRole('button', { name: 'Autosave off' });
      await expect.element(chip).toBeVisible();
      const chipEl = chip.element() as HTMLButtonElement;
      const pop = document.getElementById(chipEl.getAttribute('aria-controls')!)!;
      // A real press: nothing of "Updating"'s (empty) cell sits over the chip.
      await chip.click();
      await expect.poll(() => pop.hidden).toBe(false);
      await frame();
      const lead =
        width >= 1024
          ? page.getByRole('link', { name: 'About', exact: true })
          : page.getByRole('button', { name: 'Menu' });
      const rects = () => ({
        cell: page.getByTestId('tl-status-group').element().getBoundingClientRect().toJSON(),
        score: scoreBar().element().getBoundingClientRect().toJSON(),
        other: lead.element().getBoundingClientRect().toJSON()
      });
      const off = rects();

      // Focus stays on the chip (a keyboard user pressing Ctrl+Z there): the edit's cover moves
      // it to "Updating"'s explanation, in the same place.
      chipEl.focus();
      expect(document.activeElement).toBe(chipEl);
      s.setPolicy(mk(protect(3)));
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      await expect.element(statusShown()).toBeVisible();
      const updating = page.getByTestId('tl-status').getByRole('button', { name: UPDATING });
      await expect.poll(() => document.activeElement).toBe(updating.element());
      // Only "Updating" shows; the chip is out of the tab order and its popover closed.
      expect(chipEl.checkVisibility({ visibilityProperty: true })).toBe(false);
      expect(chipEl.closest('[inert]')).not.toBeNull();
      chipEl.focus();
      expect(document.activeElement).not.toBe(chipEl);
      expect(pop.hidden).toBe(true);
      await frame();
      expect(rects()).toEqual(off);

      s.setLots({});
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 0));
      emit(filledMsg(2, 0, LAST + 1));
      await expect.poll(() => statusShown().element().textContent?.trim()).toBe('');
      await expect.element(chip).toBeVisible();
      // Focus was on "Updating"'s explanation: it goes back to the chip.
      await expect.poll(() => document.activeElement).toBe(chipEl);
      await frame();
      expect(rects()).toEqual(off);
      // Back, focusable, and its popover works; autosave off is not announced again.
      expect(pop.hidden).toBe(true);
      await chip.click();
      await expect.poll(() => pop.hidden).toBe(false);
      expect(page.getByTestId('save-live').element().textContent?.trim()).toBe('');
    });
  }

  /** Ends the stale spell of revision `rev`: compiled, refilled and filled. */
  async function settle(s: ReturnType<typeof setup>, rev: number): Promise<void> {
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(rev);
    emit(compiledMsg(rev, STATICS));
    emit(refillMsg(rev, 0));
    emit(filledMsg(rev, 0, LAST + 1));
    await expect.poll(() => statusShown().element().textContent?.trim()).toBe('');
  }

  it('save-state changes under Updating are announced once, from an exposed region', async () => {
    const s = await opened(LAST, { saveStatus: 'saving', initialPolicy: mk(protect(5)) });
    const live = page.getByTestId('save-live').element();
    const said: string[] = [];
    const watch = new MutationObserver(() => {
      const t = live.textContent?.trim() ?? '';
      if (t) said.push(t);
    });
    watch.observe(live, { childList: true, characterData: true, subtree: true });
    const exposed = () =>
      !live.closest('[aria-hidden="true"], [inert]') &&
      getComputedStyle(live).visibility === 'visible';
    try {
      s.setPolicy(mk(protect(3)));
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      s.setSaveStatus('off');
      await expect.poll(() => said).toEqual(['Autosave off']);
      expect(exposed()).toBe(true);
      await settle(s, 2);
      await expect.element(page.getByRole('button', { name: 'Autosave off' })).toBeVisible();
      await frame();
      // The cover lifting announces nothing.
      expect(said).toEqual(['Autosave off']);

      s.setPolicy(mk(protect(2)));
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      s.setSaveStatus('saved');
      await expect.poll(() => said).toEqual(['Autosave off', 'Autosave on']);
      expect(exposed()).toBe(true);
      await settle(s, 3);
      await frame();
      expect(said).toEqual(['Autosave off', 'Autosave on']);
    } finally {
      watch.disconnect();
    }
  });

  it('with no save-state control showing, focus on Updating goes to the score when it ends', async () => {
    const s = await opened(LAST, { saveStatus: 'saved', initialPolicy: mk(protect(5)) });
    s.setPolicy(mk(protect(3)));
    const updating = page.getByTestId('tl-status').getByRole('button', { name: UPDATING });
    await expect.element(updating).toBeVisible();
    (updating.element() as HTMLElement).focus();
    expect(document.activeElement).toBe(updating.element());
    await settle(s, 2);
    await expect.poll(() => document.activeElement).toBe(scoreBar().element());
  });

  it('the live region holds only the status text; its explanation opens from the header slot', async () => {
    await page.viewport(390, 760);
    const s = await opened();
    s.setPolicy(mk(protect(5)));
    const live = statusSlot();
    await expect.element(live).toHaveTextContent(UPDATING);
    const header = page.getByRole('banner').element();
    const before = header.getBoundingClientRect();
    const scrollW = header.scrollWidth;
    await page.getByTestId('tl-status').getByRole('button', { name: UPDATING }).click();
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toHaveTextContent(STALE_NOTE);
    expect(live.element().contains(tip.element())).toBe(false);
    expect(live.element().querySelector('button')).toBeNull();
    expect(live.element().textContent?.trim()).toBe(UPDATING);
    // Open, it neither widens nor deepens the header: it hangs under the slot.
    const after = header.getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(header.scrollWidth).toBe(scrollW);
    expect(tip.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      statusShown().element().getBoundingClientRect().bottom
    );
  });

  it("Updating's explanation stays open as the pointer stops between it and the status (WCAG 1.4.13)", async () => {
    const s = await opened();
    s.setPolicy(mk(protect(5)));
    const updating = page.getByTestId('tl-status').getByRole('button', { name: UPDATING });
    await expect.element(updating).toBeVisible();
    await userEvent.hover(updating);
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toHaveTextContent(STALE_NOTE);
    const below = updating.element().getBoundingClientRect().bottom;
    expect(tip.element().getBoundingClientRect().top - below).toBeGreaterThan(1);
    await pointerBetween(tip, below);
    await expect.element(tip).toBeVisible();
    await userEvent.hover(tip);
    await expect.element(tip).toHaveTextContent(STALE_NOTE);
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

  /**
   * The pinned block's height with the goal's step drawn (as in production) and nothing in force,
   * then after a first policy's numbers arrive (four legend entries): [before, after].
   */
  async function blockBeforeAfterPolicy(vw: number, vh: number, over: Over = {}) {
    await page.viewport(vw, vh);
    const s = setup({ withInspector: true, ...over });
    await expect.poll(() => workers.length).toBe(1);
    await expect.poll(() => w().lastOf('openTimeline')).toBeTruthy();
    // From Jan 2030 the goal's deadline (Jan 2031) is in the window, so its step is drawn.
    const months = Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(2030, 1 + i, 1));
    const withGoal = { ...STATICS, months };
    emit(compiledMsg(1, withGoal));
    emit(filledMsg(1, 0, LAST + 1));
    await expect.element(slider()).toBeInTheDocument();
    const legend = () =>
      [...document.querySelectorAll('.legend')].find((e) => e.checkVisibility())!;
    await expect.poll(() => legend()?.querySelectorAll('li').length).toBe(2);
    await nextFrame();
    const before = box('tl-pin').height;
    s.setPolicy(mk(protect(5)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, withGoal));
    emit(refillMsg(2, 0));
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().stale).toBe(false);
    await expect.poll(() => legend().querySelectorAll('li').length).toBe(4);
    await nextFrame();
    // The legend stays inside its cell.
    const l = legend();
    expect(l.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      l.parentElement!.getBoundingClientRect().bottom + 0.5
    );
    return [before, box('tl-pin').height];
  }

  // Measured: the ruler row 68 px over a 96 px plot and its border (165); compact, the 52 px ruler
  // row over a 64 px plot (117). The four-entry legend fits the plot at both (70 and 62 px).
  for (const [vh, most] of [
    [900, 165],
    [720, 117]
  ] as const) {
    it(`at 1280x${vh} the pinned block is ${most} px, and a first policy does not move it`, async () => {
      const [before, after] = await blockBeforeAfterPolicy(
        1280,
        vh,
        vh === 720 ? { regionHeight: 636 } : {}
      );
      expect(before).toBeLessThanOrEqual(most + 0.5);
      expect(after).toBe(before);
    });
  }

  // Below md the legend wraps under the plot: measured 193 px at rest, 221 with a policy in force
  // (its four entries take a second 28 px line). Equal heights would cost a blank line at rest.
  it('at 375x812 a first policy adds at most one legend line to the pinned block', async () => {
    const [before, after] = await blockBeforeAfterPolicy(375, 812);
    expect(before).toBeLessThanOrEqual(193.5);
    expect(after - before).toBeLessThanOrEqual(28.5);
  });

  it('at 1280x800 the rows box is at least 90 px tall', async () => {
    await page.viewport(1280, 800);
    await opened(LAST, { withInspector: true });
    await expect.element(slider()).toBeInTheDocument();
    await nextFrame();
    expect(box('tl-mode').height).toBe(700);
    expect(box('tl-rows').height).toBeGreaterThanOrEqual(90);
  });

  // The mode box at 1280x720: 636 px on /sim, 585 px on /s/<id> under the shared banner.
  for (const regionHeight of [636, 585]) {
    it(`at 1280x720 (a ${regionHeight} px mode box) the rows box is at least 90 px tall`, async () => {
      await page.viewport(1280, 720);
      await opened(LAST, { withInspector: true, regionHeight });
      await expect.element(slider()).toBeInTheDocument();
      await nextFrame();
      expect(box('tl-mode').height).toBe(regionHeight);
      expect(box('tl-rows').height).toBeGreaterThanOrEqual(90);
      // Its targets stay at least 24 px tall.
      const pin = page.getByTestId('tl-pin').element();
      for (const el of pin.querySelectorAll('button, [role=slider]'))
        expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    });
  }

  /** The one-piece timeline's scroll box: tl-lanes from md, tl-mode below md. */
  function port(phone: boolean): { top: number; bottom: number } {
    const r = box(phone ? 'tl-mode' : 'tl-lanes');
    return { top: r.top, bottom: r.bottom };
  }
  const overflowOf = (id: string) => getComputedStyle(page.getByTestId(id).element()).overflowY;

  // WCAG 2.2 2.4.11 at 400% zoom (320x256) and in a 400 px tall window from md (960x400, a 316 px
  // mode box): a box too short for the block and some rows scrolls the timeline as one piece, so
  // a focused row is never under the block. (At 960x540 this fixture's 117 px compact block
  // leaves 64.4 px of rows, so the rows keep their own box there.)
  for (const [vw, vh, regionHeight, phone] of [
    [320, 256, 172, true],
    [960, 400, 316, false]
  ] as const) {
    it(`at ${vw}x${vh} the timeline is one piece and a focused bar shows whole`, async () => {
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
      await expect.poll(() => overflowOf('tl-rows')).toBe('visible');
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

  it('at 1280x720 the rows box scrolls under the pinned block', async () => {
    await page.viewport(1280, 720);
    await opened(LAST, { withInspector: true, regionHeight: 636 });
    await expect.element(slider()).toBeInTheDocument();
    await nextFrame();
    await nextFrame();
    expect(overflowOf('tl-rows')).toBe('auto');
    expect(overflowOf('tl-lanes')).not.toBe('auto');
    expect(Math.abs(box('tl-rows').top - box('tl-pin').bottom)).toBeLessThanOrEqual(0.5);
    expect(box('tl-rows').bottom).toBeLessThanOrEqual(box('tl-lanes').bottom + 0.5);
  });

  it('the rows box becomes the scroll box again when its box grows', async () => {
    await page.viewport(960, 400);
    await opened(LAST, { withInspector: true, regionHeight: 316 });
    await expect.element(slider()).toBeInTheDocument();
    await expect.poll(() => overflowOf('tl-rows')).toBe('visible');
    await page.viewport(1280, 900);
    document.getElementById('map-region')!.style.height = '700px';
    await expect.poll(() => overflowOf('tl-rows')).toBe('auto');
  });

  it("from md the chart's legend stacks in the label column, legible and clear of axe", async () => {
    await opened(LAST, { withInspector: true });
    await expect.element(page.getByTestId('tl-chart-legend')).toBeVisible();
    const legend = page.getByTestId('tl-chart-legend').element() as HTMLElement;
    const lab = legend.parentElement!.getBoundingClientRect();
    expect(lab.width).toBe(168);
    const names = [...legend.querySelectorAll('li')].map((li) => li.textContent!.trim());
    // The fixture's 24 months end before the goal's deadline: no step, so no goal entry.
    expect(page.getByTestId('chart-target').elements()).toEqual([]);
    expect(names).toEqual(['Homes completed']);
    for (const li of legend.querySelectorAll('li')) {
      expect(li.getBoundingClientRect().right).toBeLessThanOrEqual(lab.right);
      expect(li.scrollWidth).toBeLessThanOrEqual(li.clientWidth);
      expect(parseFloat(getComputedStyle(li).fontSize)).toBeGreaterThanOrEqual(12);
    }
    expect(legend.getBoundingClientRect().bottom).toBeLessThanOrEqual(lab.bottom);
    // The legend under the plot is gone from md; the plot keeps the lane's width.
    const fig = page.getByTestId('tl-lanes').getByRole('figure');
    expect(getComputedStyle(fig.element().querySelector('.legend')!).display).toBe('none');
    expect(page.getByTestId('chart-svg').element().getBoundingClientRect().height).toBe(96);
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
    await expect.element(fig).toHaveAccessibleName('Homes completed');
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
    await expect.element(fig).toHaveAccessibleName('Homes completed');
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
