/**
 * `PolicySync` turns each schema 4 document into the lots its brush queries name: it resolves
 * every query `queriesOf4` lists (cached by `queryKey`) and settles `lots` 250 ms after the last
 * change (rule 16), so only the latest document is answered. A `no-session` answer (no client, a
 * crash, a session that ended) is not a failure: the query waits for `resume`. `open` is the
 * opening document (a load): it settles as soon as every query has answered, with no debounce, a
 * failed query counting as no lots.
 *
 * A deliberate duplication of `LeverSync` (`sim-page/policy-store.svelte.ts`): that one stays
 * until Task 17 deletes it with the old page, and it compiles schema 3 levers; this one yields
 * lots.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { queriesOf4, type SimPolicy4 } from './policy4';

export interface PolicySyncDeps {
  resolve(q: BrushQuery): Promise<BrushLotsResult>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  /** Tier 4 UI choice (rule 16). */
  debounceMs?: number;
}

export class PolicySync {
  #deps: PolicySyncDeps;
  #debounceMs: number;
  #policy = $state.raw<SimPolicy4 | null>(null);
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Answered queries, failures included (a failure stands until `retry`). Never mutated. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #results = $state.raw<ReadonlyMap<string, BrushLotsResult>>(new Map());
  /**
   * Queries in flight: a token, so a retried query's older answer is ignored, and the `resume`
   * generation it was asked in.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #inFlight = new Map<string, { token: number; gen: number }>();
  /** Queries answered `no-session`, waiting for `resume`. */
  #parked = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** `#parked`'s size, so `pending` follows it. */
  #parkedN = $state(0);
  #generation = 0;
  /** Every query asked, by key, so `retry` can ask it again. */
  #queries = new Map<string, BrushQuery>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  #token = 0;
  #resolving = $state(0);
  /** The debounce timer is armed: a document is about to settle. */
  #armed = $state(false);
  #lots = $state.raw<Record<string, ParcelId[]> | null>(null);
  /** `open` was called and its document has not settled; an `update` ends it. */
  #opening = false;

  constructor(deps: PolicySyncDeps) {
    this.#deps = deps;
    this.#debounceMs = deps.debounceMs ?? 250;
  }

  /**
   * The lots of the latest document, by query key: null while a query is unresolved or the
   * debounce is armed; a new object each time it settles.
   */
  get lots(): Record<string, ParcelId[]> | null {
    return this.#lots;
  }

  /**
   * A newer document has not settled yet: the debounce is armed, a lot query is in flight, or a
   * query it needs waits for a session. A failed query leaves it false (the lots before it were
   * dropped; `retry` asks again).
   */
  get pending(): boolean {
    if (this.#armed || this.#resolving > 0) return true;
    const p = this.#policy;
    return this.#parkedN > 0 && p !== null && queriesOf4(p).some((q) => this.#parked.has(q.key));
  }

  result(key: string): BrushLotsResult | undefined {
    return this.#results.get(key);
  }

  /** The opening document (a load): settles once every query has answered, with no debounce. */
  open(p: SimPolicy4): void {
    this.#opening = true;
    this.#request(p);
  }

  /** The document changed: ask for its unknown queries, then (re)start the debounce. */
  update(p: SimPolicy4): void {
    this.#opening = false;
    this.#request(p);
  }

  #request(p: SimPolicy4): void {
    this.#policy = p;
    for (const { key, query } of queriesOf4(p)) {
      if (this.#results.has(key) || this.#inFlight.has(key) || this.#parked.has(key)) continue;
      this.#ask(key, query);
    }
    this.#schedule();
  }

  /**
   * A new session is live: asks again every query answered `no-session`. One still in flight
   * from before is asked again as soon as it answers `no-session`.
   */
  resume(): void {
    this.#generation++;
    const parked = [...this.#parked];
    this.#parked.clear();
    this.#parkedN = 0;
    const needed = (this.#policy ? queriesOf4(this.#policy) : []).map((q) => q.key);
    for (const key of parked) {
      const query = this.#queries.get(key);
      // A query the document no longer needs is asked again if it comes back (nothing is cached).
      if (query && needed.includes(key)) this.#ask(key, query);
    }
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
    this.#inFlight.set(key, { token, gen: this.#generation });
    this.#resolving = this.#inFlight.size;
    void this.#deps.resolve(query).then(
      (r) => this.#answer(key, token, r),
      (e: unknown) =>
        this.#answer(key, token, { ok: false, reason: 'bad-request', message: String(e) })
    );
  }

  #answer(key: string, token: number, r: BrushLotsResult): void {
    const asked = this.#inFlight.get(key);
    if (asked?.token !== token) return;
    this.#inFlight.delete(key);
    this.#resolving = this.#inFlight.size;
    if (!r.ok && r.reason === 'no-session') {
      // Not an answer about the lots: ask again in the next session, or now if one has started.
      const query = this.#queries.get(key);
      if (asked.gen < this.#generation && query) this.#ask(key, query);
      else {
        this.#parked.add(key);
        this.#parkedN = this.#parked.size;
      }
      return;
    }
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    this.#results = new Map(this.#results).set(key, r);
    // Only a query the latest document needs can unblock its settling.
    if (this.#policy && queriesOf4(this.#policy).some((q) => q.key === key)) this.#schedule();
  }

  /**
   * Restarts the debounce if every query the latest document needs has answered `ok`. While
   * opening, any answer will do (a failure counts as no lots), and it settles at once. Until
   * then `lots` is null.
   */
  #schedule(): void {
    // Called unbound: the browser's timers throw when called with another `this`.
    const { setTimeout: later, clearTimeout: cancel } = this.#deps;
    if (this.#timer !== null) cancel(this.#timer);
    this.#timer = null;
    this.#armed = false;
    const p = this.#policy;
    if (!p) return;
    if (!this.#ready(p)) {
      this.#lots = null;
      return;
    }
    if (this.#opening) {
      this.#settle(p);
      return;
    }
    this.#lots = null;
    this.#armed = true;
    this.#timer = later(() => {
      this.#timer = null;
      this.#armed = false;
      this.#settle(p);
    }, this.#debounceMs);
  }

  #ready(p: SimPolicy4): boolean {
    return queriesOf4(p).every(({ key }) => {
      const r = this.#results.get(key);
      return this.#opening ? r !== undefined : r?.ok === true;
    });
  }

  #settle(p: SimPolicy4): void {
    if (!this.#ready(p)) {
      this.#lots = null; // a query failed or was retried since the timer started
      return;
    }
    this.#opening = false;
    const lots: Record<string, ParcelId[]> = {};
    for (const { key } of queriesOf4(p)) {
      const r = this.#results.get(key);
      lots[key] = r?.ok ? r.lots : [];
    }
    this.#lots = lots;
  }
}
