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
import { GOAL_BASE, defaultGoal, goalName, type Goal } from '$lib/goal/goal';
import { formatDollars, formatShortMonthYear } from '$lib/fzp/format';
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
import placesRaw from '../../../e2e/fixtures/data/fixture-0/neighborhoods.geojson?raw';
import { SLOT_FLAG, type CityDelta, type TimelineUpdate } from '$lib/map/types';
import { parseNeighborhoods, type NeighborhoodShapes } from '$lib/sim/levers/brushes';
import {
  CHANGE_NOT_APPLIED,
  STALE_NOTE,
  UPDATING,
  WAITING_NOTE,
  goalNote,
  homesBy,
  playFromText
} from './copy';
import { filledEndDay, indexOfDay } from './playhead';
import { DEFAULT_POLICY4, queriesOf4, type Policy, type SimPolicy4 } from './policy4';
import { goalOutcome } from './outcome';
import { headlineAt, headlineSpoken, headlineText, scoreOfView } from './results';
import { PIPELINE_DASH } from './chart-lens';
import { keyTally } from './key';
import { levelSet } from './pool-level';
import { dayPct } from './rows';
import { scanned } from './reveal';
import type { Lots } from './session.svelte';
import {
  FakeTimelineWorker,
  cellsMsg,
  compiledMsg,
  errorMsg,
  filledMsg,
  refillMsg
} from './test/fake-timeline-worker';
import { chunk, statics as baseStatics } from './test/fixtures';
import type { Pool } from '$lib/timelapse/types';
import type { AddChoice } from './add';
import TimelineModeHost from './test/TimelineModeHost.svelte';
import { pointerBetween } from './test/pointer';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
// The reveal rules as they are, with `scanned` counted (when the page scans, and what it ended).
// The goal outcome as it is, with its calls counted (when the page reads the rows for it).
vi.mock('./outcome', async (importOriginal) => {
  const real = await importOriginal<typeof import('./outcome')>();
  return { ...real, goalOutcome: vi.fn(real.goalOutcome) };
});
vi.mock('./reveal', async (importOriginal) => {
  const real = await importOriginal<typeof import('./reveal')>();
  return { ...real, scanned: vi.fn(real.scanned) };
});
// Details' score as it is, counted (when Details rebuilds).
vi.mock('./results', async (importOriginal) => {
  const real = await importOriginal<typeof import('./results')>();
  return { ...real, scoreOfView: vi.fn(real.scoreOfView) };
});
// Activity's index as it is, each instance kept (its sort counter guards the playhead path).
const { indexes } = vi.hoisted(() => ({ indexes: [] as { sorts: number }[] }));
vi.mock('./activity', async (importOriginal) => {
  const real = await importOriginal<typeof import('./activity')>();
  class Kept extends real.ActivityIndex {
    constructor() {
      super();
      indexes.push(this);
    }
  }
  return { ...real, ActivityIndex: Kept };
});
// The pool levels as they are, counted (when the page rebuilds them).
vi.mock('./pool-level', async (importOriginal) => {
  const real = await importOriginal<typeof import('./pool-level')>();
  return { ...real, levelSet: vi.fn(real.levelSet) };
});
// The key's tally as it is, counted (when the page reads a row for it).
vi.mock('./key', async (importOriginal) => {
  const real = await importOriginal<typeof import('./key')>();
  return { ...real, keyTally: vi.fn(real.keyTally) };
});

