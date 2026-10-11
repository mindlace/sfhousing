import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { createGeneratorCache } from './cache';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import std from './fixtures/std-25x100.json';

const P = std as unknown as ParcelRecord;

afterEach(() => vi.restoreAllMocks());

describe('createGeneratorCache (§4.12)', () => {
  it('same key returns the identical object', () => {
    const c = createGeneratorCache('fixture-0');
    const a = c.get(P, { maxStories: 5 });
    expect(a).not.toBeNull();
    expect(c.get(P, { maxStories: 5 })).toBe(a);
    expect(c.get(P, { maxStories: 5.9 })).toBe(a); // key uses floor(S)
    expect(a).toEqual(generate(P, { maxStories: 5 }, fnv1a32(P.id), 'max'));
  });
  it('a changed S recomputes', () => {
    const c = createGeneratorCache('fixture-0');
    const a = c.get(P, { maxStories: 5 });
    const b = c.get(P, { maxStories: 3 });
    expect(b).not.toBe(a);
    expect(b!.typology).toBe('plex');
  });
  it('S above 80 shares the clamped key', () => {
    const c = createGeneratorCache('fixture-0');
    expect(c.get(P, { maxStories: 200 })).toBe(c.get(P, { maxStories: 80 }));
  });
  it('invalid S → null without throwing', () => {
    const c = createGeneratorCache('fixture-0');
    expect(c.get(P, { maxStories: NaN })).toBeNull();
    expect(c.get(P, { maxStories: 0 })).toBeNull();
  });
  it('a throwing parcel yields null and logs once', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = createGeneratorCache('fixture-0');
    // malformed data now yields null inside generate; a throwing accessor still exercises the catch
    const bad = { ...P, id: 'bad' } as ParcelRecord;
    Object.defineProperty(bad, 'polygon', {
      get() {
        throw new Error('boom');
      }
    });
    expect(c.get(bad, { maxStories: 3 })).toBeNull();
    expect(c.get(bad, { maxStories: 4 })).toBeNull();
    expect(c.get(bad, { maxStories: 3 })).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/^\[generator\] bad: /);
  });
  it('null envelope → null without throwing', () => {
    const c = createGeneratorCache('fixture-0');
    expect(c.get(P, null as never)).toBeNull();
  });
  it('clear() drops memoised results', () => {
    const c = createGeneratorCache('fixture-0');
    const a = c.get(P, { maxStories: 5 });
    c.clear();
    const b = c.get(P, { maxStories: 5 });
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });
});
