import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLru, type Lru } from './lru';

/** The host's memo pattern: a hit returns the stored value, a miss produces and stores it. */
function lruGetOrCreate<V>(lru: Lru<string, V>, key: string, make: (key: string) => V): V {
  const hit = lru.get(key);
  if (hit !== undefined) return hit;
  const out = make(key);
  lru.set(key, out);
  return out;
}

describe('createLru', () => {
  it('returns undefined for a missing key and the stored value for a present one', () => {
    const lru = createLru<string, number | null>(2);
    expect(lru.get('a')).toBeUndefined();
    lru.set('a', 1);
    lru.set('n', null); // null is a value, not a miss
    expect(lru.get('a')).toBe(1);
    expect(lru.get('n')).toBeNull();
    expect(lru.size).toBe(2);
  });

  it('evicts the least recently used entry once the cap is exceeded', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.size).toBe(2);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe(2);
    expect(lru.get('c')).toBe(3);
  });

  it('a hit makes the entry most recent', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    lru.set('c', 3); // evicts b, not a
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
  });

  it('re-setting a present key replaces it without growing', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('a', 9);
    lru.set('c', 3); // evicts b
    expect(lru.size).toBe(2);
    expect(lru.get('a')).toBe(9);
    expect(lru.get('b')).toBeUndefined();
  });

  it('cap 0 stores nothing', () => {
    const lru = createLru<string, number>(0);
    lru.set('a', 1);
    expect(lru.size).toBe(0);
    expect(lru.get('a')).toBeUndefined();
  });

  it('clear empties it', () => {
    const lru = createLru<string, number>(3);
    lru.set('a', 1);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.get('a')).toBeUndefined();
  });

  it('rejects a cap that is not a non-negative integer', () => {
    expect(() => createLru(-1)).toThrow(RangeError);
    expect(() => createLru(1.5)).toThrow(RangeError);
    expect(() => createLru(Number.NaN)).toThrow(RangeError);
  });

  it('matches a reference LRU model over random operation sequences', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('get' as const), key: fc.integer({ min: 0, max: 9 }) }),
      fc.record({
        k: fc.constant('set' as const),
        key: fc.integer({ min: 0, max: 9 }),
        v: fc.integer()
      })
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), fc.array(op, { maxLength: 60 }), (cap, ops) => {
        const lru = createLru<number, number>(cap);
        let model: [number, number][] = []; // oldest first
        for (const o of ops) {
          const i = model.findIndex(([key]) => key === o.key);
          if (o.k === 'get') {
            const want = i < 0 ? undefined : model[i][1];
            if (i >= 0) model = [...model.slice(0, i), ...model.slice(i + 1), model[i]];
            expect(lru.get(o.key)).toBe(want);
          } else {
            if (i >= 0) model.splice(i, 1);
            model.push([o.key, o.v]);
            while (model.length > cap) model.shift();
            lru.set(o.key, o.v);
          }
          expect(lru.size).toBe(model.length);
        }
      })
    );
  });
});

describe('memo over the LRU: evicting never changes output', () => {
  // A deterministic producer that returns a fresh object per call (as generate does).
  const make = (key: string) => ({ key, parts: [{ topM: key.length * 3.1 }], units: key.length });

  it('fills past the cap; every evicted key regenerates a deep-equal result', () => {
    const lru = createLru<string, ReturnType<typeof make>>(4);
    const keys = Array.from({ length: 12 }, (_, i) => `p${i}|${(i % 5) + 3}`);
    const first = new Map(keys.map((k) => [k, lruGetOrCreate(lru, k, make)]));
    expect(lru.size).toBe(4);
    let regenerated = 0;
    for (const k of keys) {
      const was = first.get(k)!;
      const again = lruGetOrCreate(lru, k, make);
      if (again !== was) regenerated++;
      expect(again).toEqual(was);
      expect(again).toEqual(make(k));
    }
    expect(regenerated).toBeGreaterThan(0); // evictions really happened
  });

  it('a hit returns the stored object without calling the producer', () => {
    const lru = createLru<string, ReturnType<typeof make>>(2);
    let calls = 0;
    const counted = (k: string) => {
      calls++;
      return make(k);
    };
    const a = lruGetOrCreate(lru, 'a', counted);
    expect(lruGetOrCreate(lru, 'a', counted)).toBe(a);
    expect(calls).toBe(1);
  });

  it('memoises a null result', () => {
    const lru = createLru<string, null>(2);
    let calls = 0;
    const nil = () => {
      calls++;
      return null;
    };
    expect(lruGetOrCreate(lru, 'a', nil)).toBeNull();
    expect(lruGetOrCreate(lru, 'a', nil)).toBeNull();
    expect(calls).toBe(1);
  });
});
