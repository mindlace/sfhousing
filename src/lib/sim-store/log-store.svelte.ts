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
import type { SimDb } from './sim-db';
import {
  MOVE_SOURCE,
  type Align,
  type DropReport,
  type Pending,
  type Stamp,
  type Stopped
} from './types';

/** What the page and the editors use of a schema 4 store (decision 29). */
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
  reset(p: SimPolicy4): void;
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
export type EditRefusal = 'invalid' | 'too-large' | 'queue-full';
export interface ImportMarker {
  key: string;
  value: unknown;
  expect: unknown;
}
export type ImportResult = 'imported' | 'unchanged' | 'marker' | 'stopped' | EditRefusal;

/** A coalesced run of edits, in memory only until it is settled into one commit (R1). */
interface Draft {
  key: string;
  label: string;
  source: string;
  policy: SimPolicy4;
}

const isMove = (d: CommitDraft): boolean => d.kind === 'system' && d.source === MOVE_SOURCE;

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
  /** A commit from a newer build was seen: stopped for the store's life. */
  #future = false;
  /** Each fold policy shown, to the id of the commit at the local tip then (null: position 0). */
  #shownAt = new WeakMap<SimPolicy4, string | null>();
  #targets: { undo: HistoryTarget | null; redo: HistoryTarget | null } = {
    undo: null,
    redo: null
  };
  #subscribers: (() => void)[] = [];

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
    if (!this.#ready || this.#recheck()) return false;
    const draft = this.#draft;
    if (coalesce !== undefined && draft !== null && draft.key === coalesce) {
      const next = this.#run(change, this.#policy);
      if (next === null) return false;
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
    const ok = this.#author(
      (m) => authorEdit(this.#log, { name: this.#log.ruleset().name, policy: next }, m),
      label,
      source
    );
    this.#changed();
    return ok && this.#policy !== shown;
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

  /** An undoable edit to p (source sim.reset, label 'Reset'). */
  reset(p: SimPolicy4): void {
    if (!this.#ready) return;
    this.#settleDraft();
    if (this.#prepare()) {
      this.#author(
        (m) => authorEdit(this.#log, { name: this.#log.ruleset().name, policy: p }, m),
        'Reset',
        SOURCES.reset
      );
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
  async open(simId: string | null, _opts?: { claim?: readonly string[] }): Promise<void> {
    // Without a database there is nothing to read: a known sim opens with an empty log.
    this.#draft = null;
    this.#bareMove = null;
    this.#moveRefused = false;
    this.#refusal = null;
    this.#log = this.#newLog();
    this.#simId = simId;
    this.#drops = [...this.#log.initialDrops];
    this.#ready = true;
    this.#alignStep();
    this.#changed();
  }

  /** Takes other tabs' pending commits of this sim and re-applies them after this tab's. */
  async claim(_owners: readonly string[]): Promise<number> {
    // Without a database no other tab's commits can be reached.
    this.settle();
    return 0;
  }

  /** One system commit (sim.import) to `content`, written with the marker (decision 30). */
  async importContent(
    content: RulesetContent,
    _marker: ImportMarker,
    label = 'Imported'
  ): Promise<ImportResult> {
    if (!this.#ready || this.#recheck()) return 'stopped';
    this.#settleDraft();
    if (!this.#prepare()) {
      this.#changed();
      // Not stopped: the move this import needed was refused, and `refusal` says why.
      return this.#stoppedNow() !== null ? 'stopped' : (this.#refusal ?? 'stopped');
    }
    const r = authorEdit(this.#log, content, this.#meta(label, SOURCES.import), 'system');
    this.#settled(r);
    this.#changed();
    return r.ok ? 'imported' : r.why;
  }

  // ---- the socket's side ----

  /** From the socket's hello. Re-applies and re-decides (the dataset rule). */
  setServerDataset(s: string): void {
    if (s !== this.#serverDs) this.#moveRefused = false;
    this.#serverDs = s;
    this.#addDrops(this.#log.setServerDataset(s).drops);
    this.#alignStep();
    this.#changed();
  }

  receive(commits: readonly Commit[]): Received {
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
    if (this.#serverDs === null || this.#stoppedNow() !== null) return null;
    const first = this.#log.pending[0];
    if (first === undefined || first.draft.id === this.#bareMove) return null;
    // Storage unavailable or failed (decision 17): sent at once. With a working database a
    // commit is sent only once stored, and nothing is stored here.
    if (this.#opts.db === null || this.#local === 'failed') return first.draft;
    return null;
  }

  /** Refused `invalid`: drop it, re-apply the rest, report it. */
  dropPending(id: string): void {
    const p = this.#log.pending.find((q) => q.draft.id === id);
    if (p === undefined) return;
    // The server refused a move: no other is authored until a commit lands or its dataset changes.
    if (isMove(p.draft)) this.#moveRefused = true;
    if (id === this.#bareMove) this.#bareMove = null;
    this.#addDrops(this.#log.drop(id));
    this.#alignStep();
    this.#changed();
  }

  /** Resolves when nothing is left to write (or writing has failed). */
  written(): Promise<void> {
    return Promise.resolve();
  }

  /** Called after every change of state, written or not. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.#subscribers = [...this.#subscribers, fn];
    return () => {
      this.#subscribers = this.#subscribers.filter((f) => f !== fn);
    };
  }

  // ---- internals ----

  #newLog(): LocalLog {
    const stamp = this.#opts.stamp();
    return new LocalLog({
      confirmed: [],
      pending: [],
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
    if (this.#log.future) this.#future = true;
    if (this.#future) return 'future';
    // Anything held: a push would land behind it, out of view.
    if (this.#log.held.length > 0) return this.#serverDs === null ? 'unknown-dataset' : 'stale';
    if (this.#moveRefused) return 'stale';
    const d = this.#decision();
    return d.kind === 'stop' ? d.why : null;
  }

  /** Re-checks the stopped state before authoring; true when stopped. */
  #recheck(): boolean {
    const s = this.#stoppedNow();
    if (s !== this.#stopped) this.#changed();
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
  #author(make: (meta: Meta) => Authored, label: string, source: string): boolean {
    const r = make(this.#meta(label, source));
    this.#settled(r);
    return r.ok;
  }

  #settled(r: Authored): void {
    if (r.ok) {
      this.#bareMove = null;
      this.#refusal = null;
      if (this.#simId === null) this.#simId = this.#mintId();
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
   * (a refused draft leaves nothing behind, F4). Subscribers are told by the caller.
   */
  #settleDraft(): void {
    const d = this.#draft;
    if (d === null) return;
    this.#draft = null;
    if (this.#prepare()) {
      this.#author(
        (m) => authorEdit(this.#log, { name: this.#log.ruleset().name, policy: d.policy }, m),
        d.label,
        d.source
      );
    } else this.#dropBareMove();
    this.#derive();
  }

  #restore(which: 'undo' | 'redo'): string | null {
    if (!this.#ready || !(which === 'undo' ? this.#canUndo : this.#canRedo)) return null;
    this.#settleDraft();
    const target = this.#targets[which];
    // Off whenever the store would have to move or is stopped (decision 11).
    if (target === null || this.#recheck() || this.#decision().kind !== 'edit') {
      this.#changed();
      return null;
    }
    const ok = this.#author(
      (m) => authorRestore(this.#log, target.position, which, m, this.#align),
      target.label,
      SOURCES[which]
    );
    this.#changed();
    return ok ? target.label : null;
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
    const undo = editable && draft === null ? nextTarget(log, 'undo') : null;
    const redo = editable && draft === null ? nextTarget(log, 'redo') : null;
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
  }

  /** Derives, then tells the subscribers. */
  #changed(): void {
    this.#derive();
    for (const fn of this.#subscribers) fn();
  }
}
