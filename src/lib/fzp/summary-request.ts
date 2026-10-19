/**
 * Latest-wins parcel-summary requests for the project card and tooltip (spec §4.8). One instance
 * per surface: at most one request in flight, one queued behind it, and only the latest query's
 * answer reaches `onstate`. FzpMode owns the instances and supplies `send`.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { ParcelSummary, ProjectCard } from '$lib/sim/protocol';
import type { Day } from '$lib/timelapse/time';

export type SummaryQuery = { parcelId: ParcelId; day: Day; projectId?: string };

export type SummaryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-loaded' }
  | { kind: 'none' }
  | { kind: 'project'; card: ProjectCard }
  | { kind: 'unavailable' };

export const SUMMARY_COPY: Record<'loading' | 'not-loaded' | 'none' | 'unavailable', string> = {
  loading: 'Loading project details…',
  'not-loaded': 'Project details are still loading for this area.',
  none: 'No project on this parcel at this date.',
  unavailable: 'Details unavailable'
};

interface Deps {
  send: (q: SummaryQuery) => Promise<ParcelSummary | null>;
  /** True while the worker is crashed, until Retry. */
  unavailable: () => boolean;
  onstate: (s: SummaryState) => void;
}

export class SummaryRequester {
  #deps: Deps;
  #state: SummaryState['kind'] = 'idle';
  /** The query whose card is on show, while the state is `project`. */
  #shown: SummaryQuery | null = null;
  #last: SummaryQuery | null = null;
  #queued: SummaryQuery | null = null;
  #inFlight = false;

  constructor(deps: Deps) {
    this.#deps = deps;
  }

  /** The latest query asked since the last reset. */
  get query(): SummaryQuery | null {
    return this.#last;
  }

  /**
   * Ask for a summary; the latest request wins. While a card is shown, a request for the same
   * parcel and project keeps it on show until the answer replaces it (no flash of `loading` on
   * every month); any other request shows `loading`.
   */
  request(q: SummaryQuery): void {
    this.#last = q;
    if (this.#deps.unavailable()) {
      this.#queued = null;
      this.#emit({ kind: 'unavailable' });
      return;
    }
    const keep =
      this.#shown !== null &&
      this.#shown.parcelId === q.parcelId &&
      this.#shown.projectId === q.projectId;
    if (!keep) this.#emit({ kind: 'loading' });
    if (this.#inFlight) {
      this.#queued = q;
      return;
    }
    this.#send(q);
  }

  /** Call on every `chunks` message: a surface waiting on a chunk record asks again. */
  retryIfNotLoaded(day: Day): void {
    if (this.#state !== 'not-loaded' || this.#last === null) return;
    this.request({ ...this.#last, day });
  }

  reset(): void {
    this.#last = null;
    this.#queued = null;
    this.#emit({ kind: 'idle' });
  }

  #emit(s: SummaryState, q: SummaryQuery | null = null): void {
    this.#state = s.kind;
    this.#shown = s.kind === 'project' ? q : null;
    this.#deps.onstate(s);
  }

  #send(q: SummaryQuery): void {
    this.#inFlight = true;
    const settle = (summary: ParcelSummary | null) => {
      this.#inFlight = false;
      const next = this.#queued;
      this.#queued = null;
      if (next !== null) {
        this.#send(next);
        return;
      }
      // Latest wins, unconditionally: an answer to a query that is no longer the latest is stale.
      if (q !== this.#last) return;
      if (summary === null) {
        this.#emit({ kind: this.#deps.unavailable() ? 'unavailable' : 'not-loaded' });
      } else if (summary.project) {
        this.#emit({ kind: 'project', card: summary.project }, q);
      } else {
        this.#emit({ kind: 'none' });
      }
    };
    let answer: Promise<ParcelSummary | null>;
    try {
      answer = this.#deps.send(q);
    } catch {
      answer = Promise.resolve(null);
    }
    answer.then(settle, () => settle(null));
  }
}
