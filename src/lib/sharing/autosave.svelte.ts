import type { Plan } from '$lib/plan';
import { PLAN_CODEC, type DocCodec } from './doc-codec';
import {
  getStorage,
  preserveCorrupt,
  readRecord,
  writeRecord,
  type LocalPlanRecord,
  type ReadResult
} from './storage';

export type SaveStatus = 'saved' | 'saving' | 'off';
export type AutosaveNotice =
  { kind: 'corrupt' } | { kind: 'future' } | { kind: 'rebased'; from: string; to: string };
export interface RestoreResult<D = Plan> {
  plan: D;
  notice: AutosaveNotice | null;
}
type LastPublished = { id: string; hash: string };

/**
 * Local autosave of the working plan (spec §4.5). Client-only behaviour, but safe to construct
 * during SSR: nothing touches `window`/`localStorage` until a method runs.
 */
export class Autosave<D = Plan> {
  status = $state<SaveStatus>('saved');
  lastPublished = $state.raw<LastPublished | undefined>(undefined);

  readonly #current: string;
  readonly #codec: DocCodec<D>;
  readonly #storage: () => Storage | null;
  readonly #debounceMs: number;
  readonly #now: () => Date;
  readonly #writable: (d: D) => boolean;
  /** Serialization last written to (or restored from) storage; schedule() skips it. */
  #lastWritten: string | null = null;
  #pending: string | null = null;
  /** The latest document scheduled was not writable; cleared by the next write or match. */
  #refused = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** A corrupt/future record not yet preserved; the plan key is never overwritten before it is. */
  #unpreserved: string | null = null;

  constructor(opts: {
    currentVersion: string;
    codec?: DocCodec<D>;
    storage?: () => Storage | null;
    debounceMs?: number;
    now?: () => Date;
    /**
     * False for a document that must not be stored (ruling R4: a SimDoc over the size limits
     * would load back as corrupt). Such a change cancels any pending write and shows
     * "Autosave off" until a writable document is written.
     */
    writable?: (d: D) => boolean;
  }) {
    this.#current = opts.currentVersion;
    this.#writable = opts.writable ?? (() => true);
    this.#codec = opts.codec ?? (PLAN_CODEC as unknown as DocCodec<D>);
    this.#storage = opts.storage ?? getStorage;
    this.#debounceMs = opts.debounceMs ?? 500;
    // A timestamp for savedAt, never reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    this.#now = opts.now ?? (() => new Date());
  }

  /**
   * Reads (or, when `handoff` is given — Remix via history.state — parses that instead),
   * rebases, writes back, and returns the plan to load. Never throws on storage problems;
   * an invalid `currentVersion` throws a TypeError (the page cannot work without it).
   */
  restore(handoff?: string): RestoreResult<D> {
    this.#cancel();
    this.#unpreserved = null;
    const storage = this.#getStorage();
    let read: ReadResult<D> | null = null;
    if (storage) {
      try {
        read = readRecord(storage, this.#codec);
      } catch {
        read = null;
      }
    }
    if (read && (read.kind === 'corrupt' || read.kind === 'future')) this.#unpreserved = read.raw;

    if (handoff !== undefined) {
      const h = this.#codec.load(handoff);
      if (h.ok) {
        const plan = this.#rebase(h.value);
        this.lastPublished = undefined;
        this.#lastWritten = null;
        this.#write(this.#codec.serialize(plan));
        return { plan, notice: null };
      }
    }

    if (read === null) {
      const plan = this.#empty();
      this.lastPublished = undefined;
      this.#lastWritten = this.#codec.serialize(plan);
      this.status = 'off';
      return { plan, notice: null };
    }

    switch (read.kind) {
      case 'missing': {
        const plan = this.#empty();
        this.lastPublished = undefined;
        this.#lastWritten = this.#codec.serialize(plan);
        this.status = 'saved';
        return { plan, notice: null };
      }
      case 'ok': {
        this.lastPublished = read.record.lastPublished;
        const from = this.#codec.datasetVersion(read.plan);
        if (from === this.#current) {
          this.#lastWritten = this.#codec.serialize(read.plan);
          this.status = 'saved';
          return { plan: read.plan, notice: null };
        }
        const plan = this.#rebase(read.plan);
        this.#lastWritten = null;
        this.#write(this.#codec.serialize(plan));
        return { plan, notice: { kind: 'rebased', from, to: this.#current } };
      }
      case 'corrupt':
      case 'future': {
        const plan = this.#empty();
        this.lastPublished = undefined;
        this.#lastWritten = null;
        this.#write(this.#codec.serialize(plan));
        return { plan, notice: { kind: read.kind } };
      }
    }
  }

  /** Debounced write. Skips a plan whose serialization equals the last written one. */
  schedule(plan: D): void {
    if (!this.#writable(plan)) {
      // Keep the last writable document a pending write holds, then refuse this one.
      this.flush();
      this.#refused = true;
      this.status = 'off';
      return;
    }
    const text = this.#codec.serialize(plan);
    if (text === this.#lastWritten) {
      if (this.#pending !== null) {
        this.#cancel();
        if (this.status === 'saving') this.status = 'saved';
      }
      // Back to what storage holds after a refused document (an undo): it is saved.
      if (this.#refused) {
        this.#refused = false;
        this.status = 'saved';
      }
      return;
    }
    this.#pending = text;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.#debounceMs);
    // "Autosave off" stays visible while a retry is pending; it clears on the first success.
    if (this.status !== 'off') this.status = 'saving';
  }

  /** Writes any pending plan now (visibilitychange→hidden, pagehide). */
  flush(): void {
    const text = this.#pending;
    this.#cancel();
    if (text !== null) this.#write(text);
  }

  /** Stores lastPublished and writes the record for `plan` immediately. */
  setLastPublished(lp: LastPublished, plan: D): void {
    this.lastPublished = { id: lp.id, hash: lp.hash };
    this.#cancel();
    if (!this.#writable(plan)) {
      this.status = 'off';
      return;
    }
    this.#write(this.#codec.serialize(plan));
  }

  /** Adds visibilitychange/pagehide flush listeners; the remover flushes and clears the timer. */
  attach(): () => void {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    const onPageHide = () => this.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      this.flush();
    };
  }

  #cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = null;
  }

  #getStorage(): Storage | null {
    try {
      return this.#storage();
    } catch {
      return null;
    }
  }

  #write(text: string): void {
    const storage = this.#getStorage();
    if (!storage) {
      this.status = 'off';
      return;
    }
    const now = this.#now();
    if (this.#unpreserved !== null) {
      if (!preserveCorrupt(storage, this.#unpreserved, now, this.#codec)) {
        this.status = 'off';
        return;
      }
      this.#unpreserved = null;
    }
    const record: LocalPlanRecord = { v: 1, savedAt: now.toISOString(), plan: text };
    if (this.lastPublished) record.lastPublished = this.lastPublished;
    if (writeRecord(storage, record, this.#codec)) {
      this.#lastWritten = text;
      this.#refused = false;
      this.status = 'saved';
    } else {
      this.status = 'off';
    }
  }

  #empty(): D {
    return this.#guard(() => this.#codec.empty(this.#current));
  }

  #rebase(plan: D): D {
    return this.#guard(() => this.#codec.rebase(plan, this.#current));
  }

  #guard(fn: () => D): D {
    try {
      return fn();
    } catch (e) {
      throw new TypeError(
        `Autosave: invalid currentVersion ${JSON.stringify(this.#current)}: ${(e as Error).message}`,
        { cause: e }
      );
    }
  }
}
