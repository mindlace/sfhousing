// TimelineSession over the real TimelineClient and a fake worker: arrival order, stale, notices,
// the provisional open, crash and the view-month gate (timeline-ui rules 16, 21, 29-36; S14).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { monthFirstDay } from '$lib/sim/world/months';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import { parseCalibration } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';
import { DEFAULT_POLICY4, queriesOf4, type Policy, type SimPolicy4 } from './policy4';
import { reconcilePolicy4 } from './reconcile4';
import { TimelineSession, type SessionDeps } from './session.svelte';
import {
  FakeTimelineWorker,
  compiledMsg,
  compilingMsg,
  errorMsg,
  filledMsg,
  refillMsg
} from './test/fake-timeline-worker';
import { statics as baseStatics } from './test/fixtures';

const cal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const asOf = cal.asOf;
const LAST = 23;
const MANIFEST = { datasetVersion: 'fixture-0' } as unknown as Manifest;

/** Calendar months from the dataset date's month, as the worker's statics carry them. */
const { y, m } = utcParts(asOf);
const MONTHS: Day[] = Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const STATICS: ScoreStatics = { ...baseStatics({ lastIndex: LAST }), asOf, months: MONTHS };
const dayOf = (i: number): Day => MONTHS[i] + 3;

const protect = (id: string, years: number): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [{ from: monthFirstDay(asOf, 2), to: null, what: { tag: 'protect', years } }]
});
const painted: Policy = {
  id: 'paint',
  label: 'paint',
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
const doc1 = DEFAULT_POLICY4;
const doc2 = mk(protect('a', 5));
const doc3 = mk(protect('a', 7));
const doc4 = mk(protect('a', 9));
const withPaint = mk(protect('a', 5), painted);
const lots = Object.fromEntries(queriesOf4(withPaint).map((q) => [q.key, ['p1', 'p2']]));

let workers: FakeTimelineWorker[];
let worker: FakeTimelineWorker;
let session: TimelineSession;
let undoTo: ReturnType<typeof vi.fn<(p: SimPolicy4) => void>>;
let clock: number;
let timers: { at: number; fn: () => void; id: number }[];
let deps: SessionDeps;

const emit = (r: TimelineHostResponse) => worker.emit(r);
const compiled = (rev: number) => compiledMsg(rev, STATICS, 3);
const filled = filledMsg;
const refill = refillMsg;
const error = errorMsg;

function advance(ms: number): void {
  clock += ms;
  for (const t of [...timers].sort((a, b) => a.at - b.at)) {
    if (t.at <= clock) {
      timers = timers.filter((x) => x !== t);
      t.fn();
    }
  }
}

beforeEach(() => {
  workers = [];
  undoTo = vi.fn<(p: SimPolicy4) => void>();
  clock = 1000;
  timers = [];
  let id = 0;
  deps = {
    manifest: MANIFEST,
    calibration: cal,
    undoTo,
    createWorker: () => {
      worker = new FakeTimelineWorker();
      workers.push(worker);
      return worker;
    },
    now: () => clock,
    setTimeout: ((fn: () => void, ms: number) => {
      const t = { at: clock + ms, fn, id: ++id };
      timers.push(t);
      return t.id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((h: number) => {
      timers = timers.filter((t) => t.id !== h);
    }) as unknown as typeof clearTimeout,
    oncells: vi.fn(),
    onlookups: vi.fn(),
    onheights: vi.fn(),
    onchunks: vi.fn()
  };
  session = new TimelineSession(deps);
});

afterEach(() => {
  session.dispose();
  vi.restoreAllMocks();
});

/** Opened with doc1, compiled and filled to month 19 at rev 1. */
function opened(): void {
  session.open(doc1, {});
  emit(compiled(1));
  emit(filled(1, 0, 20));
}

describe('TimelineSession', () => {
  it('a refill drops months from that index', () => {
    opened();
    emit(refill(2, 12));
    expect(session.view!.filledThrough).toBe(11);
  });

  it('stale begins on edit and ends when the refill passes the playhead', () => {
    opened();
    session.playhead(dayOf(15));
    session.edited();
    expect(session.shown(15).stale).toBe(true);
    session.send(doc2, {});
    emit(refill(2, 10));
    emit(filled(2, 10, 3));
    expect(session.shown(15).stale).toBe(true);
    emit(filled(2, 13, 5));
    expect(session.shown(15).stale).toBe(false);
  });

  it('dropUnsent ends an unsent edit: not stale, Play back, nothing posted', () => {
    opened();
    emit(filled(1, 20, LAST - 19));
    session.playhead(dayOf(15));
    session.edited();
    expect(session.shown(15).stale).toBe(true);
    expect(session.playAvailable()).toBe(false);
    const posts = worker.posts.length;
    session.dropUnsent();
    expect(session.shown(15).stale).toBe(false);
    expect(session.shown(15).view).toBe(session.view);
    expect(session.playAvailable()).toBe(true);
    expect(worker.posts).toHaveLength(posts);
    // A sent edit still pending is not dropped.
    session.edited();
    session.send(doc2, {});
    session.dropUnsent();
    expect(session.shown(15).stale).toBe(true);
  });

  it('an open card re-requests once a filled covers its day after an edit', () => {
    const refresh = vi.fn();
    session.oncardrefresh = refresh;
    opened();
    session.watchCard(dayOf(15));
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 10));
    emit(filled(2, 10, 3));
    expect(refresh).not.toHaveBeenCalled();
    emit(filled(2, 13, 5));
    emit(filled(2, 18, 2));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a card before the refill point is not asked again', () => {
    const refresh = vi.fn();
    session.oncardrefresh = refresh;
    opened();
    session.watchCard(dayOf(5));
    session.edited();
    session.send(doc2, {});
    emit(refill(2, 10));
    emit(filled(2, 10, 6));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('bad-request undoes to the last accepted document and shows the notice', () => {
    opened();
    session.edited();
    session.send(doc2, {});
    emit(error(2, 'bad-request'));
    expect(undoTo).toHaveBeenCalledWith(doc1);
    expect(session.notices).toContainEqual({ id: 'not-applied' });
    expect(session.accepted).toEqual(doc1);
    // the store's undo comes back as the same pair: nothing is sent, nothing stays stale
    session.edited();
    session.send(doc1, {});
    expect(worker.all('setPolicy')).toHaveLength(1);
    expect(session.shown(5).stale).toBe(false);
  });

  it('a chain of rejections undoes newest first and a refill at the oldest settles', () => {
    opened();
    session.playhead(dayOf(5));
    session.edited();
    session.send(doc2, {});
    session.send(doc3, {});
    session.send(doc4, {});
    emit(error(4, 'bad-request'));
    expect(undoTo).toHaveBeenLastCalledWith(doc3);
    emit(error(3, 'bad-request'));
    expect(undoTo).toHaveBeenLastCalledWith(doc2);
    expect(session.shown(5).stale).toBe(true);
    emit(compiled(2));
    emit(refill(2, 20));
    expect(session.shown(5).stale).toBe(false);
    expect(session.accepted).toEqual(doc2);
    expect(session.notices.filter((n) => n.id === 'not-applied')).toHaveLength(1);
  });

  it('an edit taken up again after a later rejection is stale until its new refill fills', () => {
    opened();
    session.playhead(dayOf(15));
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 20));
    expect(session.shown(15).stale).toBe(false);
    session.edited();
    session.send(doc3, {});
    emit(error(3, 'bad-request'));
    expect(undoTo).toHaveBeenLastCalledWith(doc2);
    emit(compiled(2));
    emit(refill(2, 5));
    expect(session.shown(15).stale).toBe(true);
    emit(filled(2, 5, 11));
    expect(session.shown(15).stale).toBe(false);
  });

  it('an error shows Retry and Retry sends openTimeline with the current document', () => {
    opened();
    session.send(doc2, {});
    emit(error(2, 'timeline'));
    const notice = session.notices.find((n) => n.id === 'error')!;
    expect(notice).toEqual({ id: 'error', text: 'Part of the simulation stopped.', retry: 'open' });
    expect(session.stoppedByError).toBe(true);
    expect(session.playAvailable()).toBe(true);
    session.retry(notice);
    expect(worker.all('openTimeline')).toHaveLength(2);
    expect(worker.lastOf('openTimeline')!.policy).toEqual(doc2);
    expect(session.notices).toEqual([]);
    expect(session.stoppedByError).toBe(false);
  });

  it("an error before the first filled says the simulation couldn't load", () => {
    session.open(doc1, {});
    emit(error(1, 'internal'));
    expect(session.notices).toEqual([
      { id: 'error', text: "The simulation couldn't load.", retry: 'open' }
    ]);
    expect(session.phase).toBe('failed');
  });

  it("a late rejection of the open's own document stops the fill (rule 35)", () => {
    opened();
    emit(error(1, 'bad-request'));
    expect(undoTo).not.toHaveBeenCalled();
    expect(session.notices).toEqual([
      { id: 'error', text: 'Part of the simulation stopped.', retry: 'open' }
    ]);
    expect(session.stoppedByError).toBe(true);
  });

  it('a rejected edit sent before the dataset loaded stops the fill (rule 35)', () => {
    session.open(doc1, {});
    session.edited();
    session.send(doc2, {});
    emit(error(2, 'bad-request'));
    expect(undoTo).not.toHaveBeenCalled();
    expect(session.notices.map((n) => n.id)).toEqual(['error']);
    expect(session.stoppedByError).toBe(true);
  });

  it('a rejected early edit whose earlier document goes on filling is rule 34 after all', () => {
    session.open(doc1, {});
    session.edited();
    session.send(doc2, {});
    emit(error(2, 'bad-request'));
    expect(session.notices.map((n) => n.id)).toEqual(['error']);
    expect(session.stoppedByError).toBe(true);
    expect(undoTo).not.toHaveBeenCalled();
    emit(compiled(1));
    expect(undoTo).toHaveBeenCalledTimes(1);
    expect(undoTo).toHaveBeenCalledWith(doc1);
    expect(session.notices).toEqual([{ id: 'not-applied' }]);
    expect(session.stoppedByError).toBe(false);
    expect(session.accepted).toEqual(doc1);
  });

  it('a later accepted edit resumes after an error and clears it', () => {
    opened();
    emit(error(1, 'timeline'));
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 0));
    expect(session.stoppedByError).toBe(false);
    expect(session.notices).toEqual([]);
  });

  it('a crash restarts the worker and re-opens', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    opened();
    session.playhead(dayOf(10));
    session.edited();
    session.send(doc2, {});
    emit(error(2, 'bad-request'));
    session.send(doc1, {});
    const first = worker;
    first.crash();
    expect(session.notices).toContainEqual({ id: 'crash', retry: 'restart' });
    session.retry({ id: 'crash', retry: 'restart' });
    expect(workers).toHaveLength(2);
    expect(first.terminated).toBe(true);
    // the client re-opens with the last document it posted; the session then sends the current one
    expect(worker.lastOf('openTimeline')!.policy).toEqual(doc2);
    expect(worker.lastOf('setPolicy')!.policy).toEqual(doc1);
    expect(session.notices.map((n) => n.id)).toEqual(['not-applied']);
    expect(session.shown(10).stale).toBe(true);
    emit(compiled(4));
    emit(refill(4, 0));
    emit(filled(4, 0, 12));
    expect(session.shown(10)).toEqual({ view: session.view, stale: false });
  });

  it('viewMonth is sent when the playhead changes month, at most four a second', () => {
    const inModel = (m: number) => monthFirstDay(asOf, m) + 1;
    opened();
    session.playhead(inModel(3));
    session.playhead(inModel(3) + 2);
    expect(worker.all('viewMonth').map((r) => r.month)).toEqual([3]);
    session.playhead(inModel(4));
    session.playhead(inModel(5));
    expect(worker.all('viewMonth')).toHaveLength(1);
    advance(250);
    expect(worker.all('viewMonth').map((r) => r.month)).toEqual([3, 5]);
  });

  it('resync calls resyncMap', () => {
    opened();
    session.resync();
    expect(worker.lastOf('resyncMap')).toBeDefined();
  });

  it('a failed-cells compiling shows a notice whose Retry asks for the chunks again', () => {
    opened();
    emit(compilingMsg(1, ['c1']));
    const notice = session.notices.find((n) => n.id === 'failed-cells')!;
    expect(notice).toEqual({ id: 'failed-cells', retry: 'chunks' });
    session.retry(notice);
    expect(worker.lastOf('retryChunks')).toBeDefined();
    expect(session.notices).toEqual([]);
  });

  it('dismiss removes a notice', () => {
    opened();
    session.send(doc2, {});
    emit(error(2, 'bad-request'));
    session.dismiss('not-applied');
    expect(session.notices).toEqual([]);
  });

  it('forwards cells, lookups, heights and chunks', () => {
    opened();
    emit({ type: 'cells', render: { revision: 0, cells: [], removedCells: [], demolish: [] } });
    emit({ type: 'lookups', month: 1, lookups: {} as never });
    emit({ type: 'heights', rev: 1, city: {} as never });
    emit({ type: 'chunks', loaded: 1, total: 1, failed: [] } as never);
    expect(deps.oncells).toHaveBeenCalledTimes(1);
    expect(deps.onlookups).toHaveBeenCalledTimes(1);
    expect(deps.onheights).toHaveBeenCalledTimes(1);
    expect(deps.onchunks).toHaveBeenCalledTimes(1);
  });

  it('a provisional open stays calculating and stale until the full document fills', () => {
    session.open(withPaint, null);
    emit(compiled(1));
    emit(filled(1, 0, 20));
    session.send(withPaint, lots);
    emit(compiled(2));
    expect([session.provisional, session.shown(5).stale]).toEqual([true, true]);
    emit(refill(2, 0));
    emit(filled(2, 0, LAST + 1));
    expect([session.provisional, session.shown(5).stale]).toEqual([false, false]);
  });

  it('opens once with the full document when lots resolve first', () => {
    session.open(withPaint, lots);
    session.send(withPaint, lots);
    expect(worker.all('openTimeline')).toHaveLength(1);
    expect(worker.all('setPolicy')).toHaveLength(0);
    expect(worker.lastOf('openTimeline')!.policy).toEqual(withPaint);
    expect(session.provisional).toBe(false);
  });

  it('compiled before refill does not end staleness; the refill and a covering filled do (main Q-A)', () => {
    opened();
    session.playhead(dayOf(15));
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    expect(session.shown(15).stale).toBe(true);
    emit(refill(2, 10));
    expect(session.shown(15).stale).toBe(true);
    emit(filled(2, 10, 6));
    expect(session.shown(15).stale).toBe(false);
    // the real-host e2e of this ordering waits on the ensemble-runner sha main supplies
  });

  it('exposes capacity and unknownLots from the last compiled', () => {
    opened();
    expect([session.capacity, session.unknownLots]).toEqual([{ rev: 1 }, 3]);
    emit(compiledMsg(1, STATICS, 7));
    expect([session.capacity, session.unknownLots]).toEqual([{ rev: 1 }, 7]);
    expect(session.statics).toBe(STATICS);
  });

  it('opens provisionally, then sends the full document', () => {
    session.open(withPaint, null);
    expect(queriesOf4(worker.lastOf('openTimeline')!.policy)).toEqual([]);
    expect(session.provisional).toBe(true);
    session.send(withPaint, lots);
    expect(worker.lastOf('setPolicy')!.policy).toEqual(withPaint);
    expect(session.playAvailable()).toBe(true);
    expect(session.notices).toEqual([]);
  });

  it("a rejection of the provisional open's document is rule 35", () => {
    session.open(withPaint, null);
    emit(compiled(1));
    emit(error(1, 'bad-request'));
    expect(session.notices.map((n) => n.id)).toEqual(['error']);
  });

  it('a rejected full document keeps the stripped forecast, provisional and stale', () => {
    session.open(withPaint, null);
    emit(compiled(1));
    emit(filled(1, 0, LAST + 1));
    session.send(withPaint, lots);
    emit(error(2, 'bad-request'));
    expect(session.notices).toEqual([{ id: 'not-applied' }]);
    expect(undoTo).not.toHaveBeenCalled();
    expect([session.provisional, session.shown(5).stale]).toEqual([true, true]);
    expect(session.shown(5).view).toBe(session.view);
  });

  // ---- fix round 1 ----

  it('provisional ends when the document becomes the stripped one before lots resolve (I1, A)', () => {
    session.open(withPaint, null);
    const stripped = worker.lastOf('openTimeline')!.policy;
    session.edited();
    session.send(stripped, {});
    expect(worker.all('setPolicy')).toHaveLength(0);
    emit(compiled(1));
    emit(filled(1, 0, LAST + 1));
    expect([session.provisional, session.shown(5).stale]).toEqual([false, false]);
  });

  it('provisional ends when the user removes the brushes after the full document was rejected (I1, B)', () => {
    session.open(withPaint, null);
    const stripped = worker.lastOf('openTimeline')!.policy;
    emit(compiled(1));
    emit(filled(1, 0, LAST + 1));
    session.send(withPaint, lots);
    emit(error(2, 'bad-request'));
    expect(session.provisional).toBe(true);
    session.edited();
    session.send(stripped, {});
    expect(worker.all('setPolicy')).toHaveLength(1);
    expect([session.provisional, session.shown(5).stale]).toEqual([false, false]);
  });

  it('a card opened after a refill, before its day is filled, is asked again (I2)', () => {
    const refresh = vi.fn();
    session.oncardrefresh = refresh;
    opened();
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 10));
    session.watchCard(dayOf(15));
    expect(refresh).not.toHaveBeenCalled();
    emit(filled(2, 10, 6));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a card opened while an edit is pending is asked again once it settles and fills (I2)', () => {
    const refresh = vi.fn();
    session.oncardrefresh = refresh;
    opened();
    session.edited();
    session.watchCard(dayOf(5));
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 20));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a restart re-opens with the pair the client last posted, then sends the current one (I3)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    opened();
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 20));
    session.edited();
    session.send(doc3, {});
    emit(compiled(3));
    emit(error(3, 'bad-request'));
    expect(undoTo).toHaveBeenLastCalledWith(doc2);
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 20));
    worker.crash();
    session.retry({ id: 'crash', retry: 'restart' });
    expect(worker.lastOf('openTimeline')!.policy).toEqual(doc3);
    expect(worker.lastOf('setPolicy')!.policy).toEqual(doc2);
    expect(session.accepted).toEqual(doc2);
  });

  it('a restart re-opens at the next rev and its posts are taken (ruling d)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    opened();
    worker.crash();
    session.retry({ id: 'crash', retry: 'restart' });
    expect(worker.lastOf('openTimeline')!.rev).toBe(2);
    emit(compiled(2));
    emit(filled(2, 0, 6));
    expect(session.view!.filledThrough).toBe(5);
    emit(error(1, 'timeline'));
    expect(session.notices).toEqual([]);
    session.edited();
    session.send(doc2, {});
    expect(worker.lastOf('setPolicy')!.rev).toBe(3);
    emit(compiled(3));
    emit(refill(3, 6));
    emit(filled(3, 6, LAST - 5));
    expect([session.shown(LAST).stale, session.playAvailable()]).toEqual([false, true]);
  });

  it('a crash before any open: Retry restarts and clears the crash (minor 2)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    worker.crash();
    session.retry({ id: 'crash', retry: 'restart' });
    expect([session.stoppedByError, session.phase, session.notices]).toEqual([
      false,
      'loading',
      []
    ]);
  });

  it('a rejected edit stays stale until the previous forecast is whole again (ruling a)', () => {
    opened();
    session.playhead(dayOf(5));
    session.edited();
    session.send(doc2, {});
    session.send(doc3, {});
    emit(compiled(2));
    emit(refill(2, 10));
    emit(filled(2, 10, 3));
    emit(error(3, 'bad-request'));
    expect(undoTo).toHaveBeenLastCalledWith(doc2);
    // filled to month 12, past the playhead, but short of the 19 held before the edit
    expect(session.shown(5).stale).toBe(true);
    emit(filled(2, 13, 7));
    expect(session.shown(5).stale).toBe(false);
  });

  it('an accepted edit is not held to the earlier fill (carry 4 governs)', () => {
    opened();
    session.playhead(dayOf(5));
    session.edited();
    session.send(doc2, {});
    emit(compiled(2));
    emit(refill(2, 10));
    expect(session.shown(5).stale).toBe(false);
  });

  it('compiled(R) then its rejection: the re-taken compiled restores statics (ruling b)', () => {
    opened();
    const other: ScoreStatics = { ...STATICS };
    session.edited();
    session.send(doc2, {});
    emit(compiledMsg(2, other, 9));
    expect([session.statics, session.unknownLots]).toEqual([other, 9]);
    emit(error(2, 'bad-request'));
    emit(compiled(1));
    emit(refill(1, 20));
    expect(session.statics).toBe(STATICS);
    expect([session.capacity, session.unknownLots]).toEqual([{ rev: 1 }, 3]);
  });

  it('an early rejection overtaken by a later accepted edit still shows not-applied (minor 5)', () => {
    session.open(doc1, {});
    session.edited();
    session.send(doc2, {});
    emit(error(2, 'bad-request'));
    session.edited();
    session.send(doc3, {});
    emit(compiled(3));
    emit(refill(3, 0));
    expect(session.notices).toEqual([{ id: 'not-applied' }]);
    expect(session.stoppedByError).toBe(false);
  });

  // ---- fix round 2 ----

  /** Provisional open, the full pair sent and rejected (carry 6); returns the stripped document. */
  function fullRejected(): SimPolicy4 {
    session.open(withPaint, null);
    const stripped = worker.lastOf('openTimeline')!.policy;
    emit(compiled(1));
    emit(filled(1, 0, LAST + 1));
    session.send(withPaint, lots);
    emit(error(2, 'bad-request'));
    return stripped;
  }

  it('a restart while the full document stands rejected re-opens, then sends the stripped pair', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stripped = fullRejected();
    worker.crash();
    session.retry({ id: 'crash', retry: 'restart' });
    expect(worker.posts.map((p) => p.type)).toEqual(['openTimeline', 'setPolicy']);
    expect(worker.lastOf('setPolicy')!).toMatchObject({ policy: stripped, lots: {} });
    expect(session.provisional).toBe(true);
    expect(session.notices.some((n) => n.id === 'error')).toBe(false);
    expect(undoTo).not.toHaveBeenCalled();
    emit(compiled(4));
    emit(refill(4, 0));
    emit(filled(4, 0, LAST + 1));
    expect([session.provisional, session.shown(5).stale]).toEqual([true, true]);
    expect(worker.all('setPolicy')).toHaveLength(1);
  });

  it("a 'timeline' error's Retry while the full document stands rejected sends the stripped pair", () => {
    const stripped = fullRejected();
    emit(error(2, 'timeline'));
    const notice = session.notices.find((n) => n.id === 'error')!;
    session.retry(notice);
    const tail = worker.posts.slice(-2);
    expect(tail.map((p) => p.type)).toEqual(['openTimeline', 'setPolicy']);
    expect(tail[1]).toMatchObject({ policy: stripped, lots: {} });
    expect(session.provisional).toBe(true);
    expect(session.notices.some((n) => n.id === 'error')).toBe(false);
    expect(undoTo).not.toHaveBeenCalled();
    emit(compiled(4));
    emit(refill(4, 0));
    emit(filled(4, 0, LAST + 1));
    expect(session.provisional).toBe(true);
  });

  it('after that re-open, a later rejected edit still never undoes to the stripped document', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stripped = fullRejected();
    worker.crash();
    session.retry({ id: 'crash', retry: 'restart' });
    emit(compiled(4));
    emit(refill(4, 0));
    session.edited();
    session.send(mk(protect('a', 6), painted), lots);
    emit(error(5, 'bad-request'));
    expect(undoTo).not.toHaveBeenCalled();
    expect(session.provisional).toBe(true);
    // the user removes the brushes: the stripped pair is what runs, so provisional ends when whole
    session.edited();
    session.send(stripped, {});
    emit(filled(4, 0, LAST + 1));
    expect(session.provisional).toBe(false);
  });

  it('sends a reconciled document', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    opened();
    const off = mk({
      ...protect('a', 5),
      spans: [{ ...protect('a', 5).spans[0], from: asOf + 40 }]
    });
    const rec = reconcilePolicy4(off, cal, asOf).doc;
    expect(rec).not.toBe(off);
    session.send(off, {});
    session.send(
      mk({ ...protect('a', 6), spans: [{ ...protect('a', 6).spans[0], from: asOf + 40 }] }),
      {}
    );
    expect(worker.all('setPolicy')[0].policy).toEqual(rec);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
