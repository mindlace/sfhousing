import {
  LogError,
  LogState,
  NAME_KEY,
  REGISTRY,
  SHAPES_REVISION,
  chainHash,
  type Commit,
  type CommitDraft,
  type Registry,
  type Ruleset
} from '$lib/sim-log';
import { commitsFrame, type RefusedWhy } from '$lib/sim-stream/protocol';
import { decideAppend } from './decide';
import type { IndexSummary, IndexedCommit } from './index-sync';
import { LIMITS, RateBucket, utf8Bytes, type Limits } from './limits';
import type { SimStore, StoredRow, Totals } from './store';

/** Rows read from the store at a time, by a fold and by a resume. */
const PAGE = 500;

export interface Author {
  identity: string | null;
  write: boolean;
}

export type AppendOutcome =
  | { kind: 'accepted'; commit: Commit; body: string }
  | { kind: 'duplicate'; id: string }
  | { kind: 'refused'; id: string | null; why: RefusedWhy };

export interface StartParams {
  id: string;
  title: string;
  actor: string;
  datasetVersion: string;
  build: string;
  now: number;
}

/** What the start commit is made of, beside its author and time. */
export interface StartDraft {
  id: string;
  title: string;
  datasetVersion: string;
  build: string;
}

export interface ServerAppend {
  /** The identity the Worker resolved and found to be a writer. */
  actor: string;
  /** Everything but parent and datasetVersion, which come from the tip. */
  draft: Omit<CommitDraft, 'parent' | 'datasetVersion'>;
  /** Used only when the log is empty, to record the start commit first (R58). */
  start: StartDraft;
  now: number;
}

export interface LogHostOptions {
  limits?: Limits;
  registry?: Registry;
  /** Called with no await after the row is stored, inside the serialized section (I4, I7). */
  onCommit?: (body: string, commit: Commit) => void;
  /** Names the sim in the host's log lines (the sim id). */
  label?: string;
}

/**
 * The one path through which a sim's commits are accepted, and the readers around it. Every
 * public async method runs in turn on one promise chain, so an append, a resume and a takedown
 * never interleave.
 */
