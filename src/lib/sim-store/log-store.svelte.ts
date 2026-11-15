/**
 * The browser's log store for `/sim` (decision 3): a `LocalLog` behind the editors' interface,
 * with drafts (R1), restore commits for undo and redo (R10, R11), the dataset rule and the move
 * commit (R55), and the stopped states (decision 21). Every derived value is a rune set once per
 * change (decision 32).
 */
import { rulesetText, type Commit, type CommitDraft, type RulesetContent } from '$lib/sim-log';
import { newId } from '$lib/ids/base58';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import {
  SOURCES,
  authorEdit,
  authorMove,
  authorRestore,
  nextTarget,
  type Authored,
  type Meta
} from './author';
import { datasetDecision, type DatasetDecision } from './dataset';
import type { HistoryTarget } from './history';
import { LocalLog, type Received } from './local-log';
import type {
  CreateResult,
  PendingPut,
  PendingRecord,
  SimDb,
  WriteBatch,
  WriteResult
} from './sim-db';
import {
  MOVE_SOURCE,
  type Align,
  type DropReport,
  type Pending,
  type Stamp,
  type Stopped
} from './types';

/**
 * What the editors call on a schema 4 store (decision 29). A load (the page's `PolicyStore.reset`)
 * is not an edit and is not here: in log terms it is `open` or an import.
 */
export interface DocStore {
  readonly policy: SimPolicy4;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  apply(change: (p: SimPolicy4) => SimPolicy4, label: string, coalesce?: string): void;
  /** Returns the label of the change undone, at once, or null. */
  undo(): string | null;
  redo(): string | null;
  undoTo(p: SimPolicy4, label: string): void;
}

export interface LogStoreOptions {
  /** null: storage unavailable (decision 17). */
  db: SimDb | null;
  /** This page load's id: the owner of the pending commits it makes. */
  tabId: string;
  /** The page's dataset version and build, read at each commit. */
  stamp: () => Stamp;
  /** Default newId. */
  mintId?: () => string;
  normalize?: (next: SimPolicy4, prev: SimPolicy4) => SimPolicy4;
  /** Passed to the LocalLog; default (c) => c. */
  align?: Align;
  now?: () => number;
  /** A sim this store creates is made meta.current if none is (decision 28). Default true. */
  current?: boolean;
  /** Tests only: passed to authoring (Meta.caps). */
  caps?: { count: number; bytes: number };
}

export type LocalStatus = 'idle' | 'writing' | 'failed';
/** 'stopped': an open draft could only be settled once the store was stopped, so it went. */
export type EditRefusal = 'invalid' | 'too-large' | 'queue-full' | 'stopped';
export interface ImportMarker {
  key: string;
  value: unknown;
  expect: unknown;
}
export type ImportResult = 'imported' | 'unchanged' | 'marker' | 'stopped' | EditRefusal;
/**
 * What `LogStore.receive` answers: the log's answer, or `stale` with `why` when the frame was
 * ignored (for another sim, or while the store is not ready).
 */
export type StoreReceived = Received | { kind: 'stale'; why: 'other-sim' | 'not-ready' };

/** A coalesced run of edits, in memory only until it is settled into one commit (R1). */
interface Draft {
  key: string;
  label: string;
  source: string;
  policy: SimPolicy4;
}

/** An import waiting for its write with the marker (decision 30). */
interface MarkerJob {
  marker: ImportMarker;
  /** The import commit's id. */
  id: string;
  /** The move authored ahead of it, if any: withdrawn with it when nothing follows. */
  moveId: string | null;
  /** The sim id before the import: null when the import minted it. */
  simBefore: string | null;
  resolve: (r: ImportResult) => void;
}

/** One write: the whole dirty state (decision 16), and what it holds, to record once it lands. */
interface Job {
  batch: WriteBatch;
  /** The version of each record put. */
  versions: Map<string, Pending>;
  /** The highest confirmed seq in the batch. */
  seq: number;
}

/** A pending record this tab wrote: its stored n and the version written. */
interface Written {
  n: number;
  p: Pending;
}

const isMove = (d: CommitDraft): boolean => d.kind === 'system' && d.source === MOVE_SOURCE;

/** The same version of a pending commit (the log keeps the object when nothing changed). */
const sameVersion = (a: Pending, b: Pending): boolean =>
  a === b || (a.draft === b.draft && a.targetId === b.targetId);

