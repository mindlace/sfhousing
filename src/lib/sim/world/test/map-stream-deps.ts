// Test support: a `MapStreamDeps` over a city's chunk records. Browser-safe.
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru, type Lru } from '$lib/sim/lru';
import type { SimInput } from '$lib/sim/scenario/types';
import type { MapStreamDeps } from '../map-stream';

/**
 * Deps whose records answer for every record given, and whose cells are all ready unless `ready`
 * says otherwise. `massingCalls` counts `massing.memo.get` calls: one per `massingFor` call that
 * reaches the generator memo (massing.ts:119-129). `warnings` holds every `warnOnce` and
 * `logOnce` message, once per key.
 */
export function streamDeps(
  input: SimInput,
  records: Iterable<ParcelRecord>,
  o: { ready?: (cellId: string) => boolean; now?: () => number; massingCap?: number } = {}
): MapStreamDeps & { massingCalls(): number; warnings: string[] } {
  const byId = new Map<ParcelId, ParcelRecord>();
  for (const r of records) byId.set(r.id, r);
  const inner = createLru<string, GeneratedBuilding | null>(60_000);
  let calls = 0;
  const memo: Lru<string, GeneratedBuilding | null> = {
    get(key) {
      calls++;
      return inner.get(key);
    },
    set: (key, value) => inner.set(key, value),
    clear: () => inner.clear(),
    get size() {
      return inner.size;
    },
    cap: inner.cap
  };
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warnOnce = (key: string, msg: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(msg);
  };
  const deps: MapStreamDeps & { massingCalls(): number; warnings: string[] } = {
    massing: {
      input,
      records: (id) => byId.get(id),
      memo,
      gen: generate,
      genForUnits: generateForUnits,
      logOnce: (projectId, msg) => warnOnce(`massing:${projectId}`, msg)
    },
    cellReady: o.ready ?? (() => true),
    warnOnce,
    massingCalls: () => calls,
    warnings
  };
  if (o.now) deps.now = o.now;
  if (o.massingCap !== undefined) deps.massingCap = o.massingCap;
  return deps;
}
