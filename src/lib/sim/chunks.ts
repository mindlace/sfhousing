// Worker host data layer: fetches parcel chunks with bounded concurrency, backoff and a
// dataset-version check (spec §4.9). Worker-bundle module: zod-free, DOM-free.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelRecord } from '$lib/data/parcel';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import type { ChunkStatus } from '$lib/map/types';
import type { ChunksResponse } from './protocol';

export interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}
export interface ChunkLoaderDeps {
  fetch: FetchLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  retryDelaysMs: readonly number[]; // [1000, 4000, 16000] in production
  maxConcurrent: number; // 4
  /** Called once per chunk, after its status is already 'ready'. */
  onLoaded(cellId: string, records: ParcelRecord[]): void;
  /** Called on every change of any chunk's mapped ChunkStatus. */
  onReport(r: Omit<ChunksResponse, 'type'>): void;
}
export interface ChunkLoader {
  /** Queues every listed cell that is idle (unknown cellIds are ignored). */
  want(cellIds: Iterable<string>): void;
  /** Failed cells start a fresh retry cycle. */
  retryFailed(): void;
  isReady(cellId: string): boolean;
  /** Stops timers; results of in-flight fetches are dropped. */
  dispose(): void;
}

type CellState = 'idle' | 'queued' | 'fetching' | 'waiting' | 'ready' | 'failed';
interface Cell {
  url: string;
  state: CellState;
  attempt: number;
  timer: unknown;
}

function mapped(s: CellState): ChunkStatus | undefined {
  switch (s) {
    case 'idle':
      return undefined;
    case 'ready':
      return 'ready';
    case 'failed':
      return 'error';
    default:
      return 'loading';
  }
}

export function createChunkLoader(manifest: Manifest, deps: ChunkLoaderDeps): ChunkLoader {
  const cells = new Map<string, Cell>();
  for (const c of manifest.chunks) {
    cells.set(c.cellId, { url: c.url, state: 'idle', attempt: 0, timer: undefined });
  }
  const queue: string[] = [];
  const reported = new Map<string, ChunkStatus>();
  let fetching = 0;
  let disposed = false;

  function report() {
    if (disposed) return;
    const status: Record<string, ChunkStatus> = {};
    let changed = false;
    let pending = 0;
    const failed: string[] = [];
    for (const [cellId, cell] of cells) {
      const now = mapped(cell.state);
      if (now === undefined) continue;
      const was = reported.get(cellId);
      if (now !== was) {
        changed = true;
        reported.set(cellId, now);
      }
      if (now !== was || now !== 'ready') status[cellId] = now;
      if (now === 'loading') pending++;
      else if (now === 'error') failed.push(cellId);
    }
    if (!changed) return;
    failed.sort();
    deps.onReport({ status, pending, failed });
  }

  function enqueue(cellId: string, cell: Cell) {
    cell.state = 'queued';
    queue.push(cellId);
  }

  function pump() {
    while (!disposed && fetching < deps.maxConcurrent && queue.length > 0) {
      const cellId = queue.shift()!;
      const cell = cells.get(cellId)!;
      if (cell.state !== 'queued') continue;
      cell.state = 'fetching';
      fetching++;
      void attempt(cellId, cell);
    }
  }

  async function load(cellId: string, cell: Cell): Promise<ParcelRecord[]> {
    const res = await deps.fetch(cell.url);
    if (!res.ok) throw new Error(`chunk ${cellId}: HTTP ${res.status}`);
    const raw = await res.json();
    if (typeof raw !== 'object' || raw === null) throw new Error(`chunk ${cellId}: not an object`);
    const o = raw as { datasetVersion?: unknown; cellId?: unknown };
    if (o.datasetVersion !== manifest.datasetVersion) {
      throw new Error(`chunk ${cellId}: datasetVersion ${String(o.datasetVersion)}`);
    }
    if (o.cellId !== cellId) throw new Error(`chunk ${cellId}: cellId ${String(o.cellId)}`);
    return decodeParcelChunk(raw);
  }

  async function attempt(cellId: string, cell: Cell) {
    let records: ParcelRecord[] | null;
    try {
      records = await load(cellId, cell);
    } catch {
      records = null;
    }
    if (disposed) return;
    fetching--;
    if (records) {
      cell.state = 'ready';
      report();
      try {
        deps.onLoaded(cellId, records);
      } catch (e) {
        console.error(`chunk ${cellId}: onLoaded threw`, e);
      }
    } else {
      const k = cell.attempt;
      if (k < deps.retryDelaysMs.length) {
        cell.state = 'waiting';
        cell.attempt = k + 1;
        cell.timer = deps.setTimeout(() => {
          cell.timer = undefined;
          if (disposed || cell.state !== 'waiting') return;
          enqueue(cellId, cell);
          pump();
        }, deps.retryDelaysMs[k]);
      } else {
        cell.state = 'failed';
        report();
      }
    }
    pump();
  }

  return {
    want(cellIds) {
      if (disposed) return;
      for (const cellId of cellIds) {
        const cell = cells.get(cellId);
        if (!cell || cell.state !== 'idle') continue;
        cell.attempt = 0;
        enqueue(cellId, cell);
      }
      report();
      pump();
    },
    retryFailed() {
      if (disposed) return;
      for (const [cellId, cell] of cells) {
        if (cell.state !== 'failed') continue;
        cell.attempt = 0;
        enqueue(cellId, cell);
      }
      report();
      pump();
    },
    isReady(cellId) {
      return cells.get(cellId)?.state === 'ready';
    },
    dispose() {
      disposed = true;
      for (const cell of cells.values()) {
        if (cell.timer !== undefined) {
          deps.clearTimeout(cell.timer);
          cell.timer = undefined;
        }
      }
      queue.length = 0;
    }
  };
}

/** cellIds whose manifest bbox intersects bbox ([w,s,e,n], inclusive), manifest order. */
export function cellsIntersecting(manifest: Manifest, bbox: readonly number[]): string[] {
  const [w, s, e, n] = bbox;
  return manifest.chunks
    .filter((c) => c.bbox[0] <= e && c.bbox[2] >= w && c.bbox[1] <= n && c.bbox[3] >= s)
    .map((c) => c.cellId);
}
