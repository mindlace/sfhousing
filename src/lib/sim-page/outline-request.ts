/**
 * The page's side of the eraser's lot outlines: asks the worker for the outlines of the painted
 * lots while the eraser is chosen and shows the latest answer. Latest wins: an answer to an older
 * want is dropped.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { LotOutlinesResult } from '$lib/sim/scenario/types';

type Outlines = Extract<LotOutlinesResult, { ok: true }>;

export interface OutlineRequestDeps {
  request(lots: ParcelId[]): Promise<LotOutlinesResult>;
  show(o: Outlines | null): void;
}

export class OutlineRequest {
  #deps: OutlineRequestDeps;
  /** The set last wanted; null when not erasing. */
  #wanted: ReadonlySet<ParcelId> | null = null;
  /** Bumped by every request and every clear, so an older answer is recognised. */
  #token = 0;
  /** The last answer shown for the current set. */
  #last: Outlines | null = null;
  /** The last request failed (no session): a chunk is a reason to ask again. */
  #failed = false;

  constructor(deps: OutlineRequestDeps) {
    this.#deps = deps;
  }

  /** null: not erasing (clears). Same set as the last call: no new request. */
  want(lots: ReadonlySet<ParcelId> | null): void {
    if (lots === null) {
      if (this.#wanted === null) return;
      this.#wanted = null;
      this.#token++;
      this.#last = null;
      this.#failed = false;
      this.#deps.show(null);
      return;
    }
    if (this.#wanted && sameSet(this.#wanted, lots)) return;
    this.#wanted = lots;
    this.#send();
  }

  /** A chunk arrived: ask again if the last answer had missing lots. */
  chunksChanged(): void {
    if (this.#wanted === null || this.#wanted.size === 0) return;
    if (this.#failed || (this.#last !== null && this.#last.missing > 0)) this.#send();
  }

  #send(): void {
    const wanted = this.#wanted;
    if (wanted === null) return;
    const token = ++this.#token;
    this.#last = null;
    this.#failed = false;
    if (wanted.size === 0) {
      this.#deps.show(null);
      return;
    }
    void this.#deps.request([...wanted]).then(
      (r) => {
        if (token !== this.#token) return;
        this.#last = r.ok ? r : null;
        this.#failed = !r.ok;
        this.#deps.show(r.ok ? r : null);
      },
      () => {
        if (token !== this.#token) return;
        this.#failed = true;
        this.#deps.show(null);
      }
    );
  }
}

function sameSet(a: ReadonlySet<ParcelId>, b: ReadonlySet<ParcelId>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
