import { describe, expect, it } from 'vitest';
import type { ZoningView } from './frame';
import {
  createViewCache,
  digest128,
  frameIdOf,
  murmur3x86_128,
  serialOf,
  VIEWS,
  type ViewInfo,
  type WeakLike
} from './intern';

const ascii = (s: string) => new TextEncoder().encode(s);
const hex = (h: [number, number, number, number]) =>
  h.map((x) => x.toString(16).padStart(8, '0')).join('');

/** Splits a 128-bit integer written as mmh3 prints it (little-endian bytes h1..h4) into h1..h4. */
function words(n: bigint): string {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    out.push(((n >> BigInt(32 * i)) & 0xffffffffn).toString(16).padStart(8, '0'));
  }
  return out.join('');
}

/** Two signed 64-bit halves (h2:h1, h4:h3) into h1..h4. */
function halves(lo: bigint, hi: bigint): string {
  const u = (x: bigint) => BigInt.asUintN(64, x);
  return words(u(lo) | (u(hi) << 64n));
}

describe('murmur3x86_128 (published vectors)', () => {
  // Vectors from the test suite of the Python mmh3 package (hajimes/mmh3, tests/test_mmh3.py),
  // which wraps Austin Appleby's reference MurmurHash3_x86_128 from SMHasher.
  it('matches the empty input with seed 0', () => {
    expect(hex(murmur3x86_128(ascii(''), 0))).toBe('0'.repeat(32));
  });

  it('matches the empty input with seed 123', () => {
    expect(hex(murmur3x86_128(ascii(''), 123))).toBe(words(0x26f3e79926f3e79926f3e799fedc5245n));
  });

  it("matches 'Hello, world!' with seed 123", () => {
    expect(hex(murmur3x86_128(ascii('Hello, world!'), 123))).toBe(
      words(0x9e37c886a41621625a1aacd761c9129en)
    );
  });

  it("matches 'The quick brown fox jumps over the lazy dog' with seed 0x9747b28c", () => {
    expect(
      hex(murmur3x86_128(ascii('The quick brown fox jumps over the lazy dog'), 0x9747b28c))
    ).toBe(halves(5528275682885686622n, -3623575540584727908n));
  });
});

describe('digest128', () => {
  it('is 32 lowercase hex characters and stable across calls', () => {
    const a = digest128('zoning|1|2|abc');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(digest128('zoning|1|2|abc')).toBe(a);
  });

  it('is seed 0 over the UTF-16LE code units', () => {
    const s = 'Hé\u{1F600}';
    const bytes = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      bytes[2 * i] = s.charCodeAt(i) & 0xff;
      bytes[2 * i + 1] = s.charCodeAt(i) >>> 8;
    }
    expect(digest128(s)).toBe(hex(murmur3x86_128(bytes, 0)));
  });

  it('differs for keys differing in one character, at every tail length', () => {
    for (let n = 1; n <= 20; n++) {
      const a = 'x'.repeat(n);
      const b = 'x'.repeat(n - 1) + 'y';
      expect(digest128(a)).not.toBe(digest128(b));
    }
    expect(digest128('')).not.toBe(digest128('\0'));
  });

  it('handles astral characters, telling surrogate pairs apart', () => {
    const a = digest128('lot\u{1F600}');
    const b = digest128('lot\u{1F601}');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(digest128('lot\u{1F600}')).toBe(a);
  });
});

describe('frameIdOf', () => {
  it('gives one id per distinct key, from 1, and the same id again later', () => {
    const a = frameIdOf('intern.spec|a');
    const b = frameIdOf('intern.spec|b');
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).not.toBe(a);
    expect(frameIdOf('intern.spec|c')).not.toBe(b);
    expect(frameIdOf('intern.spec|a')).toBe(a);
    expect(frameIdOf('intern.spec|b')).toBe(b);
  });
});

describe('serialOf', () => {
  it('is stable per object identity, from 1', () => {
    const o = {};
    const p = {};
    const s = serialOf(o);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(serialOf(o)).toBe(s);
    expect(serialOf(p)).not.toBe(s);
    expect(serialOf({})).not.toBe(serialOf({}));
  });
});

/** A `weak` whose refs the test can "collect". */
function fakeWeak() {
  const refs: { target: object | undefined }[] = [];
  const weak = <T extends object>(v: T): WeakLike<T> => {
    const r = { target: v as object | undefined };
    refs.push(r);
    return { deref: () => r.target as T | undefined };
  };
  const collect = (v: object) => {
    for (const r of refs) if (r.target === v) r.target = undefined;
  };
  return { weak, collect };
}

const view = (): ZoningView => ({ parcels: {} as never, pre: {} as never });
const info = (plan: number): ViewInfo => ({
  capacity: { plan, withoutProtections: plan + 1, protectedLots: 0 },
  unknownLots: 0
});

describe('createViewCache', () => {
  it('returns the stored view while live and misses an unknown key', () => {
    const { weak } = fakeWeak();
    const c = createViewCache(weak);
    const v = view();
    c.put('k', v, info(5));
    expect(c.get('k')).toBe(v);
    expect(c.get('other')).toBeUndefined();
    expect(c.size()).toBe(1);
  });

  it('drops a view no timeline refers to: get misses and size drops', () => {
    const { weak, collect } = fakeWeak();
    const c = createViewCache(weak);
    const v = view();
    const w = view();
    c.put('k', v, info(5));
    c.put('j', w, info(6));
    expect(c.size()).toBe(2);
    collect(v);
    expect(c.get('k')).toBeUndefined();
    expect(c.size()).toBe(1);
    expect(c.get('j')).toBe(w);
  });

  it('stores a new view under a key whose view was collected', () => {
    const { weak, collect } = fakeWeak();
    const c = createViewCache(weak);
    const v = view();
    c.put('k', v, info(5));
    collect(v);
    const v2 = view();
    c.put('k', v2, info(7));
    expect(c.get('k')).toBe(v2);
    expect(c.size()).toBe(1);
    expect(c.info(v2)?.capacity.plan).toBe(7);
  });

  it('keeps info with its view', () => {
    const { weak } = fakeWeak();
    const c = createViewCache(weak);
    const v = view();
    const w = view();
    c.put('k', v, info(5));
    c.put('j', w, { ...info(6), unknownLots: 3 });
    expect(c.info(v)).toEqual(info(5));
    expect(c.info(w)?.unknownLots).toBe(3);
    expect(c.info(view())).toBeUndefined();
  });

  it('defaults to real WeakRefs (the worker cache)', () => {
    const v = view();
    VIEWS.put('intern.spec|real', v, info(1));
    expect(VIEWS.get('intern.spec|real')).toBe(v);
    expect(VIEWS.info(v)).toEqual(info(1));
  });
});
