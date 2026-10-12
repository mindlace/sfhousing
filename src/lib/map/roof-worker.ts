import {
  jsonBytes,
  parseRoofIndex,
  parseRoofHeader,
  ROOF_HEADER_MAX_BYTES,
  ROOF_CHUNK_MAX_BYTES,
  type RoofChunkRef,
  type DecodedRoofChunk
} from '$lib/data/building-roofs';
import { decodeRoofChunk } from '$lib/data/roof-codec';
import { readRoofBytes } from './roof-stream';
export type RoofWorkerRequest =
  | {
      type: 'load';
      requestId: number;
      datasetVersion: string;
      ref: RoofChunkRef;
      verifiedIndexEntryBytes: number;
    }
  | { type: 'cancel'; requestId: number };
export type RoofWorkerResponse =
  | { type: 'loaded'; requestId: number; chunk: DecodedRoofChunk }
  | { type: 'failed'; requestId: number; message: string };
async function checkHash(bytes: Uint8Array<ArrayBuffer>, expected: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('') !== expected)
    throw new Error('roof hash mismatch');
}
export async function loadRoofChunk(
  ref: RoofChunkRef,
  datasetVersion: string,
  verifiedIndexEntryBytes: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<DecodedRoofChunk> {
  // Validate URLs and declared bounds before either fetch or allocation.
  parseRoofIndex({ schemaVersion: 1, datasetVersion, chunks: [ref] }, datasetVersion);
  if (
    !Number.isSafeInteger(verifiedIndexEntryBytes) ||
    verifiedIndexEntryBytes <= 0 ||
    verifiedIndexEntryBytes + ref.headerBytes + ref.meshBytes > ROOF_CHUNK_MAX_BYTES
  )
    throw new Error('roof verified byte budget');
  const headerBytes = await readRoofBytes(
    await fetcher(ref.headerUrl, { signal }),
    ROOF_HEADER_MAX_BYTES,
    signal,
    ref.headerBytes
  );
  await checkHash(headerBytes, ref.headerSha256);
  signal.throwIfAborted();
  const header = parseRoofHeader(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes)),
    ref,
    datasetVersion,
    headerBytes.byteLength,
    verifiedIndexEntryBytes
  );
  const meshBytes = await readRoofBytes(
    await fetcher(ref.meshUrl, { signal }),
    ROOF_CHUNK_MAX_BYTES,
    signal,
    ref.meshBytes
  );
  await checkHash(meshBytes, ref.meshSha256);
  signal.throwIfAborted();
  return decodeRoofChunk(header, meshBytes.buffer);
}
// Importing the decoder in tests/main code does not install a window message handler.
interface WorkerScope {
  postMessage(message: RoofWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<RoofWorkerRequest>) => void
  ): void;
}
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const scope = self as unknown as WorkerScope;
  const jobs = new Map<number, AbortController>();
  scope.addEventListener('message', (event: MessageEvent<RoofWorkerRequest>) => {
    const request = event.data;
    if (request.type === 'cancel') {
      jobs.get(request.requestId)?.abort();
      return;
    }
    if (request.type !== 'load') return;
    if (jobs.has(request.requestId) || jobs.size >= 4) {
      scope.postMessage({
        type: 'failed',
        requestId: request.requestId,
        message: 'roof worker job limit'
      } satisfies RoofWorkerResponse);
      return;
    }
    const abort = new AbortController();
    jobs.set(request.requestId, abort);
    void loadRoofChunk(
      request.ref,
      request.datasetVersion,
      request.verifiedIndexEntryBytes ?? jsonBytes(request.ref),
      abort.signal
    )
      .then((chunk) => {
        abort.signal.throwIfAborted();
        scope.postMessage(
          { type: 'loaded', requestId: request.requestId, chunk } satisfies RoofWorkerResponse,
          [
            chunk.positions.buffer,
            chunk.normals.buffer,
            chunk.indices.buffer,
            chunk.pieceSlots.buffer
          ]
        );
      })
      .catch((error) => {
        scope.postMessage({
          type: 'failed',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error)
        } satisfies RoofWorkerResponse);
      })
      .finally(() => jobs.delete(request.requestId));
  });
}
