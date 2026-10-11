import type { ParcelRecord } from '../data/parcel';
import type { Envelope } from '../plan/types';
import { MAX_STORIES } from './constants';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import type { GeneratedBuilding } from './types';

export interface GeneratorCache {
  get(parcel: ParcelRecord, env: Envelope): GeneratedBuilding | null;
  clear(): void;
}

/**
 * Optional memo for the worker host, keyed by `parcelId|S` (S after floor and clamp). The
 * host creates a new cache when `datasetVersion` changes. Exceptions (bugs or bad data) are
 * caught: logged once per parcel, and the parcel contributes `null`.
 */
export function createGeneratorCache(_datasetVersion: string): GeneratorCache {
  const memo = new Map<string, GeneratedBuilding | null>();
  const logged = new Set<string>();
  return {
    get(parcel, env) {
      const f = Math.floor(env.maxStories);
      if (!Number.isFinite(f) || f < 1) return null;
      const key = parcel.id + '|' + Math.min(f, MAX_STORIES);
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      let out: GeneratedBuilding | null;
      try {
        out = generate(parcel, env, fnv1a32(parcel.id), 'max');
      } catch (e) {
        if (!logged.has(parcel.id)) {
          logged.add(parcel.id);
          console.error(`[generator] ${parcel.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
        out = null;
      }
      memo.set(key, out);
      return out;
    },
    clear() {
      memo.clear();
      logged.clear();
    }
  };
}
