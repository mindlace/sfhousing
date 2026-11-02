// A fake playback worker behind the real PlaybackClient: records every request, emits responses
// on demand and crashes through `onerror`, as a real Worker would.
import type { PlaybackInbound, PlaybackWorkerLike } from '../playback-client';
import type { WorkerRequest } from '$lib/sim/scenario/types';

export class FakePlaybackWorker implements PlaybackWorkerLike {
  posts: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: PlaybackInbound }) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;

  postMessage(msg: WorkerRequest): void {
    this.posts.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(r: PlaybackInbound): void {
    this.onmessage?.({ data: r });
  }

  /** A script error in the worker. */
  crash(): void {
    this.onerror?.(new Event('error') as ErrorEvent);
  }

  /** A message that failed to deserialise. */
  messageError(): void {
    this.onmessageerror?.(new Event('messageerror') as MessageEvent);
  }

  /** The reqId of the last posted playbackCard, or -1. */
  lastReqId(): number {
    for (let i = this.posts.length - 1; i >= 0; i--) {
      const p = this.posts[i];
      if (p.type === 'playbackCard') return p.reqId;
    }
    return -1;
  }
}
