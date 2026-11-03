// A fake editor worker behind the real SimClient (`/`'s BrushEditor): records every request and
// emits responses on demand, as a real Worker would.
import type { WorkerLike } from '$lib/sim/client';
import type { SimRequest, SimResponse } from '$lib/sim/protocol';

export class FakeEditorWorker implements WorkerLike {
  posts: SimRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: SimResponse }) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(msg: SimRequest): void {
    this.posts.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(r: SimResponse): void {
    this.onmessage?.({ data: r });
  }

  /** The worker answers init: ready (rev 1, as the first init is). */
  ready(rev = 1): void {
    this.emit({ type: 'ready', rev, datasetVersion: 'fixture-0', chunkCount: 4 });
  }

  /** Every request of this type, in order. */
  allOf<T extends SimRequest['type']>(type: T): Extract<SimRequest, { type: T }>[] {
    return this.posts.filter((p) => p.type === type) as Extract<SimRequest, { type: T }>[];
  }

  /** The latest request of this type, or undefined. */
  lastOf<T extends SimRequest['type']>(type: T): Extract<SimRequest, { type: T }> | undefined {
    return this.allOf(type).at(-1);
  }

  /** The request types, in order. */
  types(): SimRequest['type'][] {
    return this.posts.map((p) => p.type);
  }
}
