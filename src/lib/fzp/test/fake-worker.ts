// A fake scenario worker behind the real ScenarioClient (spec §6, "Fixtures"): records every
// request, emits responses on demand and crashes through `onerror`, as a real Worker would.
import type { ScenarioWorkerLike } from '$lib/sim/scenario-client';
import type {
  ScenarioRequest,
  ScenarioResponse,
  TimelineResponse,
  TimelineScore,
  WorkerRequest
} from '$lib/sim/protocol';
import { TIMELINE_SCORE } from '../fixtures/timeline-score';

export class FakeScenarioWorker implements ScenarioWorkerLike {
  posts: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: ScenarioResponse }) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;

  postMessage(msg: WorkerRequest): void {
    this.posts.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(r: ScenarioResponse): void {
    this.onmessage?.({ data: r });
  }

  /** A script error in the worker. */
  crash(): void {
    this.onerror?.(new ErrorEvent('error', { message: 'boom' }));
  }

  /** The latest request of this type, or undefined. */
  lastOf<T extends WorkerRequest['type']>(
    type: T
  ): Extract<WorkerRequest, { type: T }> | undefined {
    for (let i = this.posts.length - 1; i >= 0; i--) {
      const p = this.posts[i];
      if (p.type === type) return p as Extract<WorkerRequest, { type: T }>;
    }
    return undefined;
  }

  /** The latest scenario `parcelSummary` request (T6: with `day`), or undefined. */
  lastSummary(): Extract<ScenarioRequest, { type: 'parcelSummary' }> | undefined {
    return this.lastOf('parcelSummary') as Extract<ScenarioRequest, { type: 'parcelSummary' }>;
  }

  /** Every request of this type, in order. */
  allOf<T extends WorkerRequest['type']>(type: T): Extract<WorkerRequest, { type: T }>[] {
    return this.posts.filter((p) => p.type === type) as Extract<WorkerRequest, { type: T }>[];
  }
}

/** A `timeline` answer with an empty render (revision 0 unless given). */
export function timelineMsg(
  rev: number,
  seed: number,
  o: { revision?: number; score?: TimelineScore; bandRuns?: number; bandRunsTotal?: number } = {}
): TimelineResponse {
  return {
    type: 'timeline',
    rev,
    seed,
    render: { revision: o.revision ?? 0, cells: [], removedCells: [], demolish: [] },
    score: o.score ?? TIMELINE_SCORE,
    bandRuns: o.bandRuns ?? 101,
    bandRunsTotal: o.bandRunsTotal ?? 101,
    complete: true
  };
}
