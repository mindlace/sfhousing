import { jsonBytes, type RoofChunkRef, type DecodedRoofChunk } from '$lib/data/building-roofs';
import type { RoofWorkerRequest, RoofWorkerResponse } from './roof-worker';
type Pending = {
  resolve(chunk: DecodedRoofChunk): void;
  reject(error: Error): void;
  signal: AbortSignal;
  abort(): void;
};
export class RoofWorkerClient {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private destroyed = false;
  constructor(
    private createWorker = () =>
      new Worker(new URL('./roof-worker.ts', import.meta.url), { type: 'module' })
  ) {}
  load(
    ref: RoofChunkRef,
    datasetVersion: string,
    signal: AbortSignal,
    verifiedIndexEntryBytes = jsonBytes(ref)
  ): Promise<DecodedRoofChunk> {
    if (this.destroyed) return Promise.reject(new Error('roof worker destroyed'));
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.addEventListener('message', this.message);
          this.worker.addEventListener('error', this.error);
          this.worker.addEventListener('messageerror', this.error);
        }
        const requestId = ++this.nextId;
        // Keep the promise/reservation pending until the worker acknowledges cancellation.
        const abort = () =>
          this.worker?.postMessage({ type: 'cancel', requestId } satisfies RoofWorkerRequest);
        this.pending.set(requestId, { resolve, reject, signal, abort });
        signal.addEventListener('abort', abort, { once: true });
        this.worker.postMessage({
          type: 'load',
          requestId,
          ref,
          datasetVersion,
          verifiedIndexEntryBytes
        } satisfies RoofWorkerRequest);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        reject(error);
      }
    });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fail(new Error('roof worker destroyed'));
  }
  private message = (event: MessageEvent<RoofWorkerResponse>) => {
    const response = event.data;
    if (response.type !== 'loaded' && response.type !== 'failed') return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    pending.signal.removeEventListener('abort', pending.abort);
    if (pending.signal.aborted) pending.reject(new DOMException('Aborted', 'AbortError'));
    else if (response.type === 'loaded') pending.resolve(response.chunk);
    else pending.reject(new Error(response.message));
  };
  private error = () => this.fail(new Error('roof worker failed'));
  private fail(error: Error) {
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      pending.signal.removeEventListener('abort', pending.abort);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