const manifest: Manifest = parseManifest(manifestJson);
const FIXTURE_PLACES: NeighborhoodShapes = parseNeighborhoods(JSON.parse(placesRaw));
const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const MONTHS: Day[] = Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const STATICS: ScoreStatics = { ...baseStatics({ lastIndex: LAST }), asOf, months: MONTHS };
const windowEnd = monthLastDay(asOf, WINDOW_MONTHS);
/** A goal whose deadline (Jan 2031) falls inside the fixture's short window. */
const TEST_GOAL: Goal = { ...defaultGoal(asOf), deadline: dayFromUtc(2031, 1, 31) };

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
  /** Overrides the page's `saveOff` (autosave off: "Updating" beside the save state). */
  saveOff: boolean;
  /** The goal the page reads (a test seam; default the page's goal). */
  goal: Goal;
  /** The page opens with its data failed (Retry shows); `reload` is what Retry brings. */
  calibrationError: boolean;
  reload: () => Promise<{ manifest: Manifest; calibration: typeof cal }>;
  readonly: boolean;
  face: 'details' | 'activity';
  onstarter: (choice: AddChoice, label: string) => void;
  ondetails: () => void;
  onactivity: () => void;
  fetchPlaces: (url: string) => Promise<NeighborhoodShapes | null>;
  spacePlays: boolean;
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
    showDetails?: () => Promise<void>;
    showActivity?: () => Promise<void>;
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
      calibrationError: over.calibrationError ?? false,
      noScenario: over.noScenario ?? false,
      datasetVersion: 'fixture-0',
      reload: over.reload ?? (async () => ({ manifest, calibration: cal })),
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
      ...(over.saveStatus ? { saveStatus: over.saveStatus } : {}),
      ...(over.saveOff !== undefined ? { saveOff: over.saveOff } : {}),
      ...(over.goal ? { goal: over.goal } : {}),
      ...(over.readonly ? { readonly: true } : {}),
      ...(over.face ? { face: over.face } : {}),
      ...(over.onstarter ? { onstarter: over.onstarter } : {}),
      ...(over.ondetails ? { ondetails: over.ondetails } : {}),
      ...(over.onactivity ? { onactivity: over.onactivity } : {}),
      ...(over.spacePlays !== undefined ? { spacePlays: over.spacePlays } : {}),
      fetchPlaces: over.fetchPlaces ?? (async () => FIXTURE_PLACES)
    }
  });
  return {
    r,
    createWorker,
    setPolicy: (p: SimPolicy4) => ctl.setPolicy!(p),
    setLots: (l: Lots | null) => ctl.setLots!(l),
    setLotsFailed: (f: boolean) => ctl.setLotsFailed!(f),
    setSaveStatus: (st: SaveStatus) => ctl.setSaveStatus!(st),
    showDetails: () => ctl.showDetails!(),
    showActivity: () => ctl.showActivity!()
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
/** A Space keydown dispatched on `target` (it bubbles to the window), returned for its state. */
function spaceOn(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function spaceUp(target: EventTarget): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
}

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

    it('Space plays and pauses; after an edit it plays from the first changed month', async () => {
      const s = await opened(LAST, { initialPolicy: before });
      await keysTo(20, 15);
      await edit(s, mk(protect(7)), 2);
      await answer(2, 8, 12);
      await expect.element(playLabelEl()).toHaveTextContent(playFromText(MONTHS[12]));
      (document.activeElement as HTMLElement | null)?.blur();
      // Read in the key's own task: no frame of playback can come between.
      const down = spaceOn(document.body);
      expect(down.defaultPrevented).toBe(true);
      expect(debug().day).toBe(MONTHS[12]);
      expect(debug().playing).toBe(true);
      expect(debug().playFrom).toBeNull();
      spaceUp(document.body);
      await expect.element(playButton()).toHaveAccessibleName('Pause');
      // A real press on the date slider pauses.
      (slider().element() as HTMLElement).focus();
      await userEvent.keyboard(' ');
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

  describe('Space', () => {
    it('Space on a button presses the button and leaves Play', async () => {
      await opened();
      const speed = page.getByTestId('tl-speed');
      (speed.element() as HTMLElement).focus();
      const before = debug().speed;
      await userEvent.keyboard(' ');
      await expect.poll(() => debug().speed).not.toBe(before);
      expect(debug().playing).toBe(false);
      // The Play button itself: its own press, once.
      (playButton().element() as HTMLElement).focus();
      await userEvent.keyboard(' ');
      await expect.poll(() => debug().playing).toBe(true);
      await userEvent.keyboard(' ');
      await expect.poll(() => debug().playing).toBe(false);
    });

    it('a held Space toggles once', async () => {
      await opened();
      (document.activeElement as HTMLElement | null)?.blur();
      expect(spaceOn(document.body).defaultPrevented).toBe(true);
      expect(debug().playing).toBe(true);
      // The repeats while held: no toggle, but handled, so the page never scrolls.
      for (let i = 0; i < 3; i++) {
        expect(spaceOn(document.body, { repeat: true }).defaultPrevented).toBe(true);
        expect(debug().playing).toBe(true);
      }
      spaceUp(document.body);
      expect(debug().playing).toBe(true);
      // Released: a repeat no press took is left to the browser.
      expect(spaceOn(document.body, { repeat: true }).defaultPrevented).toBe(false);
      spaceOn(document.body);
      expect(debug().playing).toBe(false);
      // A blur ends the press as a keyup does.
      window.dispatchEvent(new Event('blur'));
      expect(spaceOn(document.body, { repeat: true }).defaultPrevented).toBe(false);
      expect(debug().playing).toBe(false);
      spaceUp(document.body);
    });

    it('not in a field, with a modifier, already handled or under a modal dialog', async () => {
      await opened();
      const field = document.createElement('input');
      document.body.appendChild(field);
      const dialog = document.createElement('dialog');
      document.body.appendChild(dialog);
      try {
        expect(spaceOn(field).defaultPrevented).toBe(false);
        expect(debug().playing).toBe(false);
        // After each press, so two wrong toggles cannot cancel out.
        for (const mod of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) {
          expect(spaceOn(document.body, { [mod]: true }).defaultPrevented, mod).toBe(false);
          expect(debug().playing, mod).toBe(false);
        }
        const handled = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        handled.preventDefault();
        document.body.dispatchEvent(handled);
        expect(debug().playing).toBe(false);
        dialog.showModal();
        expect(spaceOn(document.body).defaultPrevented).toBe(false);
        dialog.close();
        expect(debug().playing).toBe(false);
      } finally {
        field.remove();
        dialog.remove();
      }
    });

    it('About open: Space does not play', async () => {
      await opened();
      await page.getByRole('link', { name: 'About', exact: true }).click();
      await expect.element(page.getByRole('dialog', { name: 'About this model' })).toBeVisible();
      spaceOn(document.body);
      expect(debug().playing).toBe(false);
      await userEvent.keyboard('{Escape}');
    });

    it('spacePlays false: Space does nothing', async () => {
      await opened(LAST, { spacePlays: false });
      (document.activeElement as HTMLElement | null)?.blur();
      expect(spaceOn(document.body).defaultPrevented).toBe(false);
      spaceUp(document.body);
      expect(debug().playing).toBe(false);
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
      .getByRole('button', { name: /, Market conditions, whole window$/ })
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
      headlineAt(
        FULL(),
        { index: i, atToday: false },
        { provisional: false, inForce: false },
        defaultGoal(asOf)
      )!,
      defaultGoal(asOf)
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
    const results = page.getByTestId('tl-details');
    await expect.element(results).toHaveTextContent('What current law added');
    expect(results.element().textContent).not.toContain('your policy');
  });

  it('a policy in force: the header shows the plan effect and Details the your-policy copy', async () => {
    await opened(LAST, { withInspector: true, initialPolicy: mk(protect(5)) });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{PageUp}');
    await expect.poll(() => debug().day).toBeGreaterThan(asOf);
    const i = playheadMonth();
    await expect
      .element(page.getByTestId('score-delta'))
      .toHaveTextContent(fromPolicyText(FULL().planEffect[i].completedNetNew));
    await expect
      .element(page.getByTestId('tl-details'))
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

  it('Escape on a hovered explanation leaves the card open; the next Escape closes the card', async () => {
    await page.viewport(1280, 800);
    const s = await opened();
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    w().emit({ type: 'parcelSummary', reqId: req.reqId, summary: summary(REAL_ACTUAL) });
    const heading = page.getByTestId('tl-card').getByRole('heading', { level: 2 });
    await expect.element(heading).toBeInTheDocument();
    // "Updating" mounts its explanation after the card, so its window listener is later in line.
    s.setPolicy(mk(protect(5)));
    await expect.element(statusShown()).toHaveTextContent(UPDATING);
    await statusShown().getByRole('button', { name: UPDATING }).hover();
    await expect.element(page.getByText(STALE_NOTE)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByText(STALE_NOTE)).not.toBeInTheDocument();
    await expect.element(heading).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(heading).not.toBeInTheDocument();
  });

  it("the card's source link opens About at its entry and pauses", async () => {
    await page.viewport(1280, 800);
    await opened();
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    w().emit({ type: 'parcelSummary', reqId: req.reqId, summary: summary(REAL_ACTUAL) });
    const card = page.getByTestId('tl-card');
    await expect.element(card.getByRole('heading', { level: 2 })).toBeInTheDocument();
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(true);
    // Nothing of About is built before it opens.
    expect(document.getElementById('about-assumptions')).toBeNull();
    await card.getByText('How is this estimated?').click();
    const source = card.element().querySelector<HTMLButtonElement>('details li button')!;
    await userEvent.click(source);
    const dialog = page.getByRole('dialog', { name: 'About this model' });
    await expect.element(dialog).toBeVisible();
    expect(debug().playing).toBe(false);
    const day = debug().day;
    // Scrolled to an entry of the assumptions: one sits at the top of the scroll box.
    const box = dialog.element().querySelector('[data-about-scroll]')!;
    await expect
      .poll(() =>
        [...box.querySelectorAll('[id^="src-"]')].some(
          (el) => Math.abs(el.getBoundingClientRect().top - box.getBoundingClientRect().top) < 24
        )
      )
      .toBe(true);
    expect(box.scrollTop).toBeGreaterThan(0);
    const el = dialog.element() as HTMLDialogElement;
    await dialog.getByRole('button', { name: 'Close' }).click();
    expect(el.open).toBe(false);
    // The run stays: the playhead where it paused, the card open, focus back on the source.
    expect(debug().day).toBe(day);
    expect(debug().playing).toBe(false);
    await expect.element(card.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(document.activeElement).toBe(source);
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
    const results = page.getByTestId('tl-details');
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

  /** Details and the header keep the current-law wording now; after `answer` the policy's. */
  async function heldWordingThenPolicy(answer: () => void) {
    const results = page.getByTestId('tl-details');
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
      .element(page.getByTestId('tl-details'))
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

  it('levels rebuild with the view, never as the playhead crosses months', async () => {
    const bond: Pool = {
      id: 'u-bond',
      kind: 'generalRevenue',
      label: 'Housing bond',
      inflows: [{ kind: 'once', day: monthFirstDay(asOf, 2), dollars: 500_000_000 }],
      debt: null,
      leverage: 1
    };
    const doc: SimPolicy4 = {
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
                what: { tag: 'fund', pool: bond, programmes: [] }
              }
            ]
          }
        ]
      }
    };
    const FIN: ScoreStatics = {
      ...baseStatics({ lastIndex: LAST, finance: true }),
      asOf,
      months: MONTHS
    };
    const filledPools = (rev: number, from: number, base = 0) =>
      emit({
        type: 'filled',
        rev,
        through: LAST,
        series: chunk(from, LAST + 1 - from, { pools: ['u-bond'], base })
      });
    setup({ initialPolicy: doc });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, FIN));
    filledPools(1, 0);
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    await page
      .getByTestId('tl-timeline')
      .getByRole('button', { name: 'Public money', exact: true })
      .click();
    const fill = () =>
      document.querySelector(
        '[data-testid=tl-kind-money] [data-testid=tl-bar] [data-testid=tl-level]'
      );
    await expect.poll(fill).not.toBeNull();
    const builds = vi.mocked(levelSet).mock.calls.length;
    expect(builds).toBeGreaterThan(0);
    // Across six months: the percent follows the playhead, the levels are not rebuilt.
    (slider().element() as HTMLElement).focus();
    for (let k = 1; k <= 6; k++) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBeGreaterThanOrEqual(MONTHS[k]);
    }
    await expect.poll(() => fill()!.getAttribute('data-left')).toMatch(/^\d+$/);
    expect(vi.mocked(levelSet).mock.calls.length).toBe(builds);
    // A new view rebuilds them.
    emit(refillMsg(1, 3));
    filledPools(1, 3, 5);
    await expect.poll(() => vi.mocked(levelSet).mock.calls.length).toBeGreaterThan(builds);
  });

  it('while an edit waits for its numbers the levels are dimmed as held numbers', async () => {
    const bond = (dollars: number): Pool => ({
      id: 'u-bond',
      kind: 'generalRevenue',
      label: 'Housing bond',
      inflows: [{ kind: 'once', day: monthFirstDay(asOf, 2), dollars }],
      debt: null,
      leverage: 1
    });
    const doc = (dollars: number): SimPolicy4 => ({
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
                what: { tag: 'fund', pool: bond(dollars), programmes: [] }
              }
            ]
          }
        ]
      }
    });
    const FIN: ScoreStatics = {
      ...baseStatics({ lastIndex: LAST, finance: true }),
      asOf,
      months: MONTHS
    };
    const filledPools = (rev: number) =>
      emit({
        type: 'filled',
        rev,
        through: LAST,
        series: chunk(0, LAST + 1, { pools: ['u-bond'] })
      });
    const s = setup({ initialPolicy: doc(500_000_000) });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, FIN));
    filledPools(1);
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    await page
      .getByTestId('tl-timeline')
      .getByRole('button', { name: 'Public money', exact: true })
      .click();
    const fills = () => [
      ...document.querySelectorAll('[data-testid=tl-kind-money] [data-testid=tl-level]')
    ];
    await expect.poll(() => fills().length).toBeGreaterThan(0);
    expect(fills().every((f) => !f.hasAttribute('data-stale'))).toBe(true);
    // An edit: the held numbers stay, dimmed, until its refill lands.
    s.setPolicy(doc(250_000_000));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    await expect.poll(() => debug().stale).toBe(true);
    await expect
      .poll(() => fills().every((f) => f.getAttribute('data-stale') === 'true'))
      .toBe(true);
    emit(compiledMsg(2, FIN));
    emit(refillMsg(2, 0));
    filledPools(2);
    await expect.poll(() => debug().stale).toBe(false);
    await expect.poll(() => fills().some((f) => f.hasAttribute('data-stale'))).toBe(false);
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

  it("a crash's restart keeps the goal's step, flag and legend while held numbers show", async () => {
    // The client logs each crash; silenced here so signoff's stderr check stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A deadline inside the fixture's window, so the step is drawn.
    await opened(LAST, { goal: { ...GOAL_BASE, amount: 1100, deadline: MONTHS[12] } });
    const flag = page.getByTestId('tl-goal-flag');
    const legend = page.getByTestId('tl-chart-legend');
    const step = page.getByTestId('chart-target');
    await expect.element(flag).toBeInTheDocument();
    await expect.element(step).toBeInTheDocument();
    await expect.element(legend).toHaveTextContent('Goal');
    w().crash();
    const notices = page.getByTestId('tl-notices');
    await expect.element(notices).toHaveTextContent('Part of the simulation stopped.');
    await notices.getByRole('button', { name: 'Retry' }).click();
    // Re-opened with nothing filled yet: the held numbers stay on show.
    await expect.poll(() => debug().filledThrough).toBe(-1);
    expect(debug().stale).toBe(true);
    await tick();
    expect(flag.query()).not.toBeNull();
    expect(step.query()).not.toBeNull();
    expect(legend.element().textContent).toContain('Goal');
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
      baseline: { ...base.baseline, units: defaultGoal(asOf).amount - need }
    };
    setup({ goal: TEST_GOAL });
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

  it('while stale the map canvas, Details, card and header dim; their controls keep full contrast', async () => {
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
        '[data-testid=tl-details] button, [data-testid=tl-card] button, [data-testid=header-pinned] button, [data-testid=fzp-sim-map-stub]'
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

  it('the live region changes at most once per statusMs, latest wins', async () => {
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

  it('Updating shows and goes with stale at once', async () => {
    const s = await opened(LAST, { statusMs: 1000 });
    const live = () => statusSlot().element().textContent?.trim();
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    // No timer runs: whatever shows follows the conditions without waiting on statusMs.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      s.setPolicy(mk(protect(5)));
      await expect.poll(shownText).toBe(UPDATING);
      s.setLots({});
      await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
      emit(compiledMsg(2, STATICS));
      emit(refillMsg(2, 3));
      await expect.poll(() => debug().stale).toBe(false);
      await expect.poll(shownText).toBe('');
      // The live region is still inside its gap.
      expect(live()).toBe(UPDATING);
      s.setPolicy(mk(protect(3)));
      await expect.poll(shownText).toBe(UPDATING);
    } finally {
      vi.useRealTimers();
    }
  });

  /** The status cell's shown text. */
  const shownText = () => statusShown().element().textContent?.trim();
  const updatingButton = () =>
    page.getByTestId('tl-status').getByRole('button', { name: UPDATING });
  /** Filled through month 5, the playhead at the computed edge, playing: it waits there. */
  async function playingAtEdge(over: Over = {}) {
    const s = await opened(5, over);
    await expect.poll(() => debug().filledThrough).toBe(5);
    const edge = filledEndDay(MONTHS, 5, asOf);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect.poll(() => debug().day).toBe(edge);
    expect(shownText()).toBe('');
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(true);
    return { s, edge };
  }

  for (const width of [375, 1280]) {
    it(`at ${width} px autosave off: Updating sits beside the chip, the chip stays pressable`, async () => {
      await page.viewport(width, 900);
      const s = await opened(LAST, { saveStatus: 'off', initialPolicy: mk(protect(5)) });
      const chip = page.getByRole('button', { name: 'Autosave off' });
      await expect.element(chip).toBeVisible();
      const chipEl = chip.element() as HTMLButtonElement;
      const pop = document.getElementById(chipEl.getAttribute('aria-controls')!)!;
      chipEl.focus();
      s.setPolicy(mk(protect(3)));
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      await expect.element(updatingButton()).toBeVisible();
      // Both show, side by side; focus stays on the chip, which stays in the tab order.
      expect(chipEl.checkVisibility({ visibilityProperty: true })).toBe(true);
      expect(chipEl.closest('[inert]')).toBeNull();
      expect(document.activeElement).toBe(chipEl);
      const a = chipEl.getBoundingClientRect();
      const b = updatingButton().element().getBoundingClientRect();
      expect(b.left).toBeGreaterThanOrEqual(a.right);
      expect(Math.abs(a.top + a.height / 2 - (b.top + b.height / 2))).toBeLessThanOrEqual(1);
      // A real press on each: the chip's popover opens; "Updating"'s explanation opens.
      await chip.click();
      await expect.poll(() => pop.hidden).toBe(false);
      await expect.element(statusShown()).toHaveTextContent(UPDATING);
      await updatingButton().click();
      await expect.element(page.getByRole('tooltip')).toHaveTextContent(STALE_NOTE);
    });
  }

  it('autosave off: the cell keeps its width as Updating comes and goes', async () => {
    await page.viewport(1280, 900);
    const s = await opened(LAST, { saveStatus: 'off', initialPolicy: mk(protect(5)) });
    const chip = page.getByRole('button', { name: 'Autosave off' });
    await expect.element(chip).toBeVisible();
    await frame();
    const rects = () => ({
      cell: page.getByTestId('tl-status-group').element().getBoundingClientRect().toJSON(),
      chip: chip.element().getBoundingClientRect().toJSON(),
      score: scoreBar().element().getBoundingClientRect().toJSON()
    });
    const off = rects();
    s.setPolicy(mk(protect(3)));
    await expect.element(updatingButton()).toBeVisible();
    await frame();
    expect(rects()).toEqual(off);
    await settle(s, 2);
    await frame();
    expect(rects()).toEqual(off);
  });

  it('a worker error while Play waits at the edge: the cell empties, the notice shows', async () => {
    await playingAtEdge();
    await expect.poll(shownText).toBe(UPDATING);
    emit(errorMsg(1, 'timeline'));
    await expect
      .element(page.getByTestId('tl-alerts'))
      .toHaveTextContent('Part of the simulation stopped.');
    await expect.poll(shownText).toBe('');
    await expect.element(statusSlot()).not.toHaveTextContent(UPDATING);
  });

  it('a worker crash while Play waits at the edge: the cell empties, the notice shows', async () => {
    // The client logs each crash; silenced here so signoff's stderr check stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await playingAtEdge();
    await expect.poll(shownText).toBe(UPDATING);
    w().crash();
    await expect
      .element(page.getByTestId('tl-notices'))
      .toHaveTextContent('Part of the simulation stopped.');
    await expect.poll(shownText).toBe('');
    await expect.element(statusSlot()).not.toHaveTextContent(UPDATING);
  });

  it('Play caught by the computed edge on a first load: Updating, explained by Working out the months ahead.', async () => {
    await playingAtEdge();
    await expect.poll(shownText).toBe(UPDATING);
    await expect.element(statusSlot()).toHaveTextContent(UPDATING);
    expect(debug().stale).toBe(false);
    await updatingButton().click();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(WAITING_NOTE);
  });

  it('waiting does not flicker as the fill moves the edge on; it goes when the forecast is whole or on Pause', async () => {
    const { edge } = await playingAtEdge();
    await expect.poll(shownText).toBe(UPDATING);
    const seen: string[] = [];
    const watch = new MutationObserver(() => seen.push(shownText() ?? ''));
    watch.observe(statusShown().element(), {
      childList: true,
      characterData: true,
      subtree: true
    });
    try {
      // The edge moves on and the playhead follows it: "Updating" holds throughout.
      emit(filledMsg(1, 6, 3));
      await expect.poll(() => debug().filledThrough).toBe(8);
      await expect.poll(() => debug().day).toBeGreaterThan(edge);
      await expect.poll(() => debug().day).toBe(filledEndDay(MONTHS, 8, asOf));
      expect(debug().playing).toBe(true);
      expect(shownText()).toBe(UPDATING);
      expect(seen.filter((t) => t !== UPDATING)).toEqual([]);
      // Pause: it goes.
      await playButton().click();
      await expect.poll(() => debug().playing).toBe(false);
      await expect.poll(shownText).toBe('');
      // Playing again at the edge, then the forecast whole: it goes.
      await playButton().click();
      await expect.poll(shownText).toBe(UPDATING);
      emit(filledMsg(1, 9, LAST - 8));
      await expect.poll(() => debug().filledThrough).toBe(LAST);
      await expect.poll(shownText).toBe('');
    } finally {
      watch.disconnect();
    }
  });

  it('stale while waiting: the explanation is From before your latest change.', async () => {
    const { s } = await playingAtEdge();
    await expect.poll(shownText).toBe(UPDATING);
    s.setPolicy(mk(protect(5)));
    await expect.poll(() => debug().stale).toBe(true);
    // Play again at the edge while the numbers are stale: both apply, stale wins.
    await expect.poll(() => debug().playing).toBe(false);
    await playButton().click();
    await expect.poll(() => debug().playing).toBe(true);
    expect(shownText()).toBe(UPDATING);
    await updatingButton().click();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(STALE_NOTE);
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
    // The cover itself: a save state with a control under "Updating" in one cell. The page keeps
    // the chip beside "Updating" (`saveOff`); here the test turns that off to cover it.
    it(`at ${width} px focus moves with the cover, never to the body; nothing moves; the popover closes`, async () => {
      await page.viewport(width, 900);
      // A policy in force throughout, so the score's effect line is there before and after.
      const s = await opened(LAST, {
        saveStatus: 'off',
        saveOff: false,
        initialPolicy: mk(protect(5))
      });
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
    const s = setup({ withInspector: true, goal: TEST_GOAL, ...over });
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
        .getByRole('button', { name: /, Market conditions, whole window$/ })
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

  /** Activity's totals as [term, value] pairs. */
  const totalsOf = () =>
    [...document.querySelectorAll('[data-testid=tl-totals] > div')].map((d) => [
      d.querySelector('dt')!.textContent!.trim(),
      d.querySelector('dd')!.textContent!.trim()
    ]);

  it('without the goal seam the goal is defaultGoal(asOf): Activity names it', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false });
    const activity = page.getByTestId('tl-inspector').getByTestId('tl-activity');
    await expect.element(activity.getByText(goalName(defaultGoal(asOf)))).toBeVisible();
    expect(goalName(defaultGoal(asOf))).toMatch(/^Goal: 82,069 homes by [A-Z][a-z]{2} \d{4}$/);
  });

  it('from md at rest the detail column shows Activity', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false });
    const insp = page.getByTestId('tl-inspector');
    const activity = insp.getByTestId('tl-activity');
    await expect.element(activity).toBeVisible();
    expect(document.querySelector('[data-testid=host-inspector]')).toBeNull();
    expect(document.querySelector('[data-testid=tl-details]')).toBeNull();
    await expect
      .element(activity.getByRole('heading', { level: 2, name: 'Activity' }))
      .toBeVisible();
    // At today: the goal, and without onstarter (read-only) Press Play, no starters.
    await expect.element(activity.getByText(goalName(defaultGoal(asOf)))).toBeVisible();
    await expect.element(activity.getByText('Press Play to see what gets built.')).toBeVisible();
    // Padded as the Inspector is: the text keeps off the column's edge.
    const pad = getComputedStyle(activity.element());
    expect(pad.paddingLeft).toBe('12px');
    expect(pad.paddingRight).toBe('12px');
  });

  /** The detail column's bottom fade: its ::after's opacity. */
  const fadeOf = (el: Element) => Number(getComputedStyle(el, '::after').opacity);

  it('the detail column shows no fade at its foot when its content fits', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false, regionHeight: 900 });
    const col = page.getByTestId('tl-inspector').element() as HTMLElement;
    await expect.element(page.getByTestId('tl-activity')).toBeVisible();
    expect(col.scrollHeight).toBeLessThanOrEqual(col.clientHeight);
    expect(fadeOf(col)).toBe(0);
  });

  it('the detail column fades at its foot while more is below; scrolled to its end, none', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false, regionHeight: 300 });
    const col = page.getByTestId('tl-inspector').element() as HTMLElement;
    await expect.element(page.getByTestId('tl-activity')).toBeVisible();
    // After today Activity lists its totals: more than the short column holds.
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    await expect.element(page.getByTestId('tl-totals')).toBeVisible();
    await expect.poll(() => col.scrollHeight).toBeGreaterThan(col.clientHeight);
    await expect.poll(() => fadeOf(col)).toBe(1);
    // The fade never takes a press: what is under it stays reachable.
    expect(getComputedStyle(col, '::after').pointerEvents).toBe('none');
    // Focus scrolls clear of it.
    expect(parseFloat(getComputedStyle(col).scrollPaddingBottom)).toBeGreaterThanOrEqual(
      parseFloat(getComputedStyle(col, '::after').height)
    );
    col.scrollTop = col.scrollHeight;
    await expect.poll(() => fadeOf(col)).toBe(0);
  });

  it('Activity at today offers the starters with nothing in force; one calls onstarter', async () => {
    const onstarter = vi.fn();
    const s = await opened(LAST, { withInspector: true, inspectorOpen: false, onstarter });
    const activity = page.getByTestId('tl-activity');
    const list = activity.getByRole('list', { name: 'Try one:' });
    await expect.element(list).toBeVisible();
    expect(
      list
        .getByRole('button')
        .elements()
        .map((b) => b.textContent!.trim())
    ).toEqual(['Taller near transit', 'SB 423 approval clock', 'A housing bond']);
    await list.getByRole('button', { name: 'Taller near transit' }).click();
    expect(onstarter).toHaveBeenCalledExactlyOnceWith(
      { kind: 'zoning', what: 'transit' },
      'Transit rule'
    );
    // A policy in force in the edited document: Press Play instead, at once.
    s.setPolicy(mk(protect(5)));
    await expect.element(activity.getByText('Press Play to see what gets built.')).toBeVisible();
    expect(activity.getByText('Try one:').elements()).toHaveLength(0);
  });

  it("Activity's totals read the header's month: today, then each month crossed", async () => {
    await opened(LAST, {
      withInspector: true,
      inspectorOpen: false,
      initialPolicy: mk(protect(5))
    });
    const activity = page.getByTestId('tl-activity');
    await expect.element(activity).toBeVisible();
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    const full = viewOf([chunk(0, LAST + 1)], STATICS);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    expect(document.querySelector('[data-testid=tl-totals]')).toBeNull();
    await expect.element(activity.getByText(goalName(defaultGoal(asOf)))).toBeVisible();
    for (let k = 1; k <= 3; k++) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBe(MONTHS[k]);
      const h = headlineAt(
        full,
        { index: k, atToday: false },
        { provisional: false, inForce: true },
        defaultGoal(asOf)
      )!;
      await expect.element(scoreBar()).toHaveTextContent(homesBy(h.homes, h.at));
      await expect.poll(totalsOf).toEqual([
        ['Approved in new projects', String(full.rows[k].entitledNew)],
        ['Completed', String(h.homes)],
        ['Stopped', String(full.rows[k].exitedUnits)],
        ['From your policy', `+${h.effect}`]
      ]);
      expect(activity.getByText(goalName(defaultGoal(asOf))).elements()).toHaveLength(0);
    }
  });

  it("stale: totals and cost are the held document's, dimmed", async () => {
    const pool: Pool = {
      id: 'u-bond',
      kind: 'goBond',
      label: 'Bond',
      inflows: [{ kind: 'once', day: monthFirstDay(asOf, 2), dollars: 100_000_000 }],
      debt: null,
      leverage: 1
    };
    const bondDoc: SimPolicy4 = {
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
                what: { tag: 'fund', pool, programmes: [] }
              }
            ]
          }
        ]
      }
    };
    const FIN: ScoreStatics = {
      ...baseStatics({ lastIndex: LAST, finance: true }),
      asOf,
      months: MONTHS
    };
    const s = setup({ withInspector: true, inspectorOpen: false, initialPolicy: bondDoc });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, FIN));
    emit({
      type: 'filled',
      rev: 1,
      through: LAST,
      series: chunk(0, LAST + 1, { pools: ['u-bond'] })
    });
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    await expect.poll(() => debug().day).toBe(MONTHS[3]);
    const activity = page.getByTestId('tl-activity');
    const body = activity.getByTestId('tl-activity-body');
    const terms = () => totalsOf().map(([t]) => t);
    const MONEY = ['All public money spent', 'Per added home'];
    await expect
      .poll(terms)
      .toEqual(['Approved in new projects', 'Completed', 'Stopped', 'From your policy', ...MONEY]);
    // The chunk's publicSpent at month 3: 100 * 4.
    expect(totalsOf()[4][1]).toBe(formatDollars(400));
    expect(body.element().hasAttribute('data-stale')).toBe(false);
    // The money policy goes: until the refill the held numbers and the held document's rows stay,
    // dimmed; the heading and Details keep their contrast.
    s.setPolicy(DEFAULT_POLICY4);
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    expect(debug().stale).toBe(true);
    await expect.element(body).toHaveAttribute('data-stale', 'true');
    expect(terms()).toEqual([
      'Approved in new projects',
      'Completed',
      'Stopped',
      'From your policy',
      ...MONEY
    ]);
    const color = (e: Element) => getComputedStyle(e).color;
    const heading = activity.getByRole('heading', { name: 'Activity' }).element();
    const button = activity.getByRole('button', { name: 'Details' }).element();
    expect(color(body.element())).not.toBe(color(heading));
    expect(color(button)).toBe(color(heading));
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().stale).toBe(false);
    await expect.poll(terms).toEqual(['Approved in new projects', 'Completed', 'Stopped']);
    expect(body.element().hasAttribute('data-stale')).toBe(false);
  });

  it('read-only: no starters and no empty-lane words', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false, readonly: true });
    const activity = page.getByTestId('tl-activity');
    await expect.element(activity.getByText('Press Play to see what gets built.')).toBeVisible();
    expect(activity.getByText('Try one:').elements()).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid=tl-empty-lane]')).toHaveLength(0);
  });

  it("Activity's Details and Details' Activity call the page; showActivity focuses Activity", async () => {
    const ondetails = vi.fn();
    const onactivity = vi.fn();
    const s = await opened(LAST, {
      withInspector: true,
      inspectorOpen: false,
      ondetails,
      onactivity
    });
    const insp = page.getByTestId('tl-inspector');
    await insp.getByTestId('tl-activity').getByRole('button', { name: 'Details' }).click();
    expect(ondetails).toHaveBeenCalledOnce();
    await (await s.r).rerender({ inspectorOpen: true });
    await insp.getByTestId('tl-details').getByRole('button', { name: 'Activity' }).click();
    expect(onactivity).toHaveBeenCalledOnce();
    await (await s.r).rerender({ inspectorOpen: true, face: 'activity' });
    await expect.element(insp.getByTestId('tl-activity')).toBeVisible();
    await s.showActivity();
    expect(document.activeElement).toBe(insp.getByTestId('tl-activity').element());
  });

  it("Details' score is not rebuilt as the playhead crosses months; it draws no chart", async () => {
    await opened(LAST, { withInspector: true });
    const details = page.getByTestId('tl-inspector').getByTestId('tl-details');
    await expect.element(details).toBeVisible();
    expect(details.element().querySelector('svg[role="img"], figure')).toBeNull();
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    await tick();
    const scores = vi.mocked(scoreOfView).mock.calls.length;
    for (let k = 1; k <= 4; k++) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBe(MONTHS[k]);
      await expect.element(scoreBar()).toHaveTextContent(textAt(k).main);
    }
    await tick();
    expect(vi.mocked(scoreOfView).mock.calls.length - scores).toBe(0);
  });

  /** The stacked legend's entries (from md, in the label column). */
  const stackedLegend = () =>
    [...page.getByTestId('tl-chart-legend').element().querySelectorAll('li')].map((li) =>
      li.textContent!.trim()
    );

  it('choosing By source in Details redraws the timeline chart with the pipeline line', async () => {
    await opened(LAST, { withInspector: true });
    const details = page.getByTestId('tl-details');
    await expect.element(details).toBeVisible();
    const fig = page.getByTestId('tl-lanes').getByRole('figure');
    await expect.element(fig).toHaveAttribute('data-lens', 'homes');
    expect(page.getByRole('radio', { name: 'From your policy' }).elements()).toHaveLength(0);
    await details.getByRole('radio', { name: 'By source' }).click();
    await expect.element(fig).toHaveAttribute('data-lens', 'source');
    await expect.element(fig).toHaveAccessibleName('By source');
    // The pipeline line, dashed, and the stacked legend (from md) naming what is drawn.
    await expect
      .element(page.getByTestId('chart-law'))
      .toHaveAttribute('stroke-dasharray', PIPELINE_DASH);
    expect(stackedLegend()).toEqual(['All homes', "From today's pipeline", 'New projects']);
    await details.getByRole('radio', { name: 'Homes' }).click();
    await expect.element(fig).toHaveAttribute('data-lens', 'homes');
    expect(stackedLegend()[0]).toBe('Homes completed');
  });

  it('a policy in force offers From your policy; the chart and the switch agree when it goes', async () => {
    const s = await opened(LAST, { withInspector: true, initialPolicy: mk(protect(5)) });
    const details = page.getByTestId('tl-details');
    const fig = page.getByTestId('tl-lanes').getByRole('figure');
    await details.getByRole('radio', { name: 'From your policy' }).click();
    await expect.element(fig).toHaveAttribute('data-lens', 'effect');
    expect(stackedLegend()).toEqual(['From your policy']);
    // The policy goes: once the numbers on show are the new document's, the radio goes and the
    // chart and the switch both say Homes.
    s.setPolicy(DEFAULT_POLICY4);
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    // Before the refill the numbers on show are the policy's: the switch and the chart both
    // still say From your policy.
    expect(debug().stale).toBe(true);
    await expect.element(details.getByRole('radio', { name: 'From your policy' })).toBeChecked();
    await expect.element(fig).toHaveAttribute('data-lens', 'effect');
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    emit(filledMsg(2, 0, LAST + 1));
    await expect.poll(() => debug().stale).toBe(false);
    await expect.element(fig).toHaveAttribute('data-lens', 'homes');
    await expect.element(details.getByRole('radio', { name: 'Homes' })).toBeChecked();
    expect(details.getByRole('radio', { name: 'From your policy' }).elements()).toHaveLength(0);
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

  it('at today Details reads today, as the header does, not month 0', async () => {
    setup({ withInspector: true, initialPolicy: mk(protect(5)) });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, STATICS));
    // Month 0 is not empty: 11 homes (5.5 + 5.5), 1 stopped, an effect of 10.
    emit(filledMsg(1, 0, LAST + 1, { base: 10 }));
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    expect(debug().day).toBe(asOf);
    await expect.element(scoreBar()).toHaveTextContent('0 homes by today');
    await expect.element(page.getByTestId('score-delta')).toHaveTextContent('+0 from your policy');
    const details = page.getByTestId('tl-details');
    const row = (label: string) =>
      details
        .getByText(label, { exact: true })
        .element()
        .parentElement!.textContent!.replace(/\s+/g, ' ')
        .trim();
    expect(row("From today's pipeline")).toBe("From today's pipeline 0");
    expect(row('New projects')).toBe('New projects 0');
    expect(row('Homes completed because of your policy')).toBe(
      'Homes completed because of your policy 0'
    );
    expect(row('Homes approved because of your policy')).toBe(
      'Homes approved because of your policy 0'
    );
    await expect
      .element(details.getByText(/^Your policy added/))
      .toHaveTextContent('Your policy added 0 homes vs current law');
    await expect
      .element(details.getByText(/^Proposed homes in projects that stopped/))
      .toHaveTextContent(/: 0$/);
  });

  it('showDetails scrolls the detail column to the top and focuses Details', async () => {
    const s = await opened(LAST, { withInspector: true });
    const insp = page.getByTestId('tl-inspector');
    await expect.element(insp.getByTestId('tl-details')).toBeVisible();
    const el = insp.element() as HTMLElement;
    await expect.poll(() => el.scrollHeight - el.clientHeight).toBeGreaterThan(200);
    el.scrollTop = 200;
    expect(el.scrollTop).toBe(200);
    await s.showDetails();
    expect(el.scrollTop).toBe(0);
    const res = page.getByTestId('tl-details').element();
    expect(document.activeElement).toBe(res);
    // The ring draws inside Details, so the column's scroll box never clips it (WCAG 2.4.7).
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
    await expect.element(insp.getByTestId('tl-activity')).toBeVisible();
    expect(document.querySelector('[data-testid=host-inspector]')).toBeNull();
    await expect.poll(() => el.scrollTop).toBe(0);
  });
});

