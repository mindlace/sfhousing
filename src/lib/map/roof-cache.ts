import type { DecodedRoofChunk } from '$lib/data/building-roofs';
export const ROOF_CACHE_BYTES = 64 * 1024 * 1024;
type Entry = {
  decodedBytes: number;
  gpuBytes: number;
  chunk?: DecodedRoofChunk;
  retired: boolean;
  used: number;
};
/** Retired allocations count until their owner acknowledges actual release. */
export class RoofCache {
  private entries = new Map<string, Entry>();
  private visible = new Set<string>();
  private indexBytes = 0;
  private clock = 0;
  private destroyed = false;
  constructor(private options: { onEvict(id: string): void }) {}
  setIndexBytes(bytes: number): void {
    this.checkBytes(bytes);
    if (this.snapshot().totalBytes - this.indexBytes + bytes > ROOF_CACHE_BYTES)
      throw new Error('roof index budget');
    this.indexBytes = bytes;
  }
  setVisible(ids: readonly string[]): void {
    this.visible = new Set(ids);
  }
  reserve(id: string, decodedBytes: number, gpuBytes: number): boolean {
    this.checkBytes(decodedBytes);
    this.checkBytes(gpuBytes);
    if (this.destroyed || this.entries.has(id)) return false;
    const needed = decodedBytes + gpuBytes;
    if (needed + this.indexBytes > ROOF_CACHE_BYTES) return false;
    for (const [other, entry] of [...this.entries].sort((a, b) => a[1].used - b[1].used)) {
      if (this.snapshot().totalBytes + needed <= ROOF_CACHE_BYTES) break;
      if (entry.chunk && !entry.retired && !this.visible.has(other)) this.evict(other);
    }
    if (this.snapshot().totalBytes + needed > ROOF_CACHE_BYTES) return false;
    this.entries.set(id, { decodedBytes, gpuBytes, retired: false, used: ++this.clock });
    return true;
  }
  install(id: string, chunk: DecodedRoofChunk): void {
    const entry = this.entries.get(id);
    if (!entry || entry.retired) throw new Error('roof missing reservation');
    entry.chunk = chunk;
    this.touch(id);
  }
  reconcile(id: string, decodedBytes: number, gpuBytes: number): boolean {
    this.checkBytes(decodedBytes);
    this.checkBytes(gpuBytes);
    const entry = this.entries.get(id);
    if (!entry || entry.retired) return false;
    if (
      this.snapshot().totalBytes - entry.decodedBytes - entry.gpuBytes + decodedBytes + gpuBytes >
      ROOF_CACHE_BYTES
    )
      return false;
    entry.decodedBytes = decodedBytes;
    entry.gpuBytes = gpuBytes;
    return true;
  }
  touch(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.used = ++this.clock;
  }
  evict(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.retired) return;
    if (!entry.chunk) {
      this.entries.delete(id);
      return;
    }
    entry.retired = true;
    this.options.onEvict(id);
  }
  release(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.retired) this.entries.delete(id);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible.clear();
    for (const id of this.entries.keys()) this.evict(id);
    this.indexBytes = 0;
  }
  snapshot() {
    let ownedBytes = 0,
      reservedBytes = 0,
      decodedBytes = 0,
      gpuBytes = 0;
    for (const e of this.entries.values()) {
      if (e.chunk) {
        ownedBytes += e.decodedBytes + e.gpuBytes;
        decodedBytes += e.decodedBytes;
        gpuBytes += e.gpuBytes;
      } else reservedBytes += e.decodedBytes + e.gpuBytes;
    }
    return {
      ownedBytes,
      reservedBytes,
      decodedBytes,
      gpuBytes,
      indexBytes: this.indexBytes,
      totalBytes: ownedBytes + reservedBytes + this.indexBytes,
      retiredIds: [...this.entries].filter(([, e]) => e.retired).map(([id]) => id)
    };
  }
  private checkBytes(n: number) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid roof accounting bytes');
  }
}
