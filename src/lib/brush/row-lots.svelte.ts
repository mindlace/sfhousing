/**
 * The page's side of `/`'s Paint tab lot counts: asks the editor worker (`opLots`) how many
 * eligible lots each row covers, and for the selected row's outline. One request is in flight at
 * a time with a queue behind it, since a long plan can have many rows; the selected row goes to
 * the front. A row's answer is dropped if the row changed or the worker restarted since it was
 * asked. While a row's chunks are still loading (`missing > 0`) it stays 'finding' and is asked
 * again on each `chunks` message.
 */
// The Maps and Sets here are either bookkeeping the page never reads, or the `#answers` map,
// which is replaced (never mutated) under `$state.raw`, so readers track the replacement.
/* eslint-disable svelte/prefer-svelte-reactivity */
import type { LotStatus, PlanRowGroup } from '$lib/paint/rows';
import type { LotOutlines } from '$lib/sim/outlines';
import type { OpLotsResult } from '$lib/sim/protocol';

export interface RowLotsDeps {
  request(opIds: string[], outlines: boolean): Promise<OpLotsResult | null>;
}

interface Row {
  opIds: string[];
  /** The ops joined: two asks of a row are the same question when their keys are equal. */
  key: string;
  /** The last answer, null while unanswered or after a null answer. */
  answer: OpLotsResult | null;
  /** The answer was asked with `outlines: true` (so it carries the outline). */
  withOutline: boolean;
  /** The last request came back null: no worker state yet, so a chunks message asks again. */
  nulled: boolean;
  /** A chunks message arrived while this row's request was out. */
  again: boolean;
}

export class RowLots {
  #deps: RowLotsDeps;
  #rows = new Map<string, Row>();
  #queue: string[] = [];
  #busy = false;
  #scheduled = false;
  /** Bumped by `reset`: an answer to an older epoch is dropped. */
  #epoch = 0;
  #inFlight: string | null = null;
  #selected = $state<string | null>(null);
  /** The answers the page reads; replaced, never mutated, so reads track. */
  #answers = $state.raw<ReadonlyMap<string, OpLotsResult>>(new Map());

  constructor(deps: RowLotsDeps) {
    this.#deps = deps;
  }

  /** 'finding' until answered with missing 0, then 'found'. */
  status(id: string): LotStatus {
    const a = this.#answers.get(id);
    return a && a.missing === 0 ? { kind: 'found', lots: a.lots } : { kind: 'finding' };
  }

  /** The selected row's outline (asked with outlines: true), or null. */
  get outline(): LotOutlines | null {
    return this.#selected === null ? null : (this.#answers.get(this.#selected)?.outline ?? null);
  }

  /** Asks for every row whose op ids changed since its last answer; forgets rows that are gone. */
  want(groups: readonly PlanRowGroup[]): void {
    const live = new Set<string>();
    for (const g of groups) {
      live.add(g.id);
      const key = g.opIds.join('\n');
      const row = this.#rows.get(g.id);
      if (row && row.key === key) continue;
      this.#rows.set(g.id, {
        opIds: [...g.opIds],
        key,
        answer: null,
        withOutline: false,
        nulled: false,
        again: false
      });
      this.#setAnswer(g.id, null);
      this.#enqueue(g.id);
    }
    for (const id of [...this.#rows.keys()]) {
      if (live.has(id)) continue;
      this.#rows.delete(id);
      this.#setAnswer(id, null);
      this.#queue = this.#queue.filter((q) => q !== id);
      if (this.#selected === id) this.#selected = null;
    }
    this.#schedule();
  }

  select(id: string | null): void {
    if (id === this.#selected) return;
    const prev = this.#selected !== null ? this.#rows.get(this.#selected) : undefined;
    if (prev && prev.answer) {
      // The old row keeps its count but not its outline.
      prev.answer = { ...prev.answer, outline: null };
      prev.withOutline = false;
      this.#setAnswer(this.#selected!, prev.answer);
    }
    this.#selected = id;
    const row = id !== null ? this.#rows.get(id) : undefined;
    if (id !== null && row && !(row.answer && row.withOutline)) this.#enqueue(id);
    this.#schedule();
  }

  /** A `chunks` message: ask again for rows answered with missing > 0 (or not answered at all). */
  chunksChanged(): void {
    for (const [id, row] of this.#rows) {
      if (id === this.#inFlight) row.again = true;
      else if (row.nulled || (row.answer !== null && row.answer.missing > 0)) this.#enqueue(id);
    }
    this.#schedule();
  }

  /** A worker restart: everything is asked again. */
  reset(): void {
    this.#epoch++;
    this.#queue = [];
    this.#answers = new Map();
    for (const [id, row] of this.#rows) {
      row.answer = null;
      row.withOutline = false;
      row.nulled = false;
      row.again = false;
      this.#enqueue(id);
    }
    this.#schedule();
  }

  #setAnswer(id: string, a: OpLotsResult | null): void {
    const next = new Map(this.#answers);
    if (a) next.set(id, a);
    else next.delete(id);
    this.#answers = next;
  }

  /** Queues a row once; the selected row goes first. */
  #enqueue(id: string): void {
    if (this.#queue.includes(id)) return;
    if (id === this.#selected) this.#queue.unshift(id);
    else this.#queue.push(id);
  }

  /** Requests go out on a microtask, so a `want` and a `select` in one turn ask once. */
  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#busy) return;
    const id = this.#queue.shift();
    if (id === undefined) return;
    const row = this.#rows.get(id);
    if (!row) return this.#pump();
    this.#busy = true;
    this.#inFlight = id;
    row.again = false;
    const { key, opIds } = row;
    const epoch = this.#epoch;
    const outlines = id === this.#selected;
    const done = (r: OpLotsResult | null) => {
      this.#busy = false;
      this.#inFlight = null;
      const cur = this.#rows.get(id);
      // Dropped if the row changed, went away, or the worker restarted since it was asked.
      if (epoch === this.#epoch && cur && cur.key === key) {
        const keepOutline = outlines && id === this.#selected;
        cur.answer = r && !keepOutline && r.outline ? { ...r, outline: null } : r;
        cur.withOutline = r !== null && keepOutline;
        cur.nulled = r === null;
        this.#setAnswer(id, cur.answer);
        if (cur.again && (r === null || r.missing > 0)) this.#enqueue(id);
        cur.again = false;
      }
      this.#pump();
    };
    this.#deps.request([...opIds], outlines).then(done, () => done(null));
  }
}
