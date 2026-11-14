/**
 * `TimelineSession`: the /sim page's side of the timeline client (S14 as amended; timeline-ui
 * rules 16, 21, 29-36). It opens the timeline (provisionally while brush lots are unresolved),
 * sends edits, applies `compiled` / `filled` / `refill` in arrival order to a `ChunkLog`, keeps
 * the stale state (`fill.ts`), the documents it may undo to, the notices, the view month and the
 * card refresh.
 */
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { HeightCity } from '$lib/map/height/types';
import type { TimelineUpdate } from '$lib/map/types';
import type { LeverLookups } from '$lib/sim/levers/apply';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import type { ChunksResponse } from '$lib/sim/protocol';
import type { ScenarioWorkerInput } from '$lib/sim/scenario-client';
import { TimelineClient, type TimelineClientEvents } from '$lib/sim/timeline-client';
import type { ScoreStatics, TimelineView } from '$lib/sim/world/score/types';
import type { Calibration } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import {
  EMPTY_LOG,
  logCompiled,
  logFilled,
  logRefill,
  viewOfLog,
  type ChunkLog
} from './chunk-log';
import {
  NO_EDIT,
  afterView,
  edited,
  playAvailable,
  refilled,
  rejected,
  settled,
  shownAt,
  type EditState
} from './fill';
import { MonthGate, indexOfDay, viewMonthOf } from './playhead';
import { queriesOf4, type SimPolicy4 } from './policy4';
import { reconcilePolicy4 } from './reconcile4';

export type Capacity = LeverCapacity;
export type Lots = Record<string, ParcelId[]>;

export type SessionNotice =
  | { id: 'failed-cells'; retry: 'chunks' }
  /** CHANGE_NOT_APPLIED (rule 34). */
  | { id: 'not-applied' }
  /** Rule 35. */
  | {
      id: 'error';
      text: "The simulation couldn't load." | 'Part of the simulation stopped.';
      retry: 'open';
    }
  /** Rule 36. */
  | { id: 'crash'; retry: 'restart' };

export type SessionClient = Pick<
  TimelineClient,
  'open' | 'setPolicy' | 'viewMonth' | 'resyncMap' | 'retryChunks' | 'restart' | 'dispose'
>;

export interface SessionDeps {
  /**
   * The session builds its own client: `createClient(createWorker(), events)`; the default is
   * `new TimelineClient`. Also serves crash restart (no construction cycle).
   */
  createClient?(worker: ScenarioWorkerInput, events: TimelineClientEvents): SessionClient;
  manifest: Manifest;
  calibration: Calibration;
  /** The store: rule 34 undoes to the last accepted document. */
  undoTo(p: SimPolicy4): void;
  createWorker(): ScenarioWorkerInput;
  now(): number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  /** The map's cells, in arrival order (no rev). */
  oncells?(u: TimelineUpdate): void;
  /** The permitting tables at `month`, a new object each time. */
  onlookups?(l: LeverLookups, month: number): void;
  /** Heights in arrival order, no rev filter: a later post supersedes (ensemble-runner.md). */
  onheights?(c: HeightCity): void;
  onchunks?(c: ChunksResponse): void;
}

/** A document posted to the client, kept while the page may undo to it (S14). */
interface Sent {
  rev: number;
  policy: SimPolicy4;
  lots: Lots;
  key: string;
  /** Counts as an edit: stale and Play wait for a refill at its rev or later. */
  edit: boolean;
  /** Posted before anything showed the dataset loaded (no `compiling` or `compiled` yet). */
  early: boolean;
  rejected: boolean;
}

/** Canonical JSON: object keys sorted, so equal pairs compare equal. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : x
  );
}

const keyOf = (policy: SimPolicy4, lots: Lots): string => canon({ policy, lots });

/** The document without the zoning policies that need brush lots (OQ-3); `doc` itself when none. */
export function provisionalOf(doc: SimPolicy4): SimPolicy4 {
  const zoning = doc.kinds.zoning.filter(
    (p) => queriesOf4({ schema: 4, kinds: { zoning: [p], permitting: [], money: [] } }).length === 0
  );
  if (zoning.length === doc.kinds.zoning.length) return doc;
  return { ...doc, kinds: { ...doc.kinds, zoning } };
}