const errorName = (e: unknown): string => {
  const name = (e as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : 'unknown';
};

/** Canonically equal policies (the name aside). */
const samePolicy = (a: SimPolicy4, b: SimPolicy4): boolean =>
  a === b || rulesetText({ name: '', policy: a }) === rulesetText({ name: '', policy: b });

export class LogStore implements DocStore {
  readonly #opts: LogStoreOptions;
  readonly #mintId: () => string;
  readonly #align: Align;
  #log: LocalLog;
  #serverDs: string | null = null;
  #draft: Draft | null = null;
  /**
   * The id of a move this store authored ahead of an edit, until a commit is authored behind it:
   * never sent alone, and dropped when the edit is refused or changes nothing.
   */
  #bareMove: string | null = null;
  /** The server refused a move: stopped 'stale' until a commit is applied or its dataset changes. */
  #moveRefused = false;
  /** Derived state changed since subscribers were last told (told once per public call). */
  #dirty = false;
  /** Each fold policy shown, to the id of the commit at the local tip then (null: position 0). */
  #shownAt = new WeakMap<SimPolicy4, string | null>();
  #targets: { undo: HistoryTarget | null; redo: HistoryTarget | null } = {
    undo: null,
    redo: null
  };
  #subscribers: (() => void)[] = [];

  // ---- persistence (decisions 16, 17, 28, 30) ----
  // The Maps and Sets of the persistence code are bookkeeping of what is stored, never shown:
  // what is shown is the runes, set from the log once per change (decision 32).
  /* eslint-disable svelte/prefer-svelte-reactivity */
  /** Changes whenever the log is replaced (open, adopting the current sim): stale writes skip. */
  #gen = 0;
  /** This store minted the sim id: its first write asks for meta.current. */
  #minted = false;
  /** The sim's record is in the database (read, or created by this store). */
  #simStored = false;
  /** This tab's pending records in the database, by id. */
  #written = new Map<string, Written>();
  /** Records this tab owns but did not place (claimed): put without n, or removed. */
  #unplaced = new Set<string>();
  /* eslint-enable svelte/prefer-svelte-reactivity */
  /** The highest confirmed seq in the database for this sim. */
  #confirmedSeq = 0;
  /** The write chain, while it runs (one write at a time). */
  #writing: Promise<void> | null = null;
  /**
   * The chain is running: set before its first statement runs, so a `#kick` from inside its first
   * pass (before `#writing` is assigned) is a no-op and never starts a second chain.
   */
  #looping = false;
  /** The import waiting for its write (one at a time: a second import waits for it). */
  #markerJob: MarkerJob | null = null;
  #importing: Promise<void> | null = null;
  /** The open or claim under way, settled either way (they never overlap). */
  #lifecycle: Promise<void> | null = null;

  #ready = $state.raw(false);
  #simId = $state.raw<string | null>(null);
  #policy = $state.raw<SimPolicy4>(DEFAULT_POLICY4);
  #name = $state.raw('');
  #canUndo = $state.raw(false);
  #canRedo = $state.raw(false);
  #undoLabel = $state.raw<string | null>(null);
  #redoLabel = $state.raw<string | null>(null);
  #local = $state.raw<LocalStatus>('idle');
  #drafting = $state.raw(false);
  #pending = $state.raw<readonly Pending[]>([]);
  #stopped = $state.raw<Stopped | null>(null);
  #serverDataset = $state.raw<string | null>(null);
  #drops = $state.raw<readonly DropReport[]>([]);
  #refusal = $state.raw<EditRefusal | null>(null);

  constructor(opts: LogStoreOptions) {
    this.#opts = opts;
    this.#mintId = opts.mintId ?? newId;
    this.#align = opts.align ?? ((c) => c);
    this.#local = opts.db === null ? 'failed' : 'idle';
    this.#log = this.#newLog();
    this.#policy = this.#log.ruleset().policy;
    this.#derive();
    this.#dirty = false;
  }

  get ready(): boolean {
    return this.#ready;
  }
  get simId(): string | null {
    return this.#simId;
  }
  get policy(): SimPolicy4 {
    return this.#policy;
  }
  get name(): string {
    return this.#name;
  }
  get canUndo(): boolean {
    return this.#canUndo;
  }
  get canRedo(): boolean {
    return this.#canRedo;
  }
  get undoLabel(): string | null {
    return this.#undoLabel;
  }
  get redoLabel(): string | null {
    return this.#redoLabel;
  }
  get local(): LocalStatus {
    return this.#local;
  }
  get drafting(): boolean {
    return this.#drafting;
  }
  get pendingCount(): number {
    return this.#pending.length;
  }
  /** The pending commits in force, in order (read-only). */
  get pending(): readonly Pending[] {
    return this.#pending;
  }
  get stopped(): Stopped | null {
    return this.#stopped;
  }
  get serverDataset(): string | null {
    return this.#serverDataset;
  }
  get drops(): readonly DropReport[] {
    return this.#drops;
  }
  get refusal(): EditRefusal | null {
    return this.#refusal;
  }

  // ---- the editors ----

  /** True when this edit changed what is shown (its own change, after settling a draft). */
  apply(
    change: (p: SimPolicy4) => SimPolicy4,
    label: string,
    coalesce?: string,
    source: string = SOURCES.edit
  ): boolean {
    if (!this.#ready) return false;
    if (this.#recheck()) return this.#done(false);
    const draft = this.#draft;
    if (coalesce !== undefined && draft !== null && draft.key === coalesce) {
      const next = this.#run(change, this.#policy);
      if (next === null) return this.#done(false);
      this.#draft = { key: coalesce, label, source, policy: next };
      this.#changed();
      return true;
    }
    this.#settleDraft();
    const shown = this.#policy;
    if (!this.#prepare()) {
      this.#changed();
      return false;
    }
    // After a move the change runs on the aligned fold; else on what is shown.
    const base = this.#bareMove !== null ? this.#log.ruleset().policy : shown;
    const next = this.#run(change, base);
    if (next === null) {
      this.#dropBareMove();
      this.#changed();
      return false;
    }
    if (coalesce !== undefined) {
      this.#draft = { key: coalesce, label, source, policy: next };
      this.#changed();
      return true;
    }
    const r = this.#author(
      (m) => authorEdit(this.#log, { name: this.#log.ruleset().name, policy: next }, m),
      label,
      source
    );
    this.#changed();
    return r.ok && this.#policy !== shown;
  }

  undo(): string | null {
    return this.#restore('undo');
  }

  redo(): string | null {
    return this.#restore('redo');
  }

  /**
   * A jump to the commit that produced `p` when this store showed it and that commit is still
   * held (R14: it clears redo); otherwise an edit to `p`.
   */
  undoTo(p: SimPolicy4, label: string): void {
    if (!this.#ready) return;
    this.#settleDraft();
    if (this.#prepare()) {
      const log = this.#log;
      const id = this.#shownAt.get(p);
      const position = id === undefined ? null : log.positionOf(id);
      if (position === log.position) this.#dropBareMove();
      else if (position !== null) {
        this.#author(
          (m) => authorRestore(log, position, 'jump', m, this.#align),
          label,
          SOURCES.revert
        );
      } else {
        const base = this.#bareMove !== null ? log.ruleset().policy : this.#policy;
        const next = this.#opts.normalize ? this.#opts.normalize(p, base) : p;
        this.#author(
          (m) => authorEdit(log, { name: log.ruleset().name, policy: next }, m),
          label,
          SOURCES.revert
        );
      }
    }
    this.#changed();
  }

  rename(name: string): void {
    if (!this.#ready) return;
    this.#settleDraft();
    if (this.#prepare()) {
      this.#author(
        (m) => authorEdit(this.#log, { name, policy: this.#log.ruleset().policy }, m),
        'Rename',
        SOURCES.name
      );
    }
    this.#changed();
  }

  /** Commits an open draft (R1: focus leaving, hidden, pagehide, navigation, teardown). */
  settle(): void {
    if (this.#draft === null) return;
    this.#settleDraft();
    this.#changed();
  }

  clearDrops(): void {
    if (this.#drops.length === 0) return;
    this.#drops = [];
    this.#changed();
  }

  // ---- life cycle ----

  /** null: a new sim, minted at the first commit (R29). Rejects when the read fails. */
  open(simId: string | null, opts?: { claim?: readonly string[] }): Promise<void> {
    return this.#exclusive(() => this.#open(simId, opts));
  }

  /**
   * Takes other tabs' pending commits of this sim and re-applies them after this tab's
   * (decision 22). Answers how many were adopted. Rejects when the claim fails.
   */
  claim(owners: readonly string[]): Promise<number> {
    return this.#exclusive(() => this.#claim(owners));
  }

  /**
   * `open` and `claim` never overlap: one started while the other runs waits for it, so records
   * claimed for a sim are adopted into that sim's log. Runs at once when nothing is under way.
   */
  async #exclusive<T>(run: () => Promise<T>): Promise<T> {
    while (this.#lifecycle !== null) await this.#lifecycle;
    const out = run();
    const done: Promise<void> = out.then(
      () => {},
      () => {}
    );
    this.#lifecycle = done;
    void done.then(() => {
      if (this.#lifecycle === done) this.#lifecycle = null;
    });
    return out;
  }

  async #open(simId: string | null, opts?: { claim?: readonly string[] }): Promise<void> {
    // An open draft is committed to the sim it was made on before another is opened. A draft
    // refused at that moment keeps its refusal visible.
    if (this.#settleDraft() !== 'refused') this.#refusal = null;
    let confirmed: Commit[] = [];
    let records: PendingRecord[] = [];
    let stored = false;
    const db = this.#opts.db;
    // Without a database there is nothing to read: a known sim opens with an empty log.
    if (db !== null) {
      this.#ready = false;
      try {
        // What this tab made on the sim it leaves is written there first.
        this.#kick();
        await this.written();
        if (simId !== null) {
          const claim = opts?.claim ?? [];
          if (claim.length > 0 && this.#local !== 'failed') {
            await db.claimPending(simId, claim, this.#opts.tabId);
          }
          const read = await db.read(simId);
          confirmed = read.confirmed;
          records = read.pending.filter((r) => r.owner === this.#opts.tabId);
          stored = read.sim !== null;
        }
      } catch (e) {
        this.#dirty = true;
        this.#flush();
        throw e;
      }
    }
    // This tab's records and the claimed ones, in n order; those already confirmed are removed
    // at the next write (I5), and the ones re-applied differently are written again.
    this.#replace(
      simId,
      confirmed,
      records.map((r) => r.pending),
      records,
      stored
    );
    this.#drops = [...this.#log.initialDrops];
    this.#ready = true;
    this.#alignStep();
    this.#changed();
  }

  async #claim(owners: readonly string[]): Promise<number> {
    this.settle();
    const db = this.#opts.db;
    const simId = this.#simId;
    // Without a working database no other tab's commits can be reached.
    if (!this.#ready || db === null || this.#local === 'failed' || simId === null) return 0;
    if (owners.length === 0) return 0;
    const gen = this.#gen;
    const claimed = await db.claimPending(simId, owners, this.#opts.tabId);
    if (gen !== this.#gen || claimed.length === 0) return 0;
    // A draft opened meanwhile was made on the fold without them.
    this.#settleDraft();
    const log = this.#log;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const known = new Set([...log.pending, ...log.held].map((p) => p.draft.id));
    const a = log.adopt(claimed.map((r) => r.pending));
    // Put again without n, so they follow this tab's own; or removed when not kept.
    for (const r of claimed) if (!this.#written.has(r.id)) this.#unplaced.add(r.id);
    this.#addDrops(a.drops);
    this.#alignStep();
    this.#changed();
    const gone = new Set(a.confirmed); // eslint-disable-line svelte/prefer-svelte-reactivity
    return claimed.filter((r) => !known.has(r.id) && !gone.has(r.id)).length;
  }

  /**
   * One system commit (sim.import) to `content`, written with the marker in the same
   * transaction (decision 30). 'marker': the marker was not what was expected; nothing was
   * written and the commit is withdrawn. Without a working database: 'imported', no marker.
   */
  async importContent(
    content: RulesetContent,
    marker: ImportMarker,
    label = 'Imported'
  ): Promise<ImportResult> {
    // One import at a time: its batch is the whole dirty state, so another import in it would be
    // written under the first one's marker.
    while (this.#importing !== null) await this.#importing;
    if (!this.#ready) return 'stopped';
    if (this.#recheck()) return this.#done('stopped');
    this.#settleDraft();
    const simBefore = this.#simId;
    if (!this.#prepare()) {
      this.#changed();
      // Not stopped: the move this import needed was refused, and `refusal` says why.
      return this.#stoppedNow() !== null ? 'stopped' : (this.#refusal ?? 'stopped');
    }
    const moveId = this.#bareMove;
    const r = authorEdit(this.#log, content, this.#meta(label, SOURCES.import), 'system');
    this.#settled(r);
    if (!r.ok || !this.#canWrite()) {
      this.#changed();
      return r.ok ? 'imported' : r.why;
    }
    const id = r.pending.draft.id;
    // Queued before the write starts, so the import is only ever written with its marker.
    const done = new Promise<ImportResult>((resolve) => {
      this.#markerJob = { marker, id, moveId, simBefore, resolve };
    });
    const finished: Promise<void> = done.then(() => {
      if (this.#importing === finished) this.#importing = null;
    });
    this.#importing = finished;
    this.#changed();
    return done;
  }

  // ---- the socket's side ----

  /** From the socket's hello. Re-applies and re-decides (the dataset rule). */
  setServerDataset(s: string): void {
    // The value it has: nothing at all (a reconnect does not split a drag into two commits).
    if (s === this.#serverDs) return;
    // A hello can stop the store: an open draft is committed first, while it can still author.
    this.#settleDraft();
    this.#moveRefused = false;
    this.#serverDs = s;
    this.#addDrops(this.#log.setServerDataset(s).drops);
    this.#alignStep();
    this.#changed();
  }

  /**
   * A `commits` frame from the socket of sim `simId`. A frame for another sim than the store's,
   * or one that arrives while the store is not ready (an open under way, or one that rejected),
   * is ignored: nothing is applied or written, and the answer is `stale` with its reason.
   */
  receive(simId: string, commits: readonly Commit[]): StoreReceived {
    if (!this.#ready) return { kind: 'stale', why: 'not-ready' };
    if (simId !== this.#simId) return { kind: 'stale', why: 'other-sim' };
    const log = this.#log;
    const tip = log.tipSeq;
    // A new commit that is not one of this tab's pending ones ends an open draft (decision 8).
    const foreign = (c: Commit) => c.seq > tip && log.positionOf(c.id) === null;
    if (this.#draft !== null && commits.some(foreign)) this.#settleDraft();
    const r = log.receive(commits);
    if (r.kind !== 'stale') {
      this.#addDrops(r.drops);
      if (log.tipSeq > tip) this.#moveRefused = false;
      this.#alignStep();
    }
    this.#changed();
    return r;
  }

  /** The head pending draft that may be sent (I2), or null; null while stopped. */
  head(): CommitDraft | null {
    // Not ready (an open under way, or one that rejected): which sim it is on is not settled.
    if (!this.#ready) return null;
    if (this.#serverDs === null || this.#stoppedNow() !== null) return null;
    const first = this.#log.pending[0];
    if (first === undefined || first.draft.id === this.#bareMove) return null;
    // Storage unavailable or failed (decision 17): sent at once, never reported stored.
    if (this.#opts.db === null || this.#local === 'failed') return first.draft;
    // Storage working: only once the version returned is stored (R15).
    const w = this.#written.get(first.draft.id);
    return w !== undefined && sameVersion(w.p, first) ? first.draft : null;
  }

  /** Refused `invalid`: drop it, re-apply the rest, report it. */
  dropPending(id: string): void {
    const p = this.#log.pending.find((q) => q.draft.id === id);
    if (p === undefined) return;
    // An open draft is committed first on every drop, while the store can still author (a
    // dropped move stops it).
    this.#settleDraft();
    // The server refused a move, or an alignment commit (the same source, treated the same):
    // no other is authored, and the store is stopped 'stale', until a commit lands or the
    // server's dataset changes. A refused move never loops.
    if (isMove(p.draft)) this.#moveRefused = true;
    if (id === this.#bareMove) this.#bareMove = null;
    this.#addDrops(this.#log.drop(id));
    this.#alignStep();
    this.#changed();
  }

  /** Resolves when nothing is left to write (or writing has failed). */
  async written(): Promise<void> {
    while (this.#writing !== null) await this.#writing;
  }

  /** Called after every change of state, written or not. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.#subscribers = [...this.#subscribers, fn];
    return () => {
      this.#subscribers = this.#subscribers.filter((f) => f !== fn);
    };
  }

  // ---- internals ----

  /** A log on the store's server dataset and the page's dataset and build. */
  #newLog(confirmed: readonly Commit[] = [], pending: readonly Pending[] = []): LocalLog {
    const stamp = this.#opts.stamp();
    return new LocalLog({
      confirmed,
      pending,
      align: this.#align,
      serverDataset: this.#serverDs,
      page: stamp.datasetVersion,
      build: stamp.build
    });
  }

  #meta(label: string, source: string): Meta {
    const caps = this.#opts.caps;
    return { id: this.#mintId(), label, source, stamp: this.#opts.stamp(), ...(caps && { caps }) };
  }

  #decision(): DatasetDecision {
    const page = this.#opts.stamp().datasetVersion;
    return datasetDecision(page, this.#log.ruleset().datasetVersion, this.#serverDs);
  }

  /** Why the store authors nothing now, or null (decision 21 and the rulings). */
  #stoppedNow(): Stopped | null {
    // Permanent for the log (a newer build's commit); a sim opened after it has a new log.
    if (this.#log.future) return 'future';
    // Anything held: a push would land behind it, out of view.
    if (this.#log.held.length > 0) return this.#serverDs === null ? 'unknown-dataset' : 'stale';
    if (this.#moveRefused) return 'stale';
    const d = this.#decision();
    return d.kind === 'stop' ? d.why : null;
  }

  /**
   * Re-checks the stopped state before authoring; true when stopped. A change is derived here and
   * told to subscribers when the public call ends.
   */
  #recheck(): boolean {
    const s = this.#stoppedNow();
    if (s !== this.#stopped) this.#derive();
    return s !== null;
  }

  /** change, then normalize; null when either gives back the document it was given. */
  #run(change: (p: SimPolicy4) => SimPolicy4, prev: SimPolicy4): SimPolicy4 | null {
    let next = change(prev);
    if (next === prev) return null;
    if (this.#opts.normalize) next = this.#opts.normalize(next, prev);
    return next === prev ? null : next;
  }

  /**
   * Before a commit: false when stopped or when a needed move was refused (then `refusal` is the
   * move's). When the dataset decision is `move`, authors the move first (R55).
   */
  #prepare(): boolean {
    if (this.#recheck()) return false;
    if (this.#decision().kind !== 'move') return true;
    const caps = this.#opts.caps;
    const r = authorMove(this.#log, this.#align, {
      id: this.#mintId(),
      stamp: this.#opts.stamp(),
      ...(caps && { caps })
    });
    if (r.ok) {
      this.#bareMove = r.pending.draft.id;
      return true;
    }
    if (r.why === 'unchanged') return true;
    this.#refusal = r.why;
    if (r.why === 'invalid') console.error('[sim-store] move refused');
    return false;
  }

  /** Authors one commit; on a refusal sets `refusal` and drops a bare move. */
  #author(make: (meta: Meta) => Authored, label: string, source: string): Authored {
    const r = make(this.#meta(label, source));
    this.#settled(r);
    return r;
  }

  #settled(r: Authored): void {
    if (r.ok) {
      this.#bareMove = null;
      this.#refusal = null;
      if (this.#simId === null) {
        this.#simId = this.#mintId();
        this.#minted = true;
      }
      return;
    }
    this.#dropBareMove();
    this.#refusal = r.why === 'unchanged' ? null : r.why;
    if (r.why === 'invalid') console.error('[sim-store] edit refused');
  }

  /** A move with no commit behind it is not kept: dropped, unreported. */
  #dropBareMove(): void {
    const id = this.#bareMove;
    this.#bareMove = null;
    if (id !== null && this.#log.positionOf(id) !== null) this.#log.drop(id);
  }

  /**
   * Commits the open draft, if any (decision 8), and derives, so what is shown is the fold again
   * (a refused draft leaves nothing behind, F4). A draft that can no longer be authored (the
   * store is stopped, or the move it needs was refused) is reported through `refusal`, never
   * dropped silently. Subscribers are told by the caller.
   */
  #settleDraft(): 'none' | 'committed' | 'unchanged' | 'refused' {
    const d = this.#draft;
    if (d === null) return 'none';
    this.#draft = null;
    let out: 'committed' | 'unchanged' | 'refused';
    if (this.#prepare()) {
      const r = this.#author(
        (m) => authorEdit(this.#log, { name: this.#log.ruleset().name, policy: d.policy }, m),
        d.label,
        d.source
      );
      out = r.ok ? 'committed' : r.why === 'unchanged' ? 'unchanged' : 'refused';
    } else {
      this.#dropBareMove();
      if (this.#stoppedNow() !== null) this.#refusal = 'stopped';
      out = 'refused';
    }
    this.#derive();
    return out;
  }

  #restore(which: 'undo' | 'redo'): string | null {
    if (!this.#ready || !(which === 'undo' ? this.#canUndo : this.#canRedo)) return null;
    const draft = this.#draft;
    const settled = this.#settleDraft();
    // Undo over a draft that did not land stops there: one that changed nothing is undone by
    // itself (what shows is the fold again); a refused one answers null, with `refusal` set.
    if (draft !== null && settled === 'unchanged') return this.#done(draft.label);
    if (settled === 'refused') return this.#done(null);
    const target = this.#targets[which];
    // Off whenever the store would have to move or is stopped (decision 11).
    if (target === null || this.#recheck() || this.#decision().kind !== 'edit') {
      return this.#done(null);
    }
    const r = this.#author(
      (m) => authorRestore(this.#log, target.position, which, m, this.#align),
      target.label,
      SOURCES[which]
    );
    this.#changed();
    return r.ok ? target.label : null;
  }

  /**
   * The alignment step (decision 13): with pending commits and not stopped, when the decision is
   * `move` or the fold is on the page's dataset, a move or alignment commit. Reading never moves
   * a sim, so with nothing pending nothing is authored. Any refusal is left for the next re-apply.
   */
  #alignStep(): void {
    const log = this.#log;
    if (log.pending.length === 0 || this.#stoppedNow() !== null) return;
    const page = this.#opts.stamp().datasetVersion;
    const fold = log.ruleset();
    const d = this.#decision();
    if (d.kind !== 'move' && !(d.kind === 'edit' && fold.datasetVersion === page)) return;
    if (this.#draft !== null) {
      // An open draft was made on this fold: settle it first, when there is anything to align.
      const aligned = this.#align(fold, page);
      if (aligned === null || rulesetText(aligned) === rulesetText(fold)) return;
      this.#settleDraft();
      if (this.#stoppedNow() !== null) return;
    }
    const caps = this.#opts.caps;
    authorMove(log, this.#align, {
      id: this.#mintId(),
      stamp: this.#opts.stamp(),
      ...(caps && { caps })
    });
  }

  // ---- persistence internals ----
  // Bookkeeping, never shown (see the persistence fields).
  /* eslint-disable svelte/prefer-svelte-reactivity */

  /**
   * Replaces the log (a sim opened, or the current sim adopted) and what is known stored of it.
   * Drops are the caller's.
   */
  #replace(
    simId: string | null,
    confirmed: readonly Commit[],
    pending: readonly Pending[],
    records: readonly PendingRecord[],
    stored: boolean
  ): void {
    this.#gen++;
    this.#bareMove = null;
    this.#moveRefused = false;
    this.#log = this.#newLog(confirmed, pending);
    this.#simId = simId;
    this.#minted = false;
    this.#simStored = stored;
    this.#written = new Map(records.map((r) => [r.id, { n: r.n, p: r.pending }]));
    this.#unplaced = new Set();
    this.#confirmedSeq = confirmed.at(-1)?.seq ?? 0;
  }

  #canWrite(): boolean {
    return this.#opts.db !== null && this.#local !== 'failed' && this.#simId !== null;
  }

  /** Starts the write chain when it is idle and there is something to write. */
  #kick(): void {
    if (this.#looping || this.#writing !== null || !this.#canWrite()) return;
    if (this.#markerJob === null && this.#job(false) === null) return;
    this.#local = 'writing';
    this.#dirty = true;
    // The loop runs synchronously up to its first await, and can kick again before then (a
    // withdrawn import): the flag makes that a no-op. What it changed is the loop's next batch.
    this.#looping = true;
    const chain = this.#loop();
    // A chain that ended in its first pass, awaiting nothing, has cleared itself already (and may
    // have started the next one): only a chain still running is recorded.
    if (this.#looping && this.#writing === null) this.#writing = chain;
  }

  /**
   * The whole dirty state as one batch (decision 16), or null with nothing to write. The records
   * are the log's pending then held commits (a bare move aside), in the log's order: a record
   * already stored keeps its n while the stored order matches the log's, and from the first one
   * out of order on each goes to the end, so that reading the records back in n order gives the
   * log's order. A record stored before is put with its n (in place) or with `move` (to the end),
   * never plainly, so one another tab took or removed comes back lost and is never re-created.
   * Records stored and no longer held are removed.
   */
  #job(marker: boolean): Job | null {
    const log = this.#log;
    const desired = [...log.pending, ...log.held].filter((p) => p.draft.id !== this.#bareMove);
    const put: PendingPut[] = [];
    const versions = new Map<string, Pending>();
    let last = -Infinity;
    let inOrder = true;
    for (const p of desired) {
      const id = p.draft.id;
      const w = this.#written.get(id);
      if (inOrder && w !== undefined && w.n > last) {
        last = w.n;
        if (!sameVersion(w.p, p)) {
          put.push({ id, pending: p, n: w.n });
          versions.set(id, p);
        }
        continue;
      }
      inOrder = false;
      const stored = w !== undefined || this.#unplaced.has(id);
      put.push(stored ? { id, pending: p, move: true } : { id, pending: p });
      versions.set(id, p);
    }
    const live = new Set(desired.map((p) => p.draft.id));
    const remove = [...new Set([...this.#written.keys(), ...this.#unplaced])].filter(
      (id) => !live.has(id)
    );
    const confirmed = log.confirmed.slice(this.#confirmedSeq);
    if (!marker) {
      if (put.length === 0 && remove.length === 0 && confirmed.length === 0) return null;
      // A look records nothing (I6): a sim not stored is written only with a commit of its own.
      if (!this.#simStored && put.length === 0) return null;
    }
    const seq = confirmed.at(-1)?.seq ?? this.#confirmedSeq;
    return { batch: { owner: this.#opts.tabId, confirmed, put, remove }, versions, seq };
  }

  /**
   * The write chain: one write at a time, each the whole dirty state when it starts, so a burst
   * of changes during a write becomes one following batch. Ends when nothing is left to write
   * or a write fails (decision 17).
   */
  async #loop(): Promise<void> {
    const db = this.#opts.db!;
    let taken: MarkerJob | null = null;
    try {
      while (this.#canWrite()) {
        const gen = this.#gen;
        const simId = this.#simId!;
        const mj = this.#markerJob;
        if (
          mj !== null &&
          ![...this.#log.pending, ...this.#log.held].some((p) => p.draft.id === mj.id)
        ) {
          // Re-applying dropped the import before its write: no marker is written for content
          // the sim does not hold, so the next load can import again. Withdrawn.
          this.#markerJob = null;
          this.#withdraw(mj);
          continue;
        }
        const job = this.#job(mj !== null);
        if (job === null) break;
        this.#markerJob = null;
        taken = mj;
        const marker = mj === null ? {} : { marker: mj.marker };
        let r: WriteResult | CreateResult;
        if (this.#simStored) r = await db.write(simId, job.batch, marker);
        else {
          const sim = { simId, createdAt: this.#opts.now?.() ?? Date.now(), registered: false };
          const current = this.#minted && (this.#opts.current ?? true);
          const c = await db.createSim(sim, { current, ...marker, batch: job.batch });
          if (gen === this.#gen && c.outcome === 'current-taken') {
            // Another tab made the current sim first (decision 28): this tab's work goes there,
            // and an import with it, through that sim's write.
            if (c.current === null) throw new Error('current-taken without a current sim');
            this.#markerJob = mj;
            taken = null;
            await this.#adoptCurrent(c.current);
            continue;
          }
          if (gen === this.#gen && c.outcome === 'created') this.#simStored = true;
          r = c;
        }
        taken = null;
        if (gen !== this.#gen) {
          // The store moved to another sim meanwhile: this landed on the sim it was made for.
          mj?.resolve(r.applied ? 'imported' : 'marker');
          continue;
        }
        this.#landed(job, r, mj);
      }
    } catch (e) {
      this.#fail(e, taken);
    }
    this.#looping = false;
    this.#writing = null;
    if (this.#local === 'writing') this.#local = 'idle';
    this.#dirty = true;
    this.#flush();
  }

  /** Records what a write stored; a write refused for its marker withdraws the import. */
  #landed(job: Job, r: WriteResult, mj: MarkerJob | null): void {
    if (!r.applied) {
      // Nothing was written: the rest of the dirty state stays dirty for the next write.
      if (mj !== null) this.#withdraw(mj);
      return;
    }
    for (const [id, n] of Object.entries(r.n)) {
      this.#written.set(id, { n, p: job.versions.get(id)! });
      this.#unplaced.delete(id);
    }
    for (const id of job.batch.remove) {
      this.#written.delete(id);
      this.#unplaced.delete(id);
    }
    this.#confirmedSeq = Math.max(this.#confirmedSeq, job.seq);
    mj?.resolve('imported');
    if (r.lost.length > 0) this.#lose(r.lost);
    // A stored version may now be sent: its own change.
    else this.#changed();
  }

  /** Records another tab took (decision 16): forgotten, never sent. */
  #lose(ids: readonly string[]): void {
    // A draft was made on the fold with them: committed first.
    this.#settleDraft();
    for (const id of ids) {
      this.#written.delete(id);
      this.#unplaced.delete(id);
    }
    this.#addDrops(this.#log.forget(ids).drops);
    this.#alignStep();
    this.#changed();
  }

  /** An import whose marker was not what was expected: withdrawn, unreported (decision 30). */
  #withdraw(mj: MarkerJob): void {
    // A draft was made on the fold with it: committed first.
    this.#settleDraft();
    const log = this.#log;
    if (log.pending.some((p) => p.draft.id === mj.id)) {
      this.#addDrops(log.drop(mj.id).filter((d) => d.id !== mj.id));
    } else this.#addDrops(log.forget([mj.id]).drops);
    // The move it needed is not kept with nothing behind it: a withdrawn import moves nothing.
    if (mj.moveId !== null && log.pending.at(-1)?.draft.id === mj.moveId) log.drop(mj.moveId);
    // A sim minted for it and holding nothing is not made.
    const empty = log.tipSeq === 0 && log.pending.length === 0 && log.held.length === 0;
    if (mj.simBefore === null && !this.#simStored && empty) {
      this.#simId = null;
      this.#minted = false;
    }
    mj.resolve('marker');
    this.#changed();
  }

  /**
   * Takes the current sim another tab made (decision 28): its confirmed commits, with this tab's
   * pending commits re-applied on top, under its id.
   */
  async #adoptCurrent(simId: string): Promise<void> {
    const gen = this.#gen;
    const read = await this.#opts.db!.read(simId);
    if (gen !== this.#gen) return;
    // A draft is made on the fold it was opened on: committed first (decision 8).
    this.#settleDraft();
    const ours = [...this.#log.pending, ...this.#log.held];
    this.#replace(simId, read.confirmed, ours, [], true);
    this.#addDrops(this.#log.initialDrops);
    this.#alignStep();
    this.#changed();
  }

  /** A write failed: failed for the store's life, logged once, sent without storing. */
  #fail(e: unknown, taken: MarkerJob | null): void {
    if (this.#local !== 'failed') {
      this.#local = 'failed';
      console.error('[sim-store] write failed', errorName(e));
    }
    this.#dirty = true;
    const waiting = this.#markerJob;
    this.#markerJob = null;
    taken?.resolve('imported');
    waiting?.resolve('imported');
  }
  /* eslint-enable svelte/prefer-svelte-reactivity */

  #addDrops(drops: readonly DropReport[]): void {
    if (drops.length > 0) this.#drops = [...this.#drops, ...drops];
  }

  /**
   * Sets every derived value from the log (decision 32). The page shows the fold, keeping the
   * object it already shows when the fold equals it (decision 4); an open draft shows its own.
   */
  #derive(): void {
    const log = this.#log;
    if (this.#bareMove !== null && log.positionOf(this.#bareMove) === null) this.#bareMove = null;
    const fold = log.ruleset();
    const stopped = this.#stoppedNow();
    const draft = this.#draft;
    if (draft !== null) this.#policy = draft.policy;
    else {
      const shown = samePolicy(this.#policy, fold.policy) ? this.#policy : fold.policy;
      this.#policy = shown;
      this.#shownAt.set(shown, log.idAt(log.position));
    }
    const editable = stopped === null && this.#decision().kind === 'edit';
    const stamp = this.#opts.stamp();
    const target = (which: 'undo' | 'redo') =>
      editable && draft === null ? nextTarget(log, which, this.#align, stamp) : null;
    const undo = target('undo');
    const redo = target('redo');
    this.#targets = { undo, redo };
    this.#name = fold.name;
    this.#stopped = stopped;
    this.#canUndo = editable && (draft !== null || undo !== null);
    this.#undoLabel = editable ? (draft?.label ?? undo?.label ?? null) : null;
    this.#canRedo = redo !== null;
    this.#redoLabel = redo?.label ?? null;
    this.#drafting = draft !== null;
    this.#pending = log.pending;
    this.#serverDataset = this.#serverDs;
    this.#dirty = true;
  }

  /** Derives, then tells the subscribers: the last step of a public call that changed state. */
  #changed(): void {
    this.#derive();
    this.#flush();
  }

  /** Starts a write of what changed, then tells the subscribers if anything was derived. */
  #flush(): void {
    this.#kick();
    if (!this.#dirty) return;
    this.#dirty = false;
    for (const fn of this.#subscribers) fn();
  }

  /** Ends a public call that returns early: tells the subscribers if anything changed. */
  #done<T>(value: T): T {
    this.#flush();
    return value;
  }
}
