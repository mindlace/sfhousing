/**
 * The /sim policy in memory (Call 15: no persistence in plan 3): `PolicyStore` keeps the recipe
 * with undo and redo, and `LeverSync` turns each recipe into the `SimLevers` the worker runs.
 * `LeverSync` resolves every brush query the recipe needs (cached by `queryKey`), compiles once
 * all are known, and sends the result 250 ms after the last change (Call 18), so only the latest
 * recipe reaches the worker.
 */
import type { BrushQuery } from '$lib/sim/levers/brushes';
import type { SimLevers } from '$lib/sim/levers/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { compileLevers, queriesOf, type SimPolicy } from './policy';

type Entry = { policy: SimPolicy; label: string };

export class PolicyStore {
  #policy: SimPolicy;
  /** Each entry is the policy before a change, with that change's label. */
  #past = $state.raw<Entry[]>([]);
  /** Each entry is the policy after an undone change, with that change's label. */
  #future = $state.raw<Entry[]>([]);

  constructor(initial: SimPolicy) {
    this.#policy = $state.raw(initial);
  }

  /** Replaced (never mutated) on every change. */
  get policy(): SimPolicy {
    return this.#policy;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Records a change named `label` (for "Undo: …"); clears redo. No-op if nothing changed. */
  apply(change: (p: SimPolicy) => SimPolicy, label: string): void {
    const next = change(this.#policy);
    if (next === this.#policy) return;
    this.#past = [...this.#past, { policy: this.#policy, label }];
    this.#future = [];
    this.#policy = next;
  }

  /** Restores the policy before the latest change; returns its label, or null if none. */
  undo(): string | null {
    const last = this.#past.at(-1);
    if (!last) return null;
    this.#past = this.#past.slice(0, -1);
    this.#future = [...this.#future, { policy: this.#policy, label: last.label }];
    this.#policy = last.policy;
    return last.label;
  }

  /** Reapplies the latest undone change; returns its label, or null if none. */
  redo(): string | null {
    const next = this.#future.at(-1);
    if (!next) return null;
    this.#future = this.#future.slice(0, -1);
    this.#past = [...this.#past, { policy: this.#policy, label: next.label }];
    this.#policy = next.policy;
    return next.label;
  }
}

export interface LeverSyncDeps {
  resolve(q: BrushQuery): Promise<BrushLotsResult>;
  send(l: SimLevers): void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  /** Tier 4 UI choice (Call 18). */
  debounceMs?: number;
}

export class LeverSync {
  #deps: LeverSyncDeps;
  #debounceMs: number;
  #policy: SimPolicy | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Answered queries, failures included (a failure stands until `retry`). Never mutated. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #results = $state.raw<ReadonlyMap<string, BrushLotsResult>>(new Map());
  /** Queries in flight, each with a token so a retried query's older answer is ignored. */
  #inFlight = new Map<string, number>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** Every query asked, by key, so `retry` can ask it again. */
  #queries = new Map<string, BrushQuery>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  #token = 0;
  #resolving = $state(0);
  #levers = $state.raw<SimLevers | null>(null);

  constructor(deps: LeverSyncDeps) {
    this.#deps = deps;
    this.#debounceMs = deps.debounceMs ?? 250;
  }

  /** The last document sent; null before the first send. */
  get levers(): SimLevers | null {
    return this.#levers;
  }

  /** Queries in flight. */
  get resolving(): number {
    return this.#resolving;
  }

  result(key: string): BrushLotsResult | undefined {
    return this.#results.get(key);
  }

  /** The recipe changed: ask for its unknown queries, then (re)start the debounce. */
  update(p: SimPolicy): void {
    this.#policy = p;
    for (const { key, query } of queriesOf(p)) {
      if (!this.#results.has(key) && !this.#inFlight.has(key)) this.#ask(key, query);
    }
    this.#schedule();
  }

  /** Asks a failed query again (a no-op unless its last answer failed). */
  retry(key: string): void {
    const r = this.#results.get(key);
    if (!r || r.ok || this.#inFlight.has(key)) return;
    const query = this.#queries.get(key);
    if (!query) return;
    const next = new Map(this.#results); // eslint-disable-line svelte/prefer-svelte-reactivity
    next.delete(key);
    this.#results = next;
    this.#ask(key, query);
  }

  #ask(key: string, query: BrushQuery): void {
    const token = ++this.#token;
    this.#queries.set(key, query);
    this.#inFlight.set(key, token);
    this.#resolving = this.#inFlight.size;
    void this.#deps.resolve(query).then(
      (r) => this.#answer(key, token, r),
      (e: unknown) =>
        this.#answer(key, token, { ok: false, reason: 'bad-request', message: String(e) })
    );
  }

  #answer(key: string, token: number, r: BrushLotsResult): void {
    if (this.#inFlight.get(key) !== token) return;
    this.#inFlight.delete(key);
    this.#resolving = this.#inFlight.size;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    this.#results = new Map(this.#results).set(key, r);
    // Only a query the latest recipe needs can unblock its send.
    if (this.#policy && queriesOf(this.#policy).some((q) => q.key === key)) this.#schedule();
  }

  /** Restarts the debounce if every query the latest recipe needs has answered `ok`. */
  #schedule(): void {
    // Called unbound: the browser's timers throw when called with another `this`.
    const { setTimeout: later, clearTimeout: cancel } = this.#deps;
    if (this.#timer !== null) cancel(this.#timer);
    this.#timer = null;
    const p = this.#policy;
    if (!p) return;
    const ready = queriesOf(p).every(({ key }) => this.#results.get(key)?.ok === true);
    if (!ready) return;
    this.#timer = later(() => {
      this.#timer = null;
      this.#send();
    }, this.#debounceMs);
  }

  #send(): void {
    const p = this.#policy;
    if (!p) return;
    const levers = compileLevers(p, (key) => {
      const r = this.#results.get(key);
      return r?.ok ? r.lots : undefined;
    });
    if (levers === null) return; // a query failed or was retried since the timer started
    this.#levers = levers;
    this.#deps.send(levers);
  }
}