export class TimelineSession {
  #deps: SessionDeps;
  #client: SessionClient;
  #gate: MonthGate;
  #disposed = false;
  #warned = false;

  #log: ChunkLog = EMPTY_LOG;
  #view = $state.raw<TimelineView | null>(null);
  #statics = $state.raw<ScoreStatics | null>(null);
  #capacity = $state.raw<Capacity | null>(null);
  #unknownLots = $state(0);
  #edit = $state.raw<EditState>(NO_EDIT);
  #notices = $state.raw<readonly SessionNotice[]>([]);
  #stopped = $state(false);
  #crashed = $state(false);
  #provisional = $state(false);
  #filledSinceOpen = $state(false);
  #accepted = $state.raw<SimPolicy4 | null>(null);
  #day = $state<Day | null>(null);

  /** The last rev the client returned (it counts opens, edits and a restart's re-open). */
  #rev = 0;
  #openRev = 0;
  /** Every document sent since the last rev answered by a refill, that rev's included. */
  #kept: Sent[] = [];
  /** What the worker's timelines run (or will): a pair equal to it is not sent. */
  #lastKey = '';
  /** The last pair posted to the client, which a restart re-opens with, and its key. */
  #clientLast: { policy: SimPolicy4; lots: Lots } | null = null;
  #clientKey = '';
  /** The key of the latest open's document (the stripped one after a provisional open). */
  #openKey = '';
  /** The key of the stripped pair of the latest provisional open; '' when none. */
  #strippedKey = '';
  /**
   * The stripped document while the full one stands rejected after a provisional open (carry 6):
   * a re-open is followed by a `setPolicy` of it (fix round 2). Null otherwise.
   */
  #fullRejected: SimPolicy4 | null = null;
  /** The latest rev answered by a refill, or the open's: kept edits above it are pending. */
  #baseRev = 0;
  /** The latest pair the page asked for: Retry opens it. Lots null: provisional. */
  #current: { policy: SimPolicy4; lots: Lots | null } | null = null;
  /** `edited()` was called and its pair is not sent yet. */
  #dirty = false;
  #sawCompile = false;
  /** The first send after a provisional open (the full document); null until sent. */
  #fullRev: number | null = null;
  #fullRefilled = false;
  /** An early edit's rejection shown as rule 35 until older-rev posts show the fill went on. */
  #earlyRejected: number | null = null;
  #wantedMonth: number | null = null;
  #cardDay: Day | null = null;
  #cardDirty = false;

  /** The card's day needs asking again (rule 21): after an edit, once a `filled` covers it. */
  oncardrefresh?: () => void;

