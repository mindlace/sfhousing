/**
 * The page's side of the worker's `heightLids` (height-lids plan, Task 12): asks for the glass
 * lids of the map's view and shows the latest answer. At most one request is in flight; a want or
 * a trigger that arrives meanwhile marks it dirty, the in-flight answer is then dropped, and only
 * the latest bbox goes once it is back. A `superseded` answer is ignored (the next `heights`
 * asks again); `no-session` shows null and waits for a new session.
 */
import type { HeightLids } from '$lib/map/height/types';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import type { HeightLidsResult } from '$lib/sim/scenario/types';

type BBox = [number, number, number, number];

export interface LidRequestDeps {
  request(bbox: BBox): Promise<HeightLidsResult>;
  show(l: HeightLids | null): void;
}

/**
 * `bbox` (west, south, east, north) with each axis at most `maxSpanM` metres: a window of
 * `maxSpanM` around `centre` (the map's view centre; default the bbox's), slid to stay inside the
 * bbox. A pitched view's bounds run out toward the horizon, so their middle lies well beyond the
 * view centre; clamping around the view centre keeps the near part of the view, where the user
 * looks (R14).
 */
export function clampBbox(
  bbox: BBox,
  maxSpanM: number,
  centre: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
): BBox {
  const [w, s, e, n] = bbox;
  const [x0, x1] = clampAxis(w, e, centre[0], maxSpanM / M_PER_DEG_LNG);
  const [y0, y1] = clampAxis(s, n, centre[1], maxSpanM / M_PER_DEG_LAT);
  return [x0, y0, x1, y1];
}

/** [lo, hi] cut to `span` around `c`, slid back inside [lo, hi]. */
function clampAxis(lo: number, hi: number, c: number, span: number): [number, number] {
  if (hi - lo <= span) return [lo, hi];
  const start = Math.max(lo, Math.min(c - span / 2, hi - span));
  return [start, start + span];
}

const sameBbox = (a: BBox, b: BBox) => a.every((x, i) => x === b[i]);

export class LidRequest {
  #deps: LidRequestDeps;
  /** The bbox last wanted; null when lids are not wanted (zoomed out, a run, toggled off). */
  #wanted: BBox | null = null;
  /** Bumped by every request, every clear and every dirtying, so an older answer is dropped. */
  #token = 0;
  #inFlight = false;
  /** Something changed while a request was in flight: ask again once it is back. */
  #dirty = false;
  /** The last answer shown for the current want. */
  #last: Extract<HeightLidsResult, { ok: true }> | null = null;
  /** The last request failed for want of a session: a new session is a reason to ask again. */
  #failed = false;
  /** The latest limits revision reported. */
  #rev: number | null = null;

  constructor(deps: LidRequestDeps) {
    this.#deps = deps;
  }

  /** null clears. The same bbox as the last want: no new request. */
  want(bbox: BBox | null): void {
    if (bbox === null) {
      if (this.#wanted === null) return;
      this.#wanted = null;
      this.#token++;
      this.#dirty = false;
      this.#last = null;
      this.#failed = false;
      this.#deps.show(null);
      return;
    }
    if (this.#wanted && sameBbox(this.#wanted, bbox)) return;
    this.#wanted = bbox;
    this.#send();
  }

  /** A new city (limits revision `rev`): the lids in view are stale, ask again. */
  limitsChanged(rev: number): void {
    if (rev === this.#rev) return;
    this.#rev = rev;
    if (this.#wanted !== null) this.#send();
  }

  /** A chunk arrived: ask again if the last answer had lots missing. */
  chunksChanged(): void {
    if (this.#wanted !== null && this.#last !== null && this.#last.missing > 0) this.#send();
  }

  /** A new client: ask again if the last request failed for want of a session. */
  sessionChanged(): void {
    if (this.#wanted !== null && this.#failed) this.#send();
  }

  #send(): void {
    if (this.#inFlight) {
      this.#dirty = true;
      this.#token++;
      return;
    }
    const bbox = this.#wanted;
    if (bbox === null) return;
    const token = ++this.#token;
    this.#inFlight = true;
    this.#dirty = false;
    this.#failed = false;
    const done = (apply: () => void) => {
      this.#inFlight = false;
      if (token === this.#token) apply();
      if (this.#dirty) this.#send();
    };
    void this.#deps.request(bbox).then(
      (r) =>
        done(() => {
          if (r.ok) {
            this.#last = r;
            this.#deps.show(r.lids);
          } else if (r.reason !== 'superseded') {
            this.#last = null;
            this.#failed = r.reason === 'no-session';
            this.#deps.show(null);
          }
        }),
      () =>
        done(() => {
          this.#last = null;
          this.#failed = true;
          this.#deps.show(null);
        })
    );
  }
}
