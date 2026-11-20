// Paint's map key counts (map on screen, Task 5): the editor worker's `heightLots`, asked once per
// plan change, chunk message (while a cell of the plan is missing) or shown height. Latest wins:
// an answer to an older request never overwrites a newer one's.
import type { HeightLotsResult } from '$lib/sim/protocol';
import type { LotOutlines } from '$lib/sim/outlines';

export class HeightLots {
  #ask: (outlineOf: number | null) => Promise<HeightLotsResult | null>;
  /** The latest request's number; an answer to any other is dropped. */
  #seq = 0;
  /** Whether anything has been asked: chunks refresh only an asked plan. */
  #asked = false;
  /** The height whose outline is wanted, or null. */
  #shown: number | null = null;
  #result = $state.raw<HeightLotsResult | null>(null);
  #outline = $state.raw<LotOutlines | null>(null);

  constructor(ask: (outlineOf: number | null) => Promise<HeightLotsResult | null>) {
    this.#ask = ask;
  }

  /** The latest answer, or null before the first one (or with no worker state). */
  get result(): HeightLotsResult | null {
    return this.#result;
  }

  /** The outline of the shown height from the latest answer, or null. */
  get outline(): LotOutlines | null {
    return this.#outline;
  }

  /**
   * Ask again: the plan changed. `fresh` (another plan was loaded): the counts clear until its
   * answer, so a row never shows the previous plan's numbers.
   */
  planChanged(fresh = false): void {
    if (fresh) this.#result = null;
    this.#request();
  }

  /** A `chunks` message: ask again while a cell of the plan is still missing. */
  chunksChanged(): void {
    if (!this.#asked) return;
    if (this.#result !== null && this.#result.missing === 0) return;
    this.#request();
  }

  /** Ask for that height's outline; null clears it without a request. */
  show(stories: number | null): void {
    if (stories === this.#shown) return;
    this.#shown = stories;
    if (stories === null) {
      this.#outline = null;
      return;
    }
    this.#request();
  }

  #request(): void {
    this.#asked = true;
    const seq = ++this.#seq;
    void this.#ask(this.#shown).then((r) => {
      if (seq !== this.#seq) return;
      this.#result = r;
      // A height cleared since the request keeps no outline; one shown since made a newer request.
      this.#outline = this.#shown === null ? null : (r?.outline ?? null);
    });
  }
}