  constructor(deps: SessionDeps) {
    this.#deps = deps;
    this.#gate = new MonthGate({
      send: (m) => this.#client.viewMonth(m),
      now: deps.now,
      setTimeout: deps.setTimeout,
      clearTimeout: deps.clearTimeout
    });
    this.#client = this.#createClient();
  }

  #createClient(): SessionClient {
    const events = this.#events();
    const worker = this.#deps.createWorker();
    return this.#deps.createClient
      ? this.#deps.createClient(worker, events)
      : new TimelineClient(worker, events);
  }

  #events(): TimelineClientEvents {
    return {
      onCompiling: (m) => {
        this.#sawCompile = true;
        if (m.failedCells.length > 0) this.#notice({ id: 'failed-cells', retry: 'chunks' });
      },
      onCompiled: (m) => this.#compiled(m.rev, m.statics, m.capacity, m.unknownLots),
      onFilled: (m) => this.#filled(m.rev, m.series),
      onRefill: (m) => this.#refill(m.rev, m.from),
      onError: (m) => this.#error(m.rev, m.code),
      onCrash: () => this.#crash(),
      onCells: (m) => this.#deps.oncells?.(m.render),
      onLookups: (m) => this.#deps.onlookups?.(m.lookups, m.month),
      onHeights: (m) => this.#deps.onheights?.(m.city),
      onChunks: (c) => this.#deps.onchunks?.(c)
    };
  }

  // ---- what the page reads ----

  get view(): TimelineView | null {
    return this.#view;
  }
  /**
   * The last `compiled`'s statics, for what the page needs once (dates, baseline). It can be newer
   * than the statics `view` was built from (those of the last chunk) until the first `filled` at
   * that rev: read series figures from `view` only.
   */
  get statics(): ScoreStatics | null {
    return this.#statics;
  }
  /** From the last `compiled`, for SimResults. */
  get capacity(): Capacity | null {
    return this.#capacity;
  }
  get unknownLots(): number {
    return this.#unknownLots;
  }
  /** True from a provisional open until a refill at the full document's rev or later has come and the window is whole (OQ-3). */
  get provisional(): boolean {
    return this.#provisional;
  }
  get notices(): readonly SessionNotice[] {
    return this.#notices;
  }
  get phase(): 'loading' | 'ready' | 'failed' {
    if (this.#filledSinceOpen) return 'ready';
    return this.#stopped || this.#crashed ? 'failed' : 'loading';
  }
  /** Filling stopped (rule 35 error or a crash): Play runs inside the filled part. */
  get stoppedByError(): boolean {
    return this.#stopped || this.#crashed;
  }
  /** The newest document sent and not rejected: what the worker's timelines run. */
  get accepted(): SimPolicy4 | null {
    return this.#accepted;
  }

  /** At the playhead's calendar month: the view shown and whether it is stale. */
  shown(i: number): { view: TimelineView | null; stale: boolean } {
    const s = shownAt(this.#edit, this.#view, i);
    return this.#provisional ? { view: s.view ?? this.#view, stale: true } : s;
  }

  playAvailable(): boolean {
    return playAvailable(this.#edit, this.#view, this.stoppedByError);
  }

  // ---- what the page does ----

  /**
   * Opens the timeline. With `lots` null (brush queries unresolved), the document without its
   * brush and transit zoning goes out with no lots, and the next `send` completes the opening.
   */
  open(policy: SimPolicy4, lots: Lots | null): void {
    const doc = this.#reconcile(policy);
    this.#current = { policy: doc, lots };
    this.#fullRejected = null;
    this.#openWith(doc, lots);
  }

  /** A store change (rule 25: the caller pauses playback). Marks the edit at once. */
  edited(): void {
    this.#dirty = true;
    this.#edit = edited(this.#edit, this.#view);
  }

  /**
   * The unsent edit will not go out (a brush query it needs failed, so PolicySync has no lots for
   * it): its stale state ends, and the forecast stays the last sent document's. A sent edit still
   * waiting for its refill is left alone.
   */
  dropUnsent(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#settleIfDone();
  }

  /** The debounced pair from PolicySync: sent unless it equals what the worker runs. */
  send(policy: SimPolicy4, lots: Lots): void {
    const doc = this.#reconcile(policy);
    this.#current = { policy: doc, lots };
    if (this.#openRev === 0) return; // `open` sends it
    const key = keyOf(doc, lots);
    if (key === this.#lastKey) {
      this.#dirty = false;
      if (this.#provisional && key === this.#strippedKey) {
        // The document wanted is the stripped one: the open was the full document (I1).
        this.#fullRev = this.#openRev;
        this.#fullRefilled = true;
      }
      this.#settleIfDone();
      this.#update();
      return;
    }
    this.#post(doc, lots);
  }

  /** The playhead moved: viewMonth through the gate when its model month changes; stale recomputed. */
  playhead(day: Day): void {
    this.#day = day;
    this.#wantMonth();
    this.#afterView();
  }

  /** `onResyncNeeded` from the map. */
  resync(): void {
    this.#client.resyncMap();
  }

  retry(notice: SessionNotice): void {
    this.dismiss(notice.id);
    switch (notice.id) {
      case 'failed-cells':
        this.#client.retryChunks();
        return;
      case 'error':
        if (this.#current) {
          this.#openWith(this.#current.policy, this.#current.lots);
          this.#keepStripped();
        }
        return;
      case 'crash':
        this.#restart();
        return;
    }
  }

  dismiss(id: SessionNotice['id']): void {
    if (this.#notices.some((n) => n.id === id)) {
      this.#notices = this.#notices.filter((n) => n.id !== id);
    }
  }

  /** The day of the open card, or null when none is open. */
  watchCard(day: Day | null): void {
    this.#cardDay = day;
    // Asked now while its day is stale (an edit pending, or not filled there yet): ask again later.
    const v = this.#view;
    this.#cardDirty =
      day !== null &&
      (this.#edit.pending || v === null || v.filledThrough < indexOfDay(v.months, day));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#gate.dispose();
    this.#client.dispose();
  }

  // ---- sending ----

  /** R-3: every document sent is reconciled; a change here is a bug upstream, warned once. */
  #reconcile(p: SimPolicy4): SimPolicy4 {
    const doc = reconcilePolicy4(p, this.#deps.calibration, this.#deps.calibration.asOf).doc;
    if (doc !== p && !this.#warned) {
      this.#warned = true;
      console.warn('timeline: a document reached the session unreconciled; sent reconciled');
    }
    return doc;
  }

  #openWith(doc: SimPolicy4, lots: Lots | null): void {
    // Stripping may legitimately change the reconciled result: no R-3 warning for it.
    const cal = this.#deps.calibration;
    const sendDoc = lots === null ? reconcilePolicy4(provisionalOf(doc), cal, cal.asOf).doc : doc;
    const sendLots = lots ?? {};
    const rev = this.#client.open(this.#deps.manifest, sendDoc, sendLots);
    this.#rev = rev;
    this.#clientLast = { policy: sendDoc, lots: sendLots };
    this.#opened(rev, sendDoc, sendLots, sendDoc !== doc);
    if (sendDoc !== doc) this.#strippedKey = this.#openKey;
  }

  /**
   * Fix round 2: after a re-open while the full document stands rejected, the stripped pair goes
   * out at once. Sent before the load, it replaces the re-open's document (ensemble-runner.md,
   * "Rejection before the load"). Part of opening, not an edit; provisional stays true and the
   * full document waits for the user's next edit.
   */
  #keepStripped(): void {
    const stripped = this.#fullRejected;
    if (stripped === null) return;
    const dirty = this.#dirty;
    this.#dirty = false;
    this.#provisional = true;
    this.#post(stripped, {});
    this.#dirty = dirty;
    this.#fullRev = null;
    this.#fullRefilled = false;
  }

  /** A new session at `rev` (an open or a restart's re-open): the log starts over. */
  #opened(rev: number, policy: SimPolicy4, lots: Lots, provisional: boolean): void {
    const key = keyOf(policy, lots);
    this.#openRev = rev;
    this.#openKey = key;
    this.#baseRev = rev;
    this.#kept = [{ rev, policy, lots, key, edit: false, early: true, rejected: false }];
    this.#lastKey = key;
    this.#clientKey = key;
    this.#accepted = policy;
    this.#sawCompile = false;
    this.#earlyRejected = null;
    this.#provisional = provisional;
    this.#fullRev = null;
    this.#fullRefilled = false;
    this.#stopped = false;
    this.#crashed = false;
    this.#filledSinceOpen = false;
    this.dismiss('error');
    this.dismiss('crash');
    // The old numbers stay, dimmed, until the new fill passes the playhead.
    const before = this.#view;
    if (before !== null) this.#edit = { ...refilled(this.#edit, before), sinceWhole: true };
    this.#log = EMPTY_LOG;
    this.#view = null;
    this.#cardDirty = this.#cardDay !== null;
    this.#wantedMonth = null;
    this.#wantMonth();
    this.#settleIfDone();
  }

  #post(doc: SimPolicy4, lots: Lots): void {
    const rev = this.#client.setPolicy(doc, lots);
    this.#rev = rev;
    const key = keyOf(doc, lots);
    if (key !== this.#strippedKey) this.#fullRejected = null;
    // The first send after a provisional open is part of opening, not an edit.
    const opening = this.#provisional && this.#fullRev === null && !this.#dirty;
    if (this.#provisional && this.#fullRev === null) this.#fullRev = rev;
    this.#kept.push({
      rev,
      policy: doc,
      lots,
      key,
      edit: !opening,
      early: !this.#sawCompile,
      rejected: false
    });
    this.#lastKey = key;
    this.#clientLast = { policy: doc, lots };
    this.#clientKey = key;
    this.#accepted = doc;
    this.#dirty = false;
    if (!opening) this.#edit = edited(this.#edit, this.#view);
  }

  #restart(): void {
    const reopens = this.#openRev > 0;
    this.#client.restart(this.#deps.createWorker());
    const last = this.#clientLast;
    if (!reopens || last === null) {
      this.#crashed = false;
      this.dismiss('crash');
      return;
    }
    // GUESS (composer): the client re-opens with the last pair it posted, at its next rev;
    // `restart` returns no rev, so it is mirrored here.
    this.#rev += 1;
    const provisional =
      this.#provisional && this.#fullRev === null && this.#clientKey === this.#openKey;
    this.#opened(this.#rev, last.policy, last.lots, provisional);
    if (this.#fullRejected !== null) {
      this.#keepStripped();
      return;
    }
    const cur = this.#current;
    if (cur && cur.lots !== null && keyOf(cur.policy, cur.lots) !== this.#clientKey) {
      this.#post(cur.policy, cur.lots);
    }
  }

  // ---- what the worker posts ----

  #compiled(rev: number, statics: ScoreStatics, capacity: Capacity, unknownLots: number): void {
    this.#sawCompile = true;
    this.#log = logCompiled(this.#log, statics);
    this.#statics = statics;
    this.#capacity = capacity;
    this.#unknownLots = unknownLots;
    this.#fillWentOn(rev);
    this.#update();
  }

  #filled(rev: number, series: Parameters<typeof logFilled>[1]): void {
    this.#log = logFilled(this.#log, series);
    this.#filledSinceOpen = true;
    this.#fillWentOn(rev);
    this.#update();
  }

  #refill(rev: number, from: number): void {
    const before = this.#view;
    this.#log = logRefill(this.#log, from);
    this.#edit = refilled(this.#edit, before);
    // `rev` is now the base: older documents can no longer be undone to.
    let kept = this.#kept.filter((e) => e.rev >= rev && !(e.rev > rev && e.rejected));
    if (!kept.some((e) => e.rev === rev)) {
      const base = this.#kept.filter((e) => e.rev < rev).at(-1);
      if (base) kept = [base, ...kept];
    }
    this.#kept = kept;
    this.#baseRev = rev;
    this.#fillWentOn(rev);
    if (this.#earlyRejected !== null && rev > this.#earlyRejected) {
      // A later edit was accepted over an early rejection: that change still was not applied.
      this.#earlyRejected = null;
      this.#notice({ id: 'not-applied' });
    }
    if (this.#fullRev !== null && rev >= this.#fullRev) this.#fullRefilled = true;
    // An accepted edit or a taken-up one resumes a fill an error stopped.
    if (this.#stopped) {
      this.#stopped = false;
      this.dismiss('error');
    }
    if (this.#cardDay !== null && this.#statics !== null) {
      if (indexOfDay(this.#statics.months, this.#cardDay) >= from) this.#cardDirty = true;
    }
    // Carry 8: settle, then the refill's view goes in before `afterView` judges it.
    this.#recomputePending();
    this.#update();
  }

  #error(rev: number, code: string): void {
    if (rev < this.#openRev) return; // an earlier session's
    if (code !== 'bad-request') {
      this.#stop();
      return;
    }
    const e = this.#kept.find((k) => k.rev === rev);
    if (!e || e.rejected) return;
    e.rejected = true;
    if (rev === this.#openRev) {
      // A late rejection of the open's own document: nothing to take up (rule 35).
      this.#stop();
    } else if (e.early) {
      // GUESS (composer): "early" = sent before any `compiling`/`compiled` arrived (`#post`). It
      // may have replaced the opening's document before the load (rule 35), or the fill may go on
      // under an earlier document (rule 34): older-rev posts after this tell.
      this.#earlyRejected = rev;
      this.#stop();
    } else {
      this.#notApplied();
    }
    this.#settleIfDone();
  }

  /** Rule 34: undo to the newest kept document not rejected, unless it is the stripped open. */
  #notApplied(): void {
    // Ruling (a): stale until the previous forecast is back to the held view's months.
    this.#edit = rejected(this.#edit);
    const target = this.#kept.filter((k) => !k.rejected).at(-1);
    if (target) {
      this.#lastKey = target.key;
      this.#accepted = target.policy;
      // Never undo to the stripped document: that would drop the user's brushes (carry 6).
      const stripped = this.#provisional && target.key === this.#strippedKey;
      if (stripped) this.#fullRejected = target.policy;
      else this.#deps.undoTo(target.policy);
    }
    this.#notice({ id: 'not-applied' });
  }

  /** Rule 35: filling stopped until the next accepted edit or open. */
  #stop(): void {
    this.#stopped = true;
    const text = this.#filledSinceOpen
      ? 'Part of the simulation stopped.'
      : "The simulation couldn't load.";
    this.#notice({ id: 'error', text, retry: 'open' });
  }

  /** A post at a rev older than an early rejected edit: the fill went on, so that was rule 34. */
  #fillWentOn(rev: number): void {
    const r = this.#earlyRejected;
    if (r === null || rev >= r) return;
    this.#earlyRejected = null;
    this.#stopped = false;
    this.dismiss('error');
    this.#notApplied();
    this.#settleIfDone();
  }

  #crash(): void {
    this.#crashed = true;
    this.#notice({ id: 'crash', retry: 'restart' });
  }

  // ---- derived state ----

  #notice(n: SessionNotice): void {
    this.#notices = [...this.#notices.filter((x) => x.id !== n.id), n];
  }

  /** An edit is pending while it is unsent or a kept edit above the base is not rejected. */
  #recomputePending(): void {
    const base = this.#baseRev;
    const pending = this.#dirty || this.#kept.some((e) => e.edit && !e.rejected && e.rev > base);
    if (!pending && this.#edit.pending) this.#edit = settled(this.#edit);
  }

  #settleIfDone(): void {
    this.#recomputePending();
    this.#afterView();
  }

  #index(): number {
    const s = this.#statics;
    return s === null || this.#day === null ? 0 : indexOfDay(s.months, this.#day);
  }

  #update(): void {
    this.#view = viewOfLog(this.#log);
    const v = this.#view;
    if (this.#provisional && this.#fullRefilled && v !== null && v.filledThrough === v.lastIndex) {
      this.#provisional = false;
      this.#fullRejected = null;
    }
    this.#afterView();
    this.#cardCheck();
  }

  #afterView(): void {
    const next = afterView(this.#edit, this.#view, this.#index());
    if (
      next.held !== this.#edit.held ||
      next.pending !== this.#edit.pending ||
      next.sinceWhole !== this.#edit.sinceWhole
    ) {
      this.#edit = next;
    }
  }

  #cardCheck(): void {
    const day = this.#cardDay;
    const v = this.#view;
    if (!this.#cardDirty || day === null || v === null || this.#edit.pending) return;
    if (v.filledThrough < indexOfDay(v.months, day)) return;
    this.#cardDirty = false;
    this.oncardrefresh?.();
  }

  #wantMonth(): void {
    if (this.#day === null || this.#openRev === 0) return;
    const m = viewMonthOf(this.#deps.calibration.asOf, this.#day);
    if (m === this.#wantedMonth) return;
    this.#wantedMonth = m;
    this.#gate.want(m);
  }
}
