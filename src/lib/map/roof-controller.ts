import type { Layer } from '@deck.gl/core';
import {
  jsonBytes,
  parseRoofIndex,
  ROOF_INDEX_MAX_BYTES,
  type RoofChunkRef,
  type RoofIndex,
  type DecodedRoofChunk
} from '$lib/data/building-roofs';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BBox } from '$lib/plan';
import { roofArtifactUrls } from '$lib/data/roof-paths';
import type { ExistingBuildings } from './existing-buildings';
import type { LayerComposer } from './layer-composer';
import { roofGpuBytes, type RoofMeshLayerProps } from './roof-layer';
import { RoofCache } from './roof-cache';
import { readRoofBytes } from './roof-stream';
import type { RoofWorkerClient } from './roof-worker-client';
import type { Theme } from './types';
type RoofLayer = Layer<RoofMeshLayerProps> & {
  readonly gpuBytes: number;
  cancelPreparation(): boolean;
};
type Resident = {
  ref: RoofChunkRef;
  chunk: DecodedRoofChunk;
  layer?: RoofLayer;
  owner?: RoofLayer;
  status: 'queued' | 'preparing' | 'active' | 'retired';
  revision: number;
};
type Job = { abort: AbortController; ref: RoofChunkRef };
type Options = {
  manifest: Manifest;
  existing: ExistingBuildings;
  composer: LayerComposer;
  worker: Pick<RoofWorkerClient, 'load' | 'destroy'>;
  fetch: typeof fetch;
  now(): number;
  raf(callback: FrameRequestCallback): number;
  cancelRaf(id: number): void;
  createLayer(props: RoofMeshLayerProps): Layer;
  onDiagnostic(message: string): void;
};
const uniformBytes = roofGpuBytes({
  positions: new Float32Array(),
  normals: new Float32Array(),
  indices: new Uint32Array(),
  pieceSlots: new Uint32Array()
} as DecodedRoofChunk);
const intersects = (a: readonly number[], b: readonly number[]) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
/** Loaded lazily with deck: importing the GPU estimator intentionally remains in this chain. */
export class RoofController {
  private cache: RoofCache;
  private index?: RoofIndex;
  private indexStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private indexAbort?: AbortController;
  private indexRetryAt = 0;
  private entryBytes = new Map<string, number>();
  private failures = new Map<string, number>();
  private jobs = new Map<string, Job>();
  private residents = new Map<string, Resident>();
  private membership = new Map<ParcelId, Set<string>>();
  private wanted: RoofChunkRef[] = [];
  private bbox?: BBox;
  private center: [number, number] = [0, 0];
  private zoom = 0;
  private frame: number | null = null;
  private hidden: ReadonlySet<ParcelId>;
  private theme: Theme = 'light';
  private destroyed = false;
  private scheduling = false;
  private readonly version: string;
  constructor(private options: Options) {
    this.version = options.manifest.datasetVersion;
    this.hidden = options.existing.hidden;
    this.cache = new RoofCache({ onEvict: (id) => this.retire(id) });
  }
  updateViewport(bbox: BBox, zoom: number, center: [number, number]): void {
    if (this.destroyed) return;
    this.bbox = [...bbox];
    this.zoom = zoom;
    this.center = [...center];
    if (zoom < 15) {
      this.indexAbort?.abort();
      this.select();
      return;
    }
    if (!this.index && this.indexStatus !== 'loading' && this.options.now() >= this.indexRetryAt)
      void this.loadIndex();
    this.select();
  }
  setHidden(hidden: ReadonlySet<ParcelId>, changed?: readonly ParcelId[]): void {
    if (this.destroyed) return;
    this.hidden = hidden;
    const ids = changed
      ? new Set(changed.flatMap((id) => [...(this.membership.get(id) ?? [])]))
      : new Set(this.residents.keys());
    this.options.composer.transaction(() => {
      for (const id of ids) {
        const resident = this.residents.get(id);
        if (!resident || resident.status === 'retired') continue;
        resident.revision++;
        if (resident.layer)
          resident.layer = resident.layer.clone({
            hidden,
            visibilityRevision: resident.revision
          }) as RoofLayer;
      }
      this.publish();
    });
  }
  setTheme(theme: Theme): void {
    if (this.destroyed || theme === this.theme) return;
    this.theme = theme;
    for (const r of this.residents.values())
      if (r.layer && r.status !== 'retired') r.layer = r.layer.clone({ theme }) as RoofLayer;
    this.publish();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.indexAbort?.abort();
    if (this.frame !== null) this.options.cancelRaf(this.frame);
    this.frame = null;
    for (const job of this.jobs.values()) job.abort.abort();
    // Termination releases worker ownership synchronously, before clearing reservations.
    this.options.worker.destroy();
    this.jobs.clear();
    this.wanted = [];
    this.options.composer.transaction(() => this.cache.destroy());
    this.index = undefined;
    this.entryBytes.clear();
    this.failures.clear();
    this.membership.clear();
  }
  snapshot() {
    return {
      ...this.cache.snapshot(),
      indexStatus: this.indexStatus,
      inFlight: this.jobs.size,
      chunks: Object.fromEntries(
        [...this.residents]
          .map(([id, r]) => [id, r.status])
          .concat(
            [...this.jobs.keys()].map((id) => [id, 'loading']),
            [...this.failures.keys()].map((id) => [id, 'error'])
          )
      ),
      activePieceIds: [...this.residents.values()]
        .filter((r) => r.status === 'active')
        .flatMap((r) => r.chunk.header.pieces.map((p) => p.pieceId))
    };
  }
  private async loadIndex() {
    const descriptor = this.options.manifest.buildingRoofs;
    if (!descriptor || descriptor.schemaVersion !== 1) return;
    const abort = new AbortController();
    this.indexAbort = abort;
    this.indexStatus = 'loading';
    try {
      roofArtifactUrls(descriptor, undefined);
      // Account the bounded input allocation while the index is being read.
      this.cache.setIndexBytes(ROOF_INDEX_MAX_BYTES);
      const bytes = await readRoofBytes(
        await this.options.fetch(descriptor.indexUrl, { signal: abort.signal }),
        ROOF_INDEX_MAX_BYTES,
        abort.signal
      );
      const parsed = parseRoofIndex(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        this.version
      );
      roofArtifactUrls(descriptor, parsed);
      if (this.destroyed) return;
      abort.signal.throwIfAborted();
      const canonical = new TextEncoder().encode(JSON.stringify(parsed));
      const exact =
        bytes.length === canonical.length && bytes.every((byte, i) => byte === canonical[i]);
      for (const ref of parsed.chunks)
        this.entryBytes.set(ref.chunkId, exact ? jsonBytes(ref) : bytes.length);
      this.cache.setIndexBytes(bytes.length);
      this.index = parsed;
      this.indexStatus = 'ready';
    } catch (error) {
      if (this.destroyed) return;
      this.cache.setIndexBytes(0);
      if (abort.signal.aborted) this.indexStatus = 'idle';
      else {
        this.indexStatus = 'error';
        this.indexRetryAt = this.options.now() + 30000;
        this.diagnostic(error);
      }
    } finally {
      if (this.indexAbort === abort) this.indexAbort = undefined;
      if (!this.destroyed) {
        if (this.zoom >= 15 && this.indexStatus === 'idle') void this.loadIndex();
        this.select();
      }
    }
  }
  private select() {
    if (this.destroyed) return;
    const bbox = this.bbox;
    if (this.zoom >= 15 && bbox && this.index) {
      const w = bbox[2] - bbox[0],
        h = bbox[3] - bbox[1];
      const expanded = [bbox[0] - w, bbox[1] - h, bbox[2] + w, bbox[3] + h];
      const distance = (r: RoofChunkRef) =>
        ((r.bbox[0] + r.bbox[2]) / 2 - this.center[0]) ** 2 +
        ((r.bbox[1] + r.bbox[3]) / 2 - this.center[1]) ** 2;
      this.wanted = this.index.chunks
        .filter((ref) => intersects(ref.bbox, expanded))
        .sort((a, b) => distance(a) - distance(b) || a.chunkId.localeCompare(b.chunkId));
    } else this.wanted = [];
    const ids = new Set(this.wanted.map((r) => r.chunkId));
    this.cache.setVisible([...ids]);
    for (const [id, job] of this.jobs) if (!ids.has(id)) job.abort.abort();
    this.options.composer.transaction(() => {
      for (const [id, r] of this.residents)
        if (!ids.has(id) && r.status !== 'retired') this.cache.evict(id);
    });
    this.schedule();
    this.queueFrame();
  }
  private schedule() {
    if (this.destroyed || this.scheduling) return;
    this.scheduling = true;
    try {
      for (const ref of this.wanted) {
        const id = ref.chunkId;
        if (
          this.jobs.has(id) ||
          this.residents.has(id) ||
          this.options.now() < (this.failures.get(id) ?? 0)
        )
          continue;
        if (this.jobs.size >= 4) {
          this.displaceFarther(ref);
          break;
        }
        // Worker input + decoded output + main-thread picking/visibility staging; shrink on ready.
        const cpu = 3 * ref.meshBytes + 2 * ref.headerBytes;
        const gpu = Math.ceil((ref.meshBytes * 10) / 7) + uniformBytes;
        if (!this.cache.reserve(id, cpu, gpu)) {
          this.displaceFarther(ref);
          break; // admissions resume on ownership release, never in a per-frame retry loop
        }
        this.failures.delete(id);
        const job = { abort: new AbortController(), ref };
        this.jobs.set(id, job);
        void this.options.worker
          .load(ref, this.version, job.abort.signal, this.entryBytes.get(id)!)
          .then((chunk) => {
            if (this.destroyed || job.abort.signal.aborted) return;
            this.cache.install(id, chunk);
            const resident: Resident = { ref, chunk, status: 'queued', revision: 0 };
            this.residents.set(id, resident);
            for (const piece of chunk.header.pieces)
              if (piece.parcelId !== null) {
                const parcel = piece.parcelId as ParcelId;
                let ids = this.membership.get(parcel);
                if (!ids) {
                  ids = new Set();
                  this.membership.set(parcel, ids);
                }
                ids.add(id);
              }
          })
          .catch((error) => {
            if (!this.destroyed && !job.abort.signal.aborted) {
              this.failures.set(id, this.options.now() + 30000);
              this.diagnostic(error);
            }
          })
          .finally(() => {
            if (this.jobs.get(id) !== job) return;
            this.jobs.delete(id);
            if (!this.residents.has(id)) this.cache.evict(id);
            if (!this.destroyed) {
              this.schedule();
              this.queueFrame();
            }
          });
      }
    } finally {
      this.scheduling = false;
    }
  }
  private displaceFarther(ref: RoofChunkRef) {
    // Reprioritize a changed viewport without repeatedly retiring work while release is pending.
    if (
      this.cache.snapshot().retiredIds.length ||
      [...this.jobs.values()].some((job) => job.abort.signal.aborted)
    )
      return;
    const priority = this.wanted.indexOf(ref);
    for (let i = this.wanted.length - 1; i > priority; i--) {
      const id = this.wanted[i].chunkId;
      if (this.residents.has(id)) {
        this.cache.evict(id);
        return;
      }
      const job = this.jobs.get(id);
      if (job) {
        job.abort.abort();
        return;
      }
    }
  }
  private queueFrame() {
    if (
      this.destroyed ||
      this.frame !== null ||
      !this.wanted.some((ref) => this.residents.get(ref.chunkId)?.status === 'queued')
    )
      return;
    this.frame = this.options.raf(() => {
      this.frame = null;
      if (this.destroyed) return;
      const ref = this.wanted.find((ref) => this.residents.get(ref.chunkId)?.status === 'queued');
      if (ref) this.prepare(this.residents.get(ref.chunkId)!);
      this.queueFrame();
    });
  }
  private prepare(resident: Resident) {
    const id = resident.ref.chunkId;
    resident.status = 'preparing';
    try {
      const props: RoofMeshLayerProps = {
        chunk: resident.chunk,
        hidden: this.hidden,
        visibilityRevision: resident.revision,
        theme: this.theme,
        active: false,
        onReady: () => this.ready(resident),
        onFailure: (error) => {
          if (this.destroyed || resident.status === 'retired') return;
          this.failures.set(id, this.options.now() + 30000);
          this.diagnostic(error);
          this.cache.evict(id);
        },
        onFinalize: () => {
          if (resident.status !== 'retired') return;
          this.cache.release(id);
          this.residents.delete(id);
          // Callback runs inside deck cleanup: defer admissions until that stack relinquishes props.
          queueMicrotask(() => {
            if (!this.destroyed) {
              this.schedule();
              this.queueFrame();
            }
          });
        }
      };
      resident.layer = this.options.createLayer(props) as RoofLayer;
      resident.owner = resident.layer;
      this.publish();
    } catch (error) {
      this.failures.set(id, this.options.now() + 30000);
      this.diagnostic(error);
      this.cache.evict(id);
    }
  }
  private ready(resident: Resident) {
    if (this.destroyed || resident.status !== 'preparing' || !resident.layer) return;
    const gpu = resident.owner!.gpuBytes;
    if (
      !Number.isSafeInteger(gpu) ||
      gpu <= 0 ||
      !this.cache.reconcile(
        resident.ref.chunkId,
        resident.ref.meshBytes + resident.ref.headerBytes,
        gpu
      )
    ) {
      this.cache.evict(resident.ref.chunkId);
      return;
    }
    this.options.composer.transaction(() => {
      resident.layer = resident.layer!.clone({
        active: true,
        hidden: this.hidden,
        visibilityRevision: resident.revision
      }) as RoofLayer;
      resident.status = 'active';
      this.options.existing.setRoofReady(
        resident.chunk.header.pieces.map((p) => p.pieceId),
        true
      );
      this.publish();
    });
    this.schedule();
  }
  private retire(id: string) {
    const resident = this.residents.get(id);
    if (!resident) {
      this.cache.release(id);
      return;
    }
    this.options.composer.transaction(() => {
      this.options.existing.setRoofReady(
        resident.chunk.header.pieces.map((p) => p.pieceId),
        false
      );
      resident.status = 'retired';
      this.publish();
      for (const p of resident.chunk.header.pieces)
        if (p.parcelId !== null) {
          const ids = this.membership.get(p.parcelId as ParcelId);
          ids?.delete(id);
          if (!ids?.size) this.membership.delete(p.parcelId as ParcelId);
        }
      if (resident.owner) resident.owner.cancelPreparation();
      else {
        this.residents.delete(id);
        this.cache.release(id);
      }
    });
  }
  private publish() {
    this.options.composer.setRoofs(
      [...this.residents.values()]
        .filter((r) => r.status !== 'retired' && r.layer)
        .map((r) => r.layer!)
    );
  }
  private diagnostic(error: unknown) {
    this.options.onDiagnostic(error instanceof Error ? error.message : String(error));
  }
}

export type RoofControllerSnapshot = ReturnType<RoofController['snapshot']>;