describe('the goal notice', () => {
  // The measure at month i is 1000 + 3i + 1 (more with a base), 1000 at today.
  const DEADLINE = 12;
  const missing: Goal = { ...GOAL_BASE, amount: 1100, deadline: MONTHS[DEADLINE] };
  const metAt8: Goal = { ...GOAL_BASE, amount: 1025, deadline: MONTHS[DEADLINE] };
  const region = () => page.getByTestId('tl-goal');
  const notice = () => page.getByTestId('tl-goal-notice');

  /** The playhead by key: Home, then `k` calendar months on, then `back` months back. */
  async function keysTo(k: number, back = 0) {
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}' + '{ArrowRight}'.repeat(k) + '{ArrowLeft}'.repeat(back));
    await expect.poll(() => debug().day).toBe(MONTHS[k - back]);
  }

  /** An edit as the page's store sends it, answered with the new numbers from `changed`. */
  async function editAndAnswer(s: Awaited<ReturnType<typeof opened>>, changed: number) {
    s.setPolicy(mk(protect(7)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, changed));
    emit(filledMsg(2, changed, LAST + 1 - changed, { base: 5 }));
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    await expect.poll(() => debug().stale).toBe(false);
  }

  it('the missed notice appears when the playhead passes the deadline, and not before', async () => {
    await opened(LAST, { goal: missing });
    await keysTo(DEADLINE);
    await tick();
    await expect.element(notice()).not.toBeInTheDocument();
    await keysTo(DEADLINE + 1);
    await expect
      .element(notice())
      .toHaveTextContent('Goal missed by 63 homes. Add a policy and play again.');
  });

  it('it stays as the playhead goes back, and does not come back once dismissed', async () => {
    await opened(LAST, { goal: missing });
    await keysTo(DEADLINE + 2, DEADLINE + 1);
    await expect.element(notice()).toBeInTheDocument();
    await keysTo(DEADLINE + 3, DEADLINE + 2);
    await expect.element(notice()).toBeInTheDocument();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect.element(notice()).not.toBeInTheDocument();
    await keysTo(DEADLINE + 4);
    await keysTo(1);
    await keysTo(DEADLINE + 5);
    await tick();
    await expect.element(notice()).not.toBeInTheDocument();
  });

  it('the reached notice names the month the goal is met', async () => {
    await opened(LAST, { goal: metAt8 });
    await keysTo(7);
    await tick();
    await expect.element(notice()).not.toBeInTheDocument();
    await keysTo(8);
    await expect
      .element(notice())
      .toHaveTextContent(
        `Goal reached in ${formatShortMonthYear(MONTHS[8])}, by the ${formatShortMonthYear(MONTHS[DEADLINE])} deadline.`
      );
  });

  it('an edit that pulls the furthest date before the deadline takes it away', async () => {
    const s = await opened(LAST, { goal: missing, initialPolicy: mk(protect(5)) });
    await keysTo(DEADLINE + 2, DEADLINE - 3);
    await expect.element(notice()).toBeInTheDocument();
    await editAndAnswer(s, DEADLINE - 6);
    // The first changed month; the playhead is behind it.
    await expect.poll(() => debug().reached).toBe(MONTHS[DEADLINE - 6]);
    await expect.element(notice()).not.toBeInTheDocument();
  });

  it('an edit that changes the shortfall replaces it', async () => {
    const s = await opened(LAST, { goal: missing, initialPolicy: mk(protect(5)) });
    await keysTo(DEADLINE + 2);
    await expect.element(notice()).toHaveTextContent('Goal missed by 63 homes.');
    await editAndAnswer(s, 0);
    await expect.element(notice()).toHaveTextContent('Goal missed by 58 homes.');
    expect(region().element().textContent).toContain('Change the policy and play again.');
  });

  /** Every write under the notice's region: `take` returns those since the last take. */
  function writesTo(el: Element) {
    let got: MutationRecord[] = [];
    const obs = new MutationObserver((r) => got.push(...r));
    obs.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
    const take = () => {
      const all = [...got, ...obs.takeRecords()];
      got = [];
      return all;
    };
    return { take, stop: () => obs.disconnect() };
  }

  const ADD = 'Goal missed by 63 homes. Add a policy and play again.';

  it('from nothing in force at today, a first policy never rewords the old shortfall', async () => {
    const s = await opened(LAST, { goal: missing });
    await keysTo(DEADLINE + 2);
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    await expect.element(notice()).toHaveTextContent(ADD);
    const el = region().element();
    const writes = writesTo(el);
    s.setPolicy(mk(protect(7)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    await expect.poll(() => debug().stale).toBe(true);
    await tick();
    expect(writes.take()).toEqual([]);
    expect(el.textContent).toContain(ADD);
    // The playhead's month fills before the search ends: the numbers are current first.
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, DEADLINE + 1));
    // The drawn current law changes from month 1: the furthest date goes back before the deadline.
    await expect.poll(() => debug().reached).toBe(MONTHS[1]);
    await expect.element(notice()).not.toBeInTheDocument();
    // The notice went whole: nothing inside it was rewritten on the way.
    const all = writes.take();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => r.target === el && r.type === 'childList')).toBe(true);
    writes.stop();
  });

  it('past the deadline, a first policy that keeps the outcome rewords it once its numbers show', async () => {
    const s = await opened(LAST, { goal: missing });
    await keysTo(DEADLINE + 2);
    await expect.element(notice()).toHaveTextContent(ADD);
    const el = region().element();
    const writes = writesTo(el);
    s.setPolicy(mk(protect(7)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    // The first change after the deadline: the deadline month's numbers are the same.
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, DEADLINE + 1));
    await expect.poll(() => debug().filledThrough).toBe(DEADLINE);
    expect(debug().stale).toBe(true);
    await tick();
    expect(writes.take()).toEqual([]);
    expect(el.textContent).toContain(ADD);
    emit(filledMsg(2, DEADLINE + 1, LAST - DEADLINE, { base: 5 }));
    await expect.poll(() => debug().stale).toBe(false);
    await expect
      .element(notice())
      .toHaveTextContent('Goal missed by 63 homes. Change the policy and play again.');
    writes.stop();
  });

  it('from nothing in force, a first policy that changes the shortfall replaces it whole', async () => {
    const s = await opened(LAST, { goal: missing });
    await keysTo(DEADLINE + 2);
    await expect
      .element(notice())
      .toHaveTextContent('Goal missed by 63 homes. Add a policy and play again.');
    const el = region().element();
    const texts: string[] = [];
    const obs = new MutationObserver(() => texts.push(el.textContent ?? ''));
    obs.observe(el, { subtree: true, childList: true, characterData: true });
    s.setPolicy(mk(protect(7)));
    s.setLots({});
    await expect.poll(() => w().lastOf('setPolicy')?.rev).toBe(2);
    emit(compiledMsg(2, STATICS));
    emit(refillMsg(2, 0));
    await expect.poll(() => debug().stale).toBe(true);
    await tick();
    expect(texts).toEqual([]);
    emit(filledMsg(2, 0, LAST + 1, { base: 5 }));
    await expect.poll(() => debug().stale).toBe(false);
    await expect
      .element(notice())
      .toHaveTextContent('Goal missed by 58 homes. Change the policy and play again.');
    obs.disconnect();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.includes('63 homes') && t.includes('Change the policy')).toBe(false);
      expect(t.includes('58 homes') && t.includes('Add a policy')).toBe(false);
    }
  });

  it('after Dismiss focus goes to the ruler', async () => {
    await opened(LAST, { goal: missing });
    await keysTo(DEADLINE + 1);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect.element(notice()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(page.getByTestId('tl-ruler').element());
  });

  it('after Dismiss focus goes to the next notice when there is one', async () => {
    const s = await opened(LAST, { goal: missing });
    await keysTo(DEADLINE + 1);
    s.setPolicy(mk(protect(5)));
    s.setLots(null);
    s.setLotsFailed(true);
    const retry = page.getByTestId('tl-lots-failed').getByRole('button', { name: 'Retry' });
    await expect.element(retry).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect.element(notice()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(retry.element());
  });

  it('a view that does not yet cover the months read holds the notice', async () => {
    await opened(LAST, { goal: missing });
    // Reached month 14, the playhead back at month 2.
    await keysTo(DEADLINE + 2, DEADLINE);
    await expect.element(notice()).toHaveTextContent('Goal missed by 63 homes.');
    // A refill withdraws the months from 6: the playhead's month is still filled, so the numbers
    // are current, but the deadline month is not.
    emit(refillMsg(1, 6));
    await expect.poll(() => debug().filledThrough).toBe(5);
    expect(debug().stale).toBe(false);
    await tick();
    await expect.element(notice()).toHaveTextContent('Goal missed by 63 homes.');
    emit(filledMsg(1, 6, LAST + 1 - 6));
    await expect.poll(() => debug().filledThrough).toBe(LAST);
    await expect.element(notice()).toHaveTextContent('Goal missed by 63 homes.');
  });

  it('the notice region is a polite status, mounted empty', async () => {
    await opened(LAST, { goal: missing });
    await expect.element(region()).toBeInTheDocument();
    const el = region().element();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.textContent).toBe('');
    // The same element then holds the notice: the first appearance is announced.
    await keysTo(DEADLINE + 1);
    await expect.element(notice()).toBeInTheDocument();
    expect(region().element()).toBe(el);
    expect(el.contains(notice().element())).toBe(true);
    const r = await axe.run(el.parentElement!);
    expect(r.violations).toEqual([]);
  });

  it('dragging the playhead by days inside a month does not recompute or rewrite it', async () => {
    await opened(LAST, { goal: missing });
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
    const from = MONTHS[DEADLINE + 2] + 1;
    pointer('pointerdown', from);
    await expect.poll(() => debug().day).toBe(from);
    await expect.element(notice()).toBeInTheDocument();
    const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
    const obs = new MutationObserver(() => {});
    obs.observe(region().element(), { childList: true, characterData: true, subtree: true });
    const calls = vi.mocked(goalOutcome).mock.calls.length;
    for (let d = from + 3; d < MONTHS[DEADLINE + 2] + 20; d += 3) {
      pointer('pointermove', d);
      await expect.poll(() => debug().day).toBe(d);
      await frame();
    }
    pointer('pointerup', MONTHS[DEADLINE + 2] + 20);
    expect(obs.takeRecords()).toEqual([]);
    obs.disconnect();
    expect(vi.mocked(goalOutcome).mock.calls.length).toBe(calls);
  });
});

