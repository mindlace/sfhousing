// A bounded least-recently-used map over Map insertion order (the worker host's generate memo).
// Worker-safe: no DOM, no zod. A hit moves the entry to the newest end; a set past the cap evicts
// the oldest. `undefined` means a miss, so V must not include undefined.
//
// Eviction keeps one long-lived keys() iterator as the "oldest" cursor instead of calling
// map.keys().next() each time: a fresh iterator must skip every deleted slot at the front of
// V8's ordered hash table, which made eviction-heavy runs measurably slower. Every slot behind
// the cursor has been deleted (evicted here, or moved to the end by a hit or re-set), so the
// next live key it yields is always the least recently used.

export interface Lru<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  clear(): void;
  readonly size: number;
  readonly cap: number;
}

export function createLru<K, V>(cap: number): Lru<K, V> {
  if (!Number.isInteger(cap) || cap < 0) {
    throw new RangeError(`LRU cap must be a non-negative integer, got ${cap}`);
  }
  const map = new Map<K, V>();
  let oldest = map.keys();
  return {
    get(key) {
      const v = map.get(key);
      if (v === undefined) return undefined;
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      map.delete(key);
      if (cap === 0) return;
      map.set(key, value);
      if (map.size > cap) {
        let r = oldest.next();
        if (r.done) {
          // Unreachable while size > cap ≥ 1 (every live key is ahead of the cursor); a guard.
          oldest = map.keys();
          r = oldest.next();
        }
        map.delete(r.value as K);
      }
    },
    clear() {
      map.clear();
      oldest = map.keys();
    },
    get size() {
      return map.size;
    },
    cap
  };
}
