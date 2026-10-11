// A bounded least-recently-used map over Map insertion order (the worker host's generate memo).
// Worker-safe: no DOM, no zod. A hit moves the entry to the newest end; a set past the cap evicts
// the oldest. `undefined` means a miss, so V must not include undefined.

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
      if (map.size > cap) map.delete(map.keys().next().value as K);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    cap
  };
}