describe('the map key', () => {
  const keyPanel = () => page.getByRole('group', { name: 'Map key' });
  const keyToggle = () => page.getByRole('button', { name: 'Map key' });
  const control = () => page.getByTestId('map-key-control');
  /** The key's rows as [label, count]. */
  const counts = () =>
    [...keyPanel().element().querySelectorAll('[data-key-row]')].map((r) => [
      r.querySelector('dt')!.textContent,
      r.querySelector('dd')!.textContent
    ]);
  const FULL = () => viewOf([chunk(0, LAST + 1)], STATICS);

  it('the map key is open at 1280 px and reads the tally of the playhead month', async () => {
    await page.viewport(1280, 800);
    await opened();
    await expect.element(keyPanel()).toBeVisible();
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'true');
    // The control follows the map in the DOM: after its own controls, before the card.
    const map = page.getByTestId('tl-map').element();
    expect(map.compareDocumentPosition(control().element())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Today: in progress from month 0, nothing completed or stopped yet.
    await expect.poll(counts).toEqual([
      ['Planning review', '2'],
      ['Approved', '3'],
      ['Permit issued', '1'],
      ['Building', '3'],
      ['Completed', '0'],
      ['Stopped', '0']
    ]);
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}');
    for (let k = 1; k <= 2; k++) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBe(MONTHS[k]);
    }
    const row = FULL().rows[2];
    await expect.poll(counts).toContainEqual(['Completed', String(row.completedNet)]);
    expect(counts()).toContainEqual(['Stopped', String(row.exitedUnits)]);
  });

  it('while Updating after a first policy, the key shows Under your policy', async () => {
    await page.viewport(1280, 800);
    const s = await opened();
    await expect.element(keyPanel()).toBeVisible();
    const mark = () => keyPanel().element().querySelector('[data-key-extra="mark"]');
    expect(mark()).toBeNull();
    s.setPolicy(mk(protect(5)));
    await expect.poll(() => debug().stale).toBe(true);
    await expect.element(statusShown()).toHaveTextContent(UPDATING);
    // The numbers are still the nothing-in-force document's; the map can show the edit's marks.
    await expect.poll(mark).not.toBeNull();
    expect(mark()!.textContent).toContain('Under your policy');
  });

  it('shows … while calculating', async () => {
    setup();
    await expect.poll(() => workers.length).toBe(1);
    await expect.element(keyPanel()).toBeVisible();
    expect(counts().map(([, c]) => c)).toEqual(['…', '…', '…', '…', '…', '…']);
  });

  // No wall clock: the playhead is dragged in steps of a few days, so most steps stay inside a
  // calendar month whatever the frame rate.
  it('the tally changes only when the playhead crosses a month', async () => {
    await opened();
    await expect.element(keyPanel()).toBeVisible();
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
    const from = MONTHS[2] + 1;
    pointer('pointerdown', from);
    await expect.poll(() => debug().day).toBe(from);
    await expect.poll(counts).toContainEqual(['Completed', String(FULL().rows[2].completedNet)]);
    const dl = keyPanel().element().querySelector('dl')!;
    let records = 0;
    const obs = new MutationObserver((m) => (records += m.length));
    obs.observe(dl, { childList: true, characterData: true, subtree: true });
    const written = () => records + obs.takeRecords().length;
    let wrote = written();
    let calls = vi.mocked(keyTally).mock.calls.length;
    let changes = 0;
    for (let d = from + 3; d < MONTHS[5] + 10; d += 3) {
      const month = monthStart(debug().day);
      pointer('pointermove', d);
      await expect.poll(() => debug().day).toBe(d);
      await frame();
      const now = written();
      const read = vi.mocked(keyTally).mock.calls.length;
      const crossed = monthStart(d) !== month;
      if (crossed) changes++;
      // The tally is read, and its text written, exactly on the steps that cross a month.
      expect({ d, crossed, wrote: now > wrote, read: read > calls }).toEqual({
        d,
        crossed,
        wrote: crossed,
        read: crossed
      });
      if (crossed) expect(read - calls).toBe(1);
      wrote = now;
      calls = read;
    }
    pointer('pointerup', MONTHS[5] + 10);
    obs.disconnect();
    expect(changes).toBe(3);
  });

  it('below md the key control hides while a card is open and returns on Close', async () => {
    await page.viewport(390, 760);
    await opened();
    await expect.element(keyToggle()).toBeVisible();
    // Closed at rest on a phone.
    await expect.element(keyToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x: 40, y: 40, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    w().emit({ type: 'parcelSummary', reqId: req.reqId, summary: summary(REAL_ACTUAL) });
    const card = page.getByTestId('tl-card');
    await expect.element(card.getByRole('heading', { level: 2 })).toBeInTheDocument();
    await expect.element(control()).not.toBeVisible();
    expect(control().element().hasAttribute('inert')).toBe(true);
    await card.getByRole('button', { name: 'Close' }).click();
    await expect.element(keyToggle()).toBeVisible();
    expect(control().element().hasAttribute('inert')).toBe(false);
  });

  it('from md an open card ends left of the key control', async () => {
    await page.viewport(1280, 800);
    await opened();
    await expect.element(keyPanel()).toBeVisible();
    await expect.poll(() => stub.props.timelinePick).toBeTruthy();
    const map = page.getByTestId('tl-map').element().getBoundingClientRect();
    // A tap right beside the key: the card flips to the anchor's left, clear of it.
    const x = map.width - 300;
    stub.props.timelinePick!({ projectId: 'pr-1', parcelId: 'p1', x, y: 200, kind: 'tap' });
    await expect.poll(() => w().all('parcelSummary')).toHaveLength(1);
    const req = w().lastOf('parcelSummary')!;
    w().emit({ type: 'parcelSummary', reqId: req.reqId, summary: summary(REAL_ACTUAL) });
    const card = page.getByTestId('tl-card');
    await expect.element(card.getByRole('heading', { level: 2 })).toBeInTheDocument();
    const section = card.element().querySelector('section')!;
    const keyLeft = control().element().getBoundingClientRect().left;
    await expect.poll(() => section.getBoundingClientRect().right).toBeLessThanOrEqual(keyLeft);
    expect(section.getBoundingClientRect().width).toBeGreaterThan(0);
    await expect.element(control()).toBeVisible();
  });

  it('stale: the key dims with Details', async () => {
    const s = await opened();
    await expect.element(keyPanel()).toBeVisible();
    expect(keyPanel().element().hasAttribute('data-stale')).toBe(false);
    s.setPolicy(mk(protect(5)));
    await expect.element(page.getByTestId('tl-map')).toHaveAttribute('data-stale', 'true');
    await expect.element(keyPanel()).toHaveAttribute('data-stale', 'true');
    const label = keyPanel().element().querySelector('dt')!;
    await expect.poll(() => getComputedStyle(label).color).toBe('rgb(75, 85, 99)');
    // The toggle, a control, keeps its colour.
    expect(getComputedStyle(keyToggle().element()).color).not.toBe('rgb(75, 85, 99)');
  });
});