export class LogHost {
  readonly #store: SimStore;
  readonly #limits: Limits;
  readonly #registry: Registry;
  readonly #onCommit: ((body: string, commit: Commit) => void) | undefined;
  readonly #label: string;
  #cached: Totals | null = null;
  #held: LogState | null = null;
  #rate: RateBucket | null = null;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(store: SimStore, opts: LogHostOptions = {}) {
    this.#store = store;
    this.#limits = opts.limits ?? LIMITS;
    this.#registry = opts.registry ?? REGISTRY;
    this.#onCommit = opts.onCommit;
    this.#label = opts.label ?? '-';
  }

  tip(): number {
    return this.#totals().seq;
  }

  gone(): boolean {
    return this.#store.goneAt() !== null;
  }

  append(
    commit: unknown,
    id: string | null,
    frameBytes: number,
    author: Author,
    now: number
  ): Promise<AppendOutcome> {
    return this.#serial(() => this.#appendNow(commit, id, frameBytes, author, now));
  }

  /** R58: null when the log has commits or the sim is gone. */
  ensureStarted(p: StartParams): Promise<AppendOutcome | null> {
    return this.#serial(async () => {
      if (this.gone() || this.tip() > 0) return null;
      return this.#appendStart(p, p.actor, p.now);
    });
  }

  /**
   * A commit the Worker appends on a writer's behalf, through the same checks as a socket's.
   * Its parent and dataset version are the tip's, read in turn; on an empty log the start commit
   * (R58) is stored first, in the same turn. A refusal names the draft's id.
   */
  appendAs(input: ServerAppend): Promise<AppendOutcome> {
    return this.#serial(async () => {
      const { actor, draft, start, now } = input;
      if (this.gone()) return { kind: 'refused', id: draft.id, why: 'gone' };
      if (this.tip() === 0) {
        const started = await this.#appendStart(start, actor, now);
        if (started.kind === 'refused') return { ...started, id: draft.id };
      }
      let datasetVersion: string | null;
      try {
        datasetVersion = this.#state().ruleset().datasetVersion;
      } catch (e) {
        // As in #appendNow: a stored row a newer build wrote.
        if (e instanceof LogError && e.code === 'future-shapes') {
          return { kind: 'refused', id: draft.id, why: 'newer' };
        }
        throw e;
      }
      const full: CommitDraft = {
        ...draft,
        parent: this.tip(),
        datasetVersion: datasetVersion ?? start.datasetVersion
      };
      return this.#appendNow(
        full,
        full.id,
        utf8Bytes(JSON.stringify(full)),
        { identity: actor, write: true },
        now
      );
    });
  }

  /**
   * Calls `deliver` inside the serialized section with commits frames, once per page of rows, or
   * once with null when gone or after > tip. Nothing after the position gives one empty frame.
   */
  resume(after: number, deliver: (frames: string[] | null) => void): Promise<void> {
    return this.#serial(() => {
      if (this.gone() || after > this.tip()) {
        deliver(null);
        return;
      }
      let from = after;
      let any = false;
      for (;;) {
        const rows = this.#store.rowsAfter(from, PAGE);
        if (rows.length === 0) break;
        any = true;
        deliver(this.#frames(rows));
        from = rows[rows.length - 1].seq;
        if (rows.length < PAGE) break;
      }
      if (!any) deliver([commitsFrame([])]);
    });
  }

  /** The held state's ruleset, folding the rows first if none is held. Read-only. */
  ruleset(): Ruleset {
    return this.#state().ruleset();
  }

  summary(): IndexSummary {
    const positions = this.tip();
    const tipRow = positions > 0 ? this.#store.rowsAfter(positions - 1, 1)[0] : undefined;
    const r = this.ruleset();
    return {
      positions,
      lastChangeAt: tipRow ? (JSON.parse(tipRow.body) as Commit).at : 0,
      datasetVersion: r.datasetVersion,
      title: r.name
    };
  }

  unindexed(limit: number): IndexedCommit[] {
    return this.#store
      .rowsAfter(this.#store.indexedSeq(), limit)
      .map((r) => ({ commit: JSON.parse(r.body) as Commit, bytes: r.bytes }));
  }

  /** Moves the watermark forward only, and never past the tip (after a takedown, never). */
  markIndexed(seq: number): void {
    const next = Math.min(seq, this.#store.tipSeq());
    if (next > this.#store.indexedSeq()) this.#store.setIndexedSeq(next);
  }

  indexBehind(): boolean {
    return !this.gone() && this.#store.indexedSeq() < this.tip();
  }

  takeDown(now: number): Promise<void> {
    return this.#serial(() => {
      this.#store.clear(now);
      this.#held = null;
      this.#cached = null;
    });
  }

  #serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.#chain.then(fn);
    this.#chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  #totals(): Totals {
    return (this.#cached ??= this.#store.totals());
  }

  #bucket(now: number): RateBucket {
    return (this.#rate ??= new RateBucket(this.#limits.burst, this.#limits.perSecond, now));
  }

  /** The held state, or the fold of the stored rows (I3). */
  #state(): LogState {
    if (this.#held) return this.#held;
    const state = LogState.empty(this.#registry);
    let from = 0;
    for (;;) {
      const rows = this.#store.rowsAfter(from, PAGE);
      for (const r of rows) state.apply(JSON.parse(r.body) as Commit);
      if (rows.length < PAGE) break;
      from = rows[rows.length - 1].seq;
    }
    return (this.#held = state);
  }

  /** Commits frames of stored bodies, each within sendBytes or holding a single commit. */
  #frames(rows: readonly StoredRow[]): string[] {
    const frames: string[] = [];
    let bodies: string[] = [];
    let size = 0;
    for (const r of rows) {
      if (bodies.length > 0 && size + r.bytes > this.#limits.sendBytes) {
        frames.push(commitsFrame(bodies));
        bodies = [];
        size = 0;
      }
      bodies.push(r.body);
      size += r.bytes;
    }
    if (bodies.length > 0) frames.push(commitsFrame(bodies));
    return frames;
  }

  /** The start commit (R58), appended in the caller's turn; a refusal is logged by reason only. */
  async #appendStart(s: StartDraft, actor: string, now: number): Promise<AppendOutcome> {
    const draft: CommitDraft = {
      id: s.id,
      parent: 0,
      kind: 'system',
      label: 'Start',
      restores: null,
      datasetVersion: s.datasetVersion,
      shapes: SHAPES_REVISION,
      build: s.build,
      source: 'sim.start',
      changes: [{ op: 'set', key: NAME_KEY, field: 'name', value: s.title }]
    };
    const out = await this.#appendNow(
      draft,
      draft.id,
      utf8Bytes(JSON.stringify(draft)),
      { identity: actor, write: true },
      now
    );
    if (out.kind === 'refused') {
      console.error(`[sim-object] ${this.#label}: start commit refused (${out.why})`);
    }
    return out;
  }

  async #appendNow(
    raw: unknown,
    id: string | null,
    frameBytes: number,
    author: Author,
    now: number
  ): Promise<AppendOutcome> {
    const totals = this.#totals();
    const d = decideAppend(
      {
        gone: this.gone(),
        write: author.write,
        identity: author.identity,
        takeToken: () => this.#bucket(now).take(now),
        tip: totals.seq,
        bytes: totals.bytes,
        hasId: (x) => this.#store.hasId(x)
      },
      raw,
      id,
      frameBytes,
      this.#limits
    );
    if (d.kind !== 'accept') return d;
    const stamped = { ...d.draft, seq: totals.seq + 1, actor: author.identity as string, at: now };
    // The only await: the chain keeps any other call out until this append returns.
    const hash = await chainHash(totals.hash, stamped);
    const commit: Commit = { ...stamped, hash };
    const body = JSON.stringify(commit);
    const bytes = utf8Bytes(body);
    if (bytes > this.#limits.commitBytes) return { kind: 'refused', id: commit.id, why: 'limit' };
    let state: LogState;
    try {
      state = this.#state();
    } catch (e) {
      // A stored row this build cannot fold: one a newer build wrote (only a newer server can take
      // this commit, so the browser keeps it pending), or anything else (an internal error).
      if (e instanceof LogError && e.code === 'future-shapes') {
        return { kind: 'refused', id: commit.id, why: 'newer' };
      }
      throw e;
    }
    try {
      state.apply(commit, { check: true });
    } catch (e) {
      if (e instanceof LogError) {
        const why = e.code === 'future-shapes' ? 'newer' : 'invalid';
        return { kind: 'refused', id: commit.id, why };
      }
      throw e;
    }
    try {
      this.#store.insert({ seq: commit.seq, id: commit.id, hash, bytes, body });
    } catch (e) {
      // I3: the state holds a commit that was not stored; refold from the rows next time.
      this.#held = null;
      this.#cached = null;
      throw e;
    }
    this.#cached = { seq: commit.seq, hash, bytes: totals.bytes + bytes };
    this.#onCommit?.(body, commit);
    return { kind: 'accepted', commit, body };
  }
}
