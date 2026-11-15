import {
  LogError,
  LogFormatError,
  LogState,
  REGISTRY,
  diff,
  parseCommitDraft,
  reapply,
  rulesetText,
  type Change,
  type Commit,
  type CommitDraft,
  type Dropped,
  type Registry,
  type Ruleset,
  type RulesetContent
} from '$lib/sim-log';
import { canonicalJson } from '$lib/sim-page/policy';
import { LIMITS, fitsCommit, utf8Bytes, type Limits } from '$lib/sim-stream/limits';
import { newId } from '$lib/ids/base58';
import { History, type LabelledEntry } from './history';
import {
  MOVE_LABEL,
  MOVE_SOURCE,
  type Align,
  type DropReport,
  type DropWhy,
  type Pending
} from './types';

/** Confirmed positions are folded from a clone of the tip at every multiple of the spacing. */
export const CHECKPOINT_SPACING = 256;
/** Past this many confirmed checkpoints the spacing doubles (decision 18). */
export const CHECKPOINTS_MAX = 64;
/** Pending positions are folded from a clone of the work state every this many pending commits. */
export const PENDING_CHECKPOINT = 32;

export interface LocalLogInit {
  /** seq 1..n in order; RangeError otherwise. */
  confirmed: readonly Commit[];
  /** In order; re-applied on construction. */
  pending: readonly Pending[];
  registry?: Registry;
  /** Aligns restores and moves (decisions 12, 13). Default: (c) => c. */
  align?: Align;
  /** The server's dataset, or null while unknown (I11). */
  serverDataset?: string | null;
  /**
   * This page's build, stamped with the registry's revision on a restore or move recomputed
   * through `diff`. Default: the draft keeps its own build.
   */
  build?: string;
  /**
   * The page's dataset. While the server's dataset equals it and the confirmed tip is on
   * another, re-applying puts a move to it first (the page is current). Default null: never.
   */
  page?: string | null;
  /** Tests only; default LIMITS (the fitsCommit check on re-applied drafts). */
  limits?: Limits;
}

export type Received =
  | { kind: 'applied'; changed: boolean; drops: DropReport[] }
  /** Every commit was already held. */
  | { kind: 'stale' }
  /** Resume from `after`. */
  | { kind: 'gap'; after: number; changed: boolean; drops: DropReport[] }
  /** Nothing applied from the newer build's commit on. */
  | { kind: 'future'; changed: boolean; drops: DropReport[] };

export interface Reapplied {
  changed: boolean;
  drops: DropReport[];
}

export interface Adopted extends Reapplied {
  /** Adopted ids discarded because they are already confirmed: the store deletes the records. */
  confirmed: string[];
}

interface Checkpoint {
  position: number;
  state: LogState;
}

/** One pending commit re-worked on the work state, before its checks. */
type Outcome =
  | { keep: CommitDraft; dropped: Dropped[] }
  | { drop: DropWhy; dropped: Dropped[] }
  /** Moved to held with what follows: a newer build's commit (future), or align can't reach. */
  | { hold: 'future' | 'unaligned' }
  /** A move or alignment commit with nothing left to do: dropped, never reported. */
  | { silent: true };

const isMove = (d: CommitDraft): boolean => d.kind === 'system' && d.source === MOVE_SOURCE;

const entryOf = (d: CommitDraft, seq: number): LabelledEntry => ({
  seq,
  kind: d.kind,
  restores: d.restores,
  label: d.label
});

const bytesOf = (d: CommitDraft): number => utf8Bytes(JSON.stringify(d));

/** The draft fields of a commit or draft, for comparing a commit with the draft it came from. */
const draftText = (d: CommitDraft): string =>
  canonicalJson({
    id: d.id,
    parent: d.parent,
    kind: d.kind,
    label: d.label,
    restores: d.restores,
    datasetVersion: d.datasetVersion,
    shapes: d.shapes,
    build: d.build,
    source: d.source,
    changes: d.changes
  });