describe('halos on the map', () => {
  it('turns halos on from the dataset date once the map is ready', async () => {
    stub.autoReady = false;
    await opened();
    // Nothing before the map is ready.
    expect(callsOf('setHalos')).toEqual([]);
    stub.fireReady();
    await expect.poll(() => callsOf('setHalos')).toEqual([[{ from: asOf }]]);
    // Not per playhead move: the arrows, Home and End leave it at the one call.
    (slider().element() as HTMLElement).focus();
    for (let k = 1; k <= 3; k++) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBe(MONTHS[k]);
    }
    await userEvent.keyboard('{End}');
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    expect(callsOf('setTime').length).toBeGreaterThan(4);
    expect(callsOf('setHalos')).toEqual([[{ from: asOf }]]);
  });

  it('turns them on again from the new date after a Retry brings a new calibration', async () => {
    const fresh = { ...cal, asOf: asOf + 31 };
    setup({ calibrationError: true, reload: async () => ({ manifest, calibration: fresh }) });
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect.element(retry).toBeVisible();
    await expect.poll(() => callsOf('setHalos')).toEqual([[{ from: asOf }]]);
    await retry.click();
    await expect
      .poll(() => callsOf('setHalos'))
      .toEqual([[{ from: asOf }], [{ from: fresh.asOf }]]);
    // Far bars are the page's, not the calibration's: the Retry leaves them at the one call.
    expect(callsOf('setBarMode')).toEqual([['far']]);
  });

  it("a new calibration re-derives the goal's date", async () => {
    const nextAsOf = asOf + 62;
    const fresh = { ...cal, asOf: nextAsOf };
    await page.viewport(1280, 900);
    setup({
      calibrationError: true,
      withInspector: true,
      inspectorOpen: false,
      reload: async () => ({ manifest, calibration: fresh })
    });
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect.element(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    emit(compiledMsg(1, { ...STATICS, asOf: nextAsOf }));
    emit(filledMsg(1, 0, LAST + 1));
    await expect.element(page.getByText(goalName(defaultGoal(nextAsOf))).first()).toBeVisible();
    expect(goalName(defaultGoal(nextAsOf))).not.toBe(goalName(defaultGoal(asOf)));
  });

  it('turns far bars on once the map is ready', async () => {
    stub.autoReady = false;
    await opened();
    expect(callsOf('setBarMode')).toEqual([]);
    stub.fireReady();
    await expect.poll(() => callsOf('setBarMode')).toEqual([['far']]);
    // Not per playhead move.
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => debug().day).toBe(MONTHS[1]);
    await userEvent.keyboard('{End}');
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    expect(callsOf('setBarMode')).toEqual([['far']]);
  });
});

