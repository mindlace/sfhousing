import { emptyPlan, parsePlan, rebasePlan, serializePlan, type Plan } from '$lib/plan';
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
export interface RestoreResult {
  plan: Plan;
  notice: AutosaveNotice | null;
}
type LastPublished = { id: string; hash: string };

/**
 * Local autosave of the working plan (spec §4.5). Client-only behaviour, but safe to construct
 * during SSR: nothing touches `window`/`localStorage` until a method runs.
 */
export class Autosave {
  status = $state<SaveStatus>('saved');
  lastPublished = $state.raw<LastPublished | undefined>(undefined);

  readonly #current: string;
  readonly #storage: () => Storage | null;
  readonly #debounceMs: number;
  readonly #now: () => Date;
  /** Serialization last written to (or restored from) storage; schedule() skips it. */
  #lastWritten: string | null = null;
  #pending: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** A corrupt/future record not yet preserved; the plan key is never overwritten before it is. */
  #unpreserved: string | null = null;

  constructor(opts: {
    currentVersion: string;
    storage?: () => Storage | null;
    debounceMs?: number;
    now?: () => Date;
  }) {
    this.#current = opts.currentVersion;
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
  restore(handoff?: string): RestoreResult {
    this.#cancel();
    this.#unpreserved = null;
    const storage = this.#getStorage();
    let read: ReadResult | null = null;
    if (storage) {
      try {
        read = readRecord(storage);
      } catch {
        read = null;
      }
    }
    if (read && (read.kind === 'corrupt' || read.kind === 'future')) this.#unpreserved = read.raw;

    if (handoff !== undefined) {
      const h = parsePlan(handoff);
      if (h.ok) {
        const plan = this.#rebase(h.value);
        this.lastPublished = undefined;
        this.#lastWritten = null;
        this.#write(serializePlan(plan));
        return { plan, notice: null };
      }
    }

    if (read === null) {
      const plan = this.#empty();
      this.lastPublished = undefined;
      this.#lastWritten = serializePlan(plan);
      this.status = 'off';
      return { plan, notice: null };
    }

    switch (read.kind) {
      case 'missing': {
        const plan = this.#empty();
        this.lastPublished = undefined;
        this.#lastWritten = serializePlan(plan);
        this.status = 'saved';
        return { plan, notice: null };
      }
      case 'ok': {
        this.lastPublished = read.record.lastPublished;
        const from = read.plan.datasetVersion;
        if (from === this.#current) {
          this.#lastWritten = serializePlan(read.plan);
          this.status = 'saved';
          return { plan: read.plan, notice: null };
        }
        const plan = this.#rebase(read.plan);
        this.#lastWritten = null;
        this.#write(serializePlan(plan));
        return { plan, notice: { kind: 'rebased', from, to: this.#current } };
      }
      case 'corrupt':
      case 'future': {
        const plan = this.#empty();
        this.lastPublished = undefined;
        this.#lastWritten = null;
        this.#write(serializePlan(plan));
        return { plan, notice: { kind: read.kind } };
      }
    }
  }

  /** Debounced write. Skips a plan whose serialization equals the last written one. */
  schedule(plan: Plan): void {
    const text = serializePlan(plan);
    if (text === this.#lastWritten) {
      if (this.#pending !== null) {
        this.#cancel();
        if (this.status === 'saving') this.status = 'saved';
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
  setLastPublished(lp: LastPublished, plan: Plan): void {
    this.lastPublished = { id: lp.id, hash: lp.hash };
    this.#cancel();
    this.#write(serializePlan(plan));
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
      if (!preserveCorrupt(storage, this.#unpreserved, now)) {
        this.status = 'off';
        return;
      }
      this.#unpreserved = null;
    }
    const record: LocalPlanRecord = { v: 1, savedAt: now.toISOString(), plan: text };
    if (this.lastPublished) record.lastPublished = this.lastPublished;
    if (writeRecord(storage, record)) {
      this.#lastWritten = text;
      this.status = 'saved';
    } else {
      this.status = 'off';
    }
  }

  #empty(): Plan {
    return this.#guard(() => emptyPlan(this.#current));
  }

  #rebase(plan: Plan): Plan {
    return this.#guard(() => rebasePlan(plan, this.#current));
  }

  #guard(fn: () => Plan): Plan {
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