/** diff, or null when either side has an empty brush or two items with one key. */
function diffOrNull(a: RulesetContent, b: RulesetContent): Change[] | null {
  try {
    return diff(a, b);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/**
 * The ruleset at pending position `q`: the checkpoint at or below it (else the tip, at `tipSeq`)
 * with the pending drafts up to `q` applied.
 */
function foldPending(
  q: number,
  tipSeq: number,
  tip: LogState,
  drafts: readonly CommitDraft[],
  checkpoints: readonly Checkpoint[]
): Ruleset {
  let from: Checkpoint = { position: tipSeq, state: tip };
  for (const c of checkpoints) if (c.position <= q) from = c;
  const s = from.state.clone();
  for (let pos = from.position + 1; pos <= q; pos++) s.apply(drafts[pos - tipSeq - 1]);
  return s.ruleset();
}

/**
 * A sim's confirmed commits and this tab's pending ones (decision 3). Pure: no I/O, no runes.
 * Every change re-applies the pending commits on the confirmed tip (decision 5), stamping each
 * with the dataset the fold is on (I11), so after every public call: pending[i].draft.parent is
 * tipSeq + i, each pending restore names its target's current position, and every pending draft
 * parses, fits and folds with check on the tip (I3, I7).
 */
export class LocalLog {
  readonly initialDrops: DropReport[];
  /** Pending ids the constructor removed as already confirmed (the store deletes them, I5). */
  readonly initialConfirmed: string[];

  readonly #reg: Registry;
  readonly #align: Align;
  readonly #limits: Limits;
  readonly #build: string | null;
  readonly #page: string | null;
  #serverDataset: string | null;

  #confirmed: Commit[] = [];
  /** Confirmed id to seq. */
  #seqOf = new Map<string, number>();
  #tip: LogState;
  #tipDataset: string | null = null;
  #checkpoints = new Map<number, LogState>();
  #spacing = CHECKPOINT_SPACING;
  #confirmedHistory = new History();

  #pending: Pending[] = [];
  /** Pending id to its index in #pending. */
  #indexOf = new Map<string, number>();
  /** Held after a commit from a newer build (I9): until a reload on a newer build. */
  #heldFuture: Pending[] = [];
  /** Held after a restore or move `align` could not reach: retried once the page is current. */
  #heldDataset: Pending[] = [];
  /** The order the commits were first seen in (loaded, pushed, adopted), by id. */
  #order = new Map<string, number>();
  #nextOrder = 0;
  /** Moves this log authors go before everything it holds. */
  #firstOrder = 0;
  #local: LogState;
  #pendingCheckpoints: Checkpoint[] = [];
  #history: History;
  #bytes = 0;
  #future = false;

  constructor(init: LocalLogInit) {
    this.#reg = init.registry ?? REGISTRY;
    this.#align = init.align ?? ((c) => c);
    this.#limits = init.limits ?? LIMITS;
    this.#build = init.build ?? null;
    this.#page = init.page ?? null;
    this.#serverDataset = init.serverDataset ?? null;
    init.confirmed.forEach((c, i) => {
      if (c.seq !== i + 1) throw new RangeError(`confirmed[${i}] has seq ${c.seq}, not ${i + 1}`);
    });
    this.#tip = LogState.empty(this.#reg);
    for (const c of init.confirmed) if (!this.#confirm(c)) break;
    this.#local = this.#tip.clone();
    this.#history = this.#confirmedHistory.clone();
    // Every id the server holds, including any past a newer build's commit this build stops at.
    const stored = new Set(init.confirmed.map((c) => c.id));
    this.initialConfirmed = init.pending
      .filter((p) => stored.has(p.draft.id))
      .map((p) => p.draft.id);
    for (const p of init.pending) this.#see(p);
    this.initialDrops = this.#reapply(init.pending.filter((p) => !stored.has(p.draft.id)));
  }

  get tipSeq(): number {
    return this.#confirmed.length;
  }

  get confirmed(): readonly Commit[] {
    return this.#confirmed;
  }

  /** Pending commits in force: re-applied, shown, sendable. */
  get pending(): readonly Pending[] {
    return this.#pending;
  }

  /**
   * Pending commits held back untouched, in order: after one under a newer shape revision (I9),
   * or after a restore or move `align` could not reach (retried once the page is current).
   */
  get held(): readonly Pending[] {
    return this.#inOrder([...this.#heldDataset, ...this.#heldFuture]);
  }

  /** UTF-8 bytes of the pending drafts' JSON. */
  get pendingBytes(): number {
    return this.#bytes;
  }

  /** tipSeq + pending.length. */
  get position(): number {
    return this.tipSeq + this.#pending.length;
  }

  /** A confirmed or pending commit is under a newer shape revision. Permanent. */
  get future(): boolean {
    return this.#future;
  }

  get serverDataset(): string | null {
    return this.#serverDataset;
  }

  /**
   * Sets it and re-applies when a pending move's target differs from a known value, or when the
   * page is known current with commits held for the dataset, or with pending commits on a tip
   * on another dataset (ruling (b)). With neither, nothing moves: reading never moves a sim.
   */
  setServerDataset(s: string | null): Reapplied {
    this.#serverDataset = s;
    const moveOff =
      s !== null && this.#pending.some((p) => isMove(p.draft) && p.draft.datasetVersion !== s);
    const follow =
      (this.#pageCurrent() && this.#heldDataset.length > 0) ||
      (this.#moveFirst() && this.#pending.length > 0);
    if (!moveOff && !follow) return { changed: false, drops: [] };
    return this.#rewalk(this.#pending);
  }

  /** The fold of confirmed then pending; the same object until the next change. */
  ruleset(): Ruleset {
    return this.#local.ruleset();
  }

  /** 0 to position. RangeError outside. */
  rulesetAt(position: number): Ruleset {
    this.#inRange(position);
    if (position === this.position) return this.ruleset();
    if (position <= this.tipSeq) return this.#confirmedAt(position);
    return foldPending(
      position,
      this.tipSeq,
      this.#tip,
      this.#pending.map((p) => p.draft),
      this.#pendingCheckpoints
    );
  }

  /** The commit id at 1 to position, null for 0. RangeError outside 0 to position. */
  idAt(position: number): string | null {
    this.#inRange(position);
    if (position === 0) return null;
    if (position <= this.tipSeq) return this.#confirmed[position - 1].id;
    return this.#pending[position - this.tipSeq - 1].draft.id;
  }

  /** The position of a confirmed or in-force pending commit, 0 for null, null for an unknown id. */
  positionOf(id: string | null): number | null {
    if (id === null) return 0;
    const seq = this.#seqOf.get(id);
    if (seq !== undefined) return seq;
    const i = this.#indexOf.get(id);
    return i === undefined ? null : this.tipSeq + i + 1;
  }

  /** History over confirmed then pending (read-only: do not push). */
  history(): History {
    return this.#history;
  }

  /** RangeError unless p.draft.parent === position; LogError when it does not fold (check). */
  push(p: Pending): void {
    const position = this.position;
    if (p.draft.parent !== position)
      throw new RangeError(`parent ${p.draft.parent} is not the position ${position}`);
    const last = this.#pendingCheckpoints.at(-1)?.position ?? this.tipSeq;
    const checkpoint = position - last >= PENDING_CHECKPOINT ? this.#local.clone() : null;
    this.#local.apply(p.draft, { check: true });
    if (checkpoint) this.#pendingCheckpoints.push({ position, state: checkpoint });
    this.#indexOf.set(p.draft.id, this.#pending.length);
    this.#pending = [...this.#pending, p];
    this.#history.push(entryOf(p.draft, position + 1));
    this.#bytes += bytesOf(p.draft);
    this.#see(p);
  }

  receive(commits: readonly Commit[]): Received {
    const before = this.ruleset();
    let kind: 'applied' | 'gap' | 'future' = 'applied';
    let fresh = false;
    let failure: { error: unknown } | null = null;
    const applied: Commit[] = [];
    for (const c of commits) {
      if (c.seq <= this.tipSeq) continue;
      fresh = true;
      if (c.seq !== this.tipSeq + 1) {
        kind = 'gap';
        break;
      }
      try {
        if (!this.#confirm(c)) {
          kind = 'future';
          break;
        }
      } catch (error) {
        // A stored commit this build cannot fold is a bug, not a state: keep the invariants for
        // the prefix, then rethrow.
        failure = { error };
        break;
      }
      applied.push(c);
    }
    if (!fresh) return { kind: 'stale' };
    let drops: DropReport[] = [];
    if (applied.length > 0) {
      if (this.#echoes(applied)) this.#popEchoes(applied.length);
      else drops = this.#reapply(this.#pending);
    }
    if (failure) throw failure.error;
    const changed = this.#changedSince(before);
    if (kind === 'gap') return { kind, after: this.tipSeq, changed, drops };
    return { kind, changed, drops };
  }

  /** Removes a pending commit (refused invalid) and re-applies those after it; reported. */
  drop(id: string): DropReport[] {
    const i = this.#indexOf.get(id);
    if (i === undefined) return [];
    const d = this.#pending[i].draft;
    const own: DropReport[] = isMove(d)
      ? []
      : [{ id, label: d.label, whole: true, why: 'invalid', dropped: [] }];
    return [...own, ...this.#reapply(this.#pending.filter((_, j) => j !== i))];
  }

  /** Removes pending commits another tab took, unreported, and re-applies the rest. */
  forget(ids: readonly string[]): Reapplied {
    const gone = new Set(ids);
    this.#heldFuture = this.#heldFuture.filter((p) => !gone.has(p.draft.id));
    this.#heldDataset = this.#heldDataset.filter((p) => !gone.has(p.draft.id));
    const rest = this.#pending.filter((p) => !gone.has(p.draft.id));
    if (rest.length === this.#pending.length) return { changed: false, drops: [] };
    return this.#rewalk(rest);
  }

  /**
   * Appends pending commits claimed from other tabs after this tab's own, re-applied. Those whose
   * ids are already confirmed are discarded and named in `confirmed` (the store deletes them).
   */
  adopt(pending: readonly Pending[]): Adopted {
    const known = new Set([...this.#indexOf.keys(), ...this.held.map((p) => p.draft.id)]);
    const confirmed = pending.filter((p) => this.#seqOf.has(p.draft.id)).map((p) => p.draft.id);
    const fresh = pending.filter((p) => !known.has(p.draft.id) && !this.#seqOf.has(p.draft.id));
    if (fresh.length === 0) return { changed: false, drops: [], confirmed };
    for (const p of fresh) this.#see(p);
    // After a held commit everything is held, in order (I9), unless the page is current and
    // the commits held for the dataset are about to be retried with them.
    if (this.#heldFuture.length > 0) {
      this.#heldFuture = [...this.#heldFuture, ...fresh];
      return { changed: false, drops: [], confirmed };
    }
    if (this.#heldDataset.length > 0 && !this.#pageCurrent()) {
      this.#heldDataset = [...this.#heldDataset, ...fresh];
      return { changed: false, drops: [], confirmed };
    }
    return { ...this.#rewalk([...this.#pending, ...fresh]), confirmed };
  }

  // ---- internals ----

  /** Records the order a commit was first seen in. */
  #see(p: Pending): void {
    if (!this.#order.has(p.draft.id)) this.#order.set(p.draft.id, this.#nextOrder++);
  }

  #inOrder(list: readonly Pending[]): Pending[] {
    const at = (p: Pending) => this.#order.get(p.draft.id) ?? Infinity;
    return [...list].sort((a, b) => at(a) - at(b));
  }

  /**
   * The page is known current (the server's dataset is the page's): commits held for the
   * dataset are retried on every re-apply (ruling (b)).
   */
  #pageCurrent(): boolean {
    return this.#page !== null && this.#serverDataset === this.#page && !this.#future;
  }

  /** The page is current and the confirmed tip is on another dataset: a move goes first. */
  #moveFirst(): boolean {
    return this.#pageCurrent() && this.#tipDataset !== null && this.#tipDataset !== this.#page;
  }

  #inRange(position: number): void {
    if (!Number.isInteger(position) || position < 0 || position > this.position)
      throw new RangeError(`position ${position} is outside 0 to ${this.position}`);
  }

  #changedSince(before: Ruleset): boolean {
    const now = this.ruleset();
    return now !== before && rulesetText(now) !== rulesetText(before);
  }

  #rewalk(list: readonly Pending[]): Reapplied {
    const before = this.ruleset();
    const drops = this.#reapply(list);
    return { changed: this.#changedSince(before), drops };
  }

  /**
   * Applies one confirmed commit to the tip, without check. False, with `future` set, for a
   * commit under a newer shape revision; any other error is a bug and is thrown.
   */
  #confirm(c: Commit): boolean {
    if (c.shapes > this.#reg.current) {
      this.#future = true;
      return false;
    }
    try {
      this.#tip.apply(c);
    } catch (e) {
      if (e instanceof LogError && e.code === 'future-shapes') {
        this.#future = true;
        return false;
      }
      throw e;
    }
    this.#confirmed.push(c);
    this.#seqOf.set(c.id, c.seq);
    this.#tipDataset = c.datasetVersion;
    this.#confirmedHistory.push(entryOf(c, c.seq));
    if (c.seq % this.#spacing === 0) {
      this.#checkpoints.set(c.seq, this.#tip.clone());
      if (this.#checkpoints.size > CHECKPOINTS_MAX) {
        this.#spacing *= 2;
        for (const k of this.#checkpoints.keys())
          if (k % this.#spacing !== 0) this.#checkpoints.delete(k);
      }
    }
    return true;
  }

  /** The ruleset at confirmed position `k`, from the checkpoint at or below it. */
  #confirmedAt(k: number): Ruleset {
    if (k === this.tipSeq) return this.#tip.ruleset();
    const c = Math.floor(k / this.#spacing) * this.#spacing;
    const s = c === 0 ? LogState.empty(this.#reg) : this.#checkpoints.get(c)!.clone();
    for (let seq = c + 1; seq <= k; seq++) s.apply(this.#confirmed[seq - 1]);
    return s.ruleset();
  }

  /** Decision 7: the new commits are the head pending ones, as they were sent. */
  #echoes(applied: readonly Commit[]): boolean {
    if (applied.length > this.#pending.length) return false;
    return applied.every((c, i) => draftText(c) === draftText(this.#pending[i].draft));
  }

  /** Takes the first `m` pending as confirmed: the fold, the local state and history stand. */
  #popEchoes(m: number): void {
    for (const p of this.#pending.slice(0, m)) this.#bytes -= bytesOf(p.draft);
    this.#pending = this.#pending.slice(m);
    this.#indexOf = new Map(this.#pending.map((p, i) => [p.draft.id, i]));
    const tipSeq = this.tipSeq;
    this.#pendingCheckpoints = this.#pendingCheckpoints.filter((c) => c.position > tipSeq);
  }

  /**
   * Re-applies `list` on the tip in order (R18, R19, I3, I7, I11) and replaces the pending
   * commits, the local state, the pending checkpoints and the history with the result. Pending
   * whose ids are confirmed are removed first; a commit under a newer shape revision, or a
   * restore or move that `align` cannot reach, moves with every one after it to `held`. While
   * the page is current (#pageCurrent), the commits held for the dataset are retried in their
   * order, and a move to the page's dataset goes first (ruling (b)).
   */
  #reapply(list: readonly Pending[]): DropReport[] {
    const tipSeq = this.tipSeq;
    const unconfirmed = (p: Pending) => !this.#seqOf.has(p.draft.id);
    let live = list.filter(unconfirmed);
    // A held commit the server already has (sent by an earlier page) is no longer held.
    this.#heldFuture = this.#heldFuture.filter(unconfirmed);
    this.#heldDataset = this.#heldDataset.filter(unconfirmed);
    const work = this.#tip.clone();
    const history = this.#confirmedHistory.clone();
    const kept: Pending[] = [];
    const keptAt = new Map<string, number>();
    const checkpoints: Checkpoint[] = [];
    const drops: DropReport[] = [];
    let fold = this.#tipDataset;
    let bytes = 0;
    let lastCheckpoint = tipSeq;
    const keep = (p: Pending, draft: CommitDraft, parent: number) => {
      fold = draft.datasetVersion;
      kept.push(draft === p.draft ? p : { draft, targetId: p.targetId });
      keptAt.set(draft.id, parent + 1);
      history.push(entryOf(draft, parent + 1));
      bytes += bytesOf(draft);
    };
    if (this.#pageCurrent()) {
      const order = (p: Pending) => this.#order.get(p.draft.id) ?? Infinity;
      const firstFuture = Math.min(Infinity, ...this.#heldFuture.map(order));
      // Nothing after a newer build's commit leaves held (I9).
      const retried = this.#heldDataset.filter((p) => order(p) < firstFuture);
      // Retried in their order; one that still cannot be aligned is held again, untouched.
      this.#heldDataset = this.#heldDataset.filter((p) => !retried.includes(p));
      live = this.#inOrder([...live, ...retried]);
      const lead =
        live.length > 0 && this.#moveFirst() ? this.#leadMove(live[0], work, tipSeq) : null;
      if (lead) {
        const merged = live;
        live = lead.head ? merged.slice(1) : merged;
        if (lead.draft) {
          const first = merged[0];
          const p = lead.head ? first : { draft: lead.draft, targetId: null };
          if (!lead.head) this.#order.set(lead.draft.id, --this.#firstOrder);
          const unchanged = lead.head && draftText(lead.draft) === draftText(first.draft);
          keep(p, unchanged ? first.draft : lead.draft, tipSeq);
        }
        // With no move to make, the first commit re-applied carries the page's dataset.
        fold = this.#page;
      }
    }
    /** The ruleset at a position at or below the work state's. */
    const at = (q: number): Ruleset => {
      if (q === tipSeq + kept.length) return work.ruleset();
      if (q <= tipSeq) return this.#confirmedAt(q);
      const drafts = kept.map((p) => p.draft);
      return foldPending(q, tipSeq, this.#tip, drafts, checkpoints);
    };
    const report = (d: CommitDraft, why: DropWhy | null, dropped: Dropped[]) => {
      if (!isMove(d)) drops.push({ id: d.id, label: d.label, whole: why !== null, why, dropped });
    };
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      const d = p.draft;
      const parent = tipSeq + kept.length;
      const out = this.#rework(p, work, parent, fold, at, keptAt);
      if ('hold' in out) {
        const held = live.slice(i);
        if (out.hold === 'future') {
          this.#future = true;
          this.#heldFuture = [...this.#heldFuture, ...held];
        } else this.#heldDataset = [...this.#heldDataset, ...held];
        break;
      }
      if ('silent' in out) continue;
      if ('drop' in out) {
        report(d, out.drop, out.dropped);
        continue;
      }
      // Keep the record as it is when re-applying changed nothing in it.
      const draft = draftText(out.keep) === draftText(d) ? d : out.keep;
      try {
        parseCommitDraft(draft);
      } catch (e) {
        if (!(e instanceof LogFormatError)) throw e;
        report(d, 'invalid', out.dropped);
        continue;
      }
      if (!fitsCommit(draft, this.#limits)) {
        report(d, 'too-large', out.dropped);
        continue;
      }
      if (parent - lastCheckpoint >= PENDING_CHECKPOINT) {
        checkpoints.push({ position: parent, state: work.clone() });
        lastCheckpoint = parent;
      }
      try {
        work.apply(draft, { check: true });
      } catch (e) {
        if (!(e instanceof LogError)) throw e;
        report(d, 'invalid', out.dropped);
        continue;
      }
      if (out.dropped.length > 0) report(d, null, out.dropped);
      keep(p, draft, parent);
    }
    this.#pending = kept;
    this.#indexOf = new Map(kept.map((p, i) => [p.draft.id, i]));
    this.#local = work;
    this.#pendingCheckpoints = checkpoints;
    this.#history = history;
    this.#bytes = bytes;
    return drops;
  }

  /**
   * The move to the page's dataset on the confirmed tip, applied to `work`: `head` when `first`
   * is already such a move (it is recomputed, not doubled), `draft` null when `align` changes
   * nothing. Null, with `work` untouched, when the page cannot align its own dataset or the move
   * would not be sendable: then nothing moves (ruling (c)).
   */
  #leadMove(
    first: Pending,
    work: LogState,
    tipSeq: number
  ): { head: boolean; draft: CommitDraft | null } | null {
    const page = this.#page!;
    const f = first.draft;
    const head = isMove(f) && f.datasetVersion === page;
    const tip = work.ruleset();
    const aligned = this.#align(tip, page);
    const changes = aligned === null ? null : diffOrNull(tip, aligned);
    if (changes === null) return null;
    if (changes.length === 0) return { head, draft: null };
    const stamp = {
      datasetVersion: page,
      shapes: this.#reg.current,
      build: this.#build ?? f.build
    };
    const draft: CommitDraft = head
      ? { ...f, parent: tipSeq, changes, ...stamp }
      : {
          id: newId(),
          parent: tipSeq,
          kind: 'system',
          label: MOVE_LABEL,
          restores: null,
          source: MOVE_SOURCE,
          changes,
          ...stamp
        };
    try {
      parseCommitDraft(draft);
    } catch (e) {
      if (e instanceof LogFormatError) return null;
      throw e;
    }
    if (!fitsCommit(draft, this.#limits)) return null;
    try {
      work.apply(draft, { check: true });
    } catch (e) {
      if (e instanceof LogError) return null;
      throw e;
    }
    return { head, draft };
  }

  /** The changes and stamp of one pending commit on `work`, the fold being on `fold`. */
  #rework(
    p: Pending,
    work: LogState,
    parent: number,
    fold: string | null,
    at: (q: number) => Ruleset,
    keptAt: ReadonlyMap<string, number>
  ): Outcome {
    const d = p.draft;
    // A newer build's commit is held before anything reads it (I9), whatever its kind.
    if (d.shapes > this.#reg.current) return { hold: 'future' };
    // Recomputed through diff, so in this build's shapes.
    const rebuilt = { shapes: this.#reg.current, build: this.#build ?? d.build };
    const stamp = fold ?? d.datasetVersion;
    if (isMove(d)) {
      const to = d.datasetVersion;
      // A move to another dataset than the fold's stands only while the server's is unknown
      // or is its own (I11); an alignment on the fold's own dataset always stands.
      if (to !== fold && this.#serverDataset !== null && this.#serverDataset !== to)
        return { silent: true };
      const cur = work.ruleset();
      const aligned = this.#align(cur, to);
      if (aligned === null) return { hold: 'unaligned' };
      const changes = diffOrNull(cur, aligned);
      if (changes === null || changes.length === 0) return { silent: true };
      return { keep: { ...d, parent, changes, datasetVersion: to, ...rebuilt }, dropped: [] };
    }
    if (d.kind === 'restore') {
      if (d.restores === null) return { drop: 'invalid', dropped: [] };
      const position =
        p.targetId === null ? 0 : (this.#seqOf.get(p.targetId) ?? keptAt.get(p.targetId));
      if (position === undefined) return { drop: 'target-gone', dropped: [] };
      const target = at(position);
      let content: RulesetContent = target;
      if (target.datasetVersion !== null && target.datasetVersion !== stamp) {
        const aligned = this.#align(target, stamp);
        if (aligned === null) return { hold: 'unaligned' };
        content = aligned;
      }
      const changes = diffOrNull(work.ruleset(), content);
      if (changes === null) return { drop: 'invalid', dropped: [] };
      if (changes.length === 0) return { drop: 'empty', dropped: [] };
      const restores = { position, as: d.restores.as };
      return {
        keep: { ...d, parent, restores, changes, datasetVersion: stamp, ...rebuilt },
        dropped: []
      };
    }
    let r: ReturnType<typeof reapply>;
    try {
      r = reapply(work, { changes: d.changes, shapes: d.shapes, datasetVersion: stamp });
    } catch (e) {
      if (e instanceof LogError && e.code === 'future-shapes') return { hold: 'future' };
      if (e instanceof LogError || e instanceof LogFormatError)
        return { drop: 'invalid', dropped: [] };
      throw e;
    }
    if (!r.ok) return { drop: r.why, dropped: r.dropped };
    return {
      keep: { ...d, parent, changes: r.changes, datasetVersion: stamp },
      dropped: r.dropped
    };
  }
}