describe("Activity's latest stage changes", () => {
  const MISSION: [number, number] = [-122.4194, 37.76];
  const ELSEWHERE: [number, number] = [-122.5, 37.7];
  /** A citywide delta of markers (ascending rows). */
  function city(
    rows: number,
    ms: { row: number; days: [number, number, number]; at?: [number, number]; flags?: number }[],
    from?: number
  ): CityDelta {
    const k = ms.length;
    const d: CityDelta = {
      rows,
      row: Int32Array.from(ms.map((m) => m.row)),
      lngLat: new Float32Array(2 * k),
      days: new Float32Array(3 * k),
      homes: Uint16Array.from(ms.map(() => 12)),
      existing: new Uint16Array(k),
      flags: Uint8Array.from(ms.map((m) => m.flags ?? 0))
    };
    ms.forEach((m, i) => {
      d.lngLat.set(m.at ?? ELSEWHERE, 2 * i);
      d.days.set(m.days, 3 * i);
    });
    if (from !== undefined) d.from = from;
    return d;
  }
  const update = (revision: number, c?: CityDelta): TimelineUpdate => ({
    revision,
    cells: [],
    removedCells: [],
    demolish: [],
    ...(c ? { city: c } : {})
  });
  const N = NaN;
  const items = () => [...document.querySelectorAll('[data-testid=tl-activity] ol li')];
  const lines = () => items().map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
  const month = (d: Day) => formatShortMonthYear(d);
  async function keysTo(k: number) {
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    for (let i = 1; i <= k; i++) {
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => debug().day).toBe(MONTHS[i]);
    }
  }

  it('events arriving before the map is ready still reach Activity', async () => {
    stub.autoReady = false;
    const fetchPlaces = vi.fn(async () => FIXTURE_PLACES);
    await opened(LAST, { withInspector: true, inspectorOpen: false, fetchPlaces });
    const u = update(
      0,
      city(2, [
        { row: 0, days: [MONTHS[1] + 2, N, N], at: MISSION, flags: SLOT_FLAG.zoning },
        { row: 1, days: [MONTHS[2] + 2, MONTHS[2] + 5, N] }
      ])
    );
    emit(cellsMsg(u));
    await expect.element(page.getByTestId('tl-activity')).toBeVisible();
    // Not fetched before the list has an item.
    expect(fetchPlaces).not.toHaveBeenCalled();
    await keysTo(3);
    await expect
      .poll(lines)
      .toEqual([
        `Building 12 homes ${month(MONTHS[2] + 5)}`,
        `Approved 12 homes ${month(MONTHS[2] + 2)}`,
        `◆Under your policy Approved 12 homes Mission · ${month(MONTHS[1] + 2)}`
      ]);
    expect(fetchPlaces).toHaveBeenCalledExactlyOnceWith('/data/fixture-0/neighborhoods.geojson');
    // The map gets the same update once it is ready.
    expect(callsOf('applyTimeline')).toEqual([]);
    stub.fireReady();
    await expect.poll(() => callsOf('applyTimeline')).toEqual([[u]]);
    // Fetched once per manifest, however the list moves.
    await userEvent.keyboard('{ArrowLeft}');
    await expect.poll(() => debug().day).toBe(MONTHS[2]);
    await expect.poll(() => items().length).toBe(1);
    expect(fetchPlaces).toHaveBeenCalledOnce();
  });

  it('scrubbing back drops later events; the list DOM is not rewritten when its keys are the same', async () => {
    await opened(LAST, { withInspector: true, inspectorOpen: false });
    emit(
      cellsMsg(
        update(
          0,
          city(3, [
            { row: 0, days: [MONTHS[1] + 2, N, N] },
            { row: 1, days: [MONTHS[2] + 2, N, N] },
            { row: 2, days: [MONTHS[3] + 2, N, N] }
          ])
        )
      )
    );
    await keysTo(3);
    await expect.poll(() => items().length).toBe(2);
    await expect
      .element(page.getByTestId('tl-activity').getByRole('heading', { level: 3, name: 'Latest' }))
      .toBeVisible();
    const [newer, older] = items();
    expect(newer.textContent).toContain(month(MONTHS[2]));
    const sorts = indexes.at(-1)!.sorts;
    // Forward across the next event, then back: the old items are the same nodes.
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => debug().day).toBe(MONTHS[4]);
    await expect.poll(() => items().length).toBe(3);
    expect(items().slice(1)).toEqual([newer, older]);
    expect(items()[1]).toBe(newer);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    await expect.poll(() => debug().day).toBe(MONTHS[2]);
    await expect.poll(() => items().length).toBe(1);
    expect(items()[0]).toBe(older);
    // Moving the playhead never sorts.
    expect(indexes.at(-1)!.sorts).toBe(sorts);
    // A rewind from row 0 forgets it: the list empties at once.
    emit(cellsMsg(update(1, city(1, [], 0))));
    await expect.element(page.getByText('No stage changes yet.')).toBeVisible();
    expect(items()).toEqual([]);
    // Home: today names no stage change and shows no list.
    await userEvent.keyboard('{Home}');
    await expect.poll(() => debug().day).toBe(asOf);
    await expect
      .element(page.getByTestId('tl-activity').getByRole('heading', { level: 3 }))
      .not.toBeInTheDocument();
  });

  it('a failed neighbourhood file leaves the items without a place', async () => {
    const fetchPlaces = vi.fn(async () => null);
    await opened(LAST, { withInspector: true, inspectorOpen: false, fetchPlaces });
    emit(cellsMsg(update(0, city(1, [{ row: 0, days: [MONTHS[1] + 2, N, N], at: MISSION }]))));
    await keysTo(2);
    await expect.poll(lines).toEqual([`Approved 12 homes ${month(MONTHS[1] + 2)}`]);
    expect(fetchPlaces).toHaveBeenCalledOnce();
  });
});
