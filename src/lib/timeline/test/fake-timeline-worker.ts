// A fake timeline worker behind the real TimelineClient: records every request, emits responses on
// demand and crashes through `onerror`, as a real Worker would. Plus message builders over the
// hand-built chunks of `fixtures.ts` (test values, not data).
import type { ScenarioWorkerLike } from '$lib/sim/scenario-client';
import type { WorkerRequest } from '$lib/sim/scenario/types';
import type {
  TimelineErrorCode,
  TimelineHostRequest,
  TimelineHostResponse,
  TimelineResponse
} from '$lib/sim/timeline-protocol';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import { chunk } from './fixtures';

type Req = TimelineHostRequest;
type Of<T extends TimelineResponse['type']> = Extract<TimelineResponse, { type: T }>;

export class FakeTimelineWorker implements ScenarioWorkerLike {
  posts: Req[] = [];
  terminated = false;
  onmessage: ScenarioWorkerLike['onmessage'] = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;

  postMessage(msg: WorkerRequest): void {
    this.posts.push(msg as unknown as Req);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(r: TimelineHostResponse): void {
    this.onmessage?.({ data: r as never });
  }

  /** A script error in the worker. */
  crash(): void {
    this.onerror?.(new ErrorEvent('error', { message: 'boom' }));
  }

  /** Every request of this type, in order. */
  all<T extends Req['type']>(type: T): Extract<Req, { type: T }>[] {
    return this.posts.filter((p) => p.type === type) as Extract<Req, { type: T }>[];
  }

  /** The latest request of this type, or undefined. */
  lastOf<T extends Req['type']>(type: T): Extract<Req, { type: T }> | undefined {
    return this.all(type).at(-1);
  }
}

export const compiledMsg = (
  rev: number,
  statics: ScoreStatics,
  unknownLots = 0
): Of<'compiled'> => ({
  type: 'compiled',
  rev,
  capacity: { rev } as unknown as Of<'compiled'>['capacity'],
  unknownLots,
  statics
});

/** Months `from` to `from + n - 1` at `rev`. */
export const filledMsg = (rev: number, from: number, n: number): Of<'filled'> => ({
  type: 'filled',
  rev,
  through: from + n - 1,
  series: chunk(from, n)
});

export const refillMsg = (rev: number, from: number): Of<'refill'> => ({
  type: 'refill',
  rev,
  from
});

export const errorMsg = (rev: number, code: TimelineErrorCode): Of<'error'> => ({
  type: 'error',
  rev,
  code,
  message: code
});

export const compilingMsg = (rev: number, failedCells: string[] = []): Of<'compiling'> => ({
  type: 'compiling',
  rev,
  done: 1,
  total: 2,
  failedCells
});
