import type { LeverCapacity } from '$lib/sim/levers/resolve';
import type { ZoningView } from './frame';

// Interning by content (spec rule 17). Integer arithmetic only: `Math.imul`, shifts and `>>> 0`.

const C1 = 0x239b961b;
const C2 = 0xab0e9789;
const C3 = 0x38b34ae5;
const C4 = 0xa1e38b93;

const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** MurmurHash3_x86_128 (Appleby, SMHasher) over `bytes`; returns h1..h4 as unsigned 32-bit. */
export function murmur3x86_128(bytes: Uint8Array, seed: number): [number, number, number, number] {
  const len = bytes.length;
  const nblocks = len >>> 4;
  let h1 = seed | 0;
  let h2 = seed | 0;
  let h3 = seed | 0;
  let h4 = seed | 0;
  const word = (i: number) =>
    bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);

  for (let b = 0; b < nblocks; b++) {
    const i = b << 4;
    let k1 = word(i);
    let k2 = word(i + 4);
    let k3 = word(i + 8);
    let k4 = word(i + 12);

    k1 = Math.imul(rotl(Math.imul(k1, C1), 15), C2);
    h1 ^= k1;
    h1 = rotl(h1, 19);
    h1 = (h1 + h2) | 0;
    h1 = (Math.imul(h1, 5) + 0x561ccd1b) | 0;

    k2 = Math.imul(rotl(Math.imul(k2, C2), 16), C3);
    h2 ^= k2;
    h2 = rotl(h2, 17);
    h2 = (h2 + h3) | 0;
    h2 = (Math.imul(h2, 5) + 0x0bcaa747) | 0;

    k3 = Math.imul(rotl(Math.imul(k3, C3), 17), C4);
    h3 ^= k3;
    h3 = rotl(h3, 15);
    h3 = (h3 + h4) | 0;
    h3 = (Math.imul(h3, 5) + 0x96cd1c35) | 0;

    k4 = Math.imul(rotl(Math.imul(k4, C4), 18), C1);
    h4 ^= k4;
    h4 = rotl(h4, 13);
    h4 = (h4 + h1) | 0;
    h4 = (Math.imul(h4, 5) + 0x32ac3b17) | 0;
  }

  const t = nblocks << 4;
  const rest = len & 15;
  let k1 = 0;
  let k2 = 0;
  let k3 = 0;
  let k4 = 0;
  // The reference's fall-through switch on the tail length.
  for (let j = rest - 1; j >= 0; j--) {
    const v = bytes[t + j] << ((j & 3) << 3);
    if (j >= 12) k4 ^= v;
    else if (j >= 8) k3 ^= v;
    else if (j >= 4) k2 ^= v;
    else k1 ^= v;
  }
  if (rest > 12) h4 ^= Math.imul(rotl(Math.imul(k4, C4), 18), C1);
  if (rest > 8) h3 ^= Math.imul(rotl(Math.imul(k3, C3), 17), C4);
  if (rest > 4) h2 ^= Math.imul(rotl(Math.imul(k2, C2), 16), C3);
  if (rest > 0) h1 ^= Math.imul(rotl(Math.imul(k1, C1), 15), C2);

  h1 ^= len;
  h2 ^= len;
  h3 ^= len;
  h4 ^= len;

  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;

  h1 = fmix(h1);
  h2 = fmix(h2);
  h3 = fmix(h3);
  h4 = fmix(h4);

  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * MurmurHash3_x86_128, seed 0, over the string's UTF-16 code units as little-endian byte pairs:
 * 32 lowercase hex characters, h1 to h4. A collision needs about 2^64 distinct keys.
 */
export function digest128(s: string): string {
  const bytes = new Uint8Array(s.length << 1);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes[i << 1] = c & 0xff;
    bytes[(i << 1) + 1] = c >>> 8;
  }
  let out = '';
  for (const h of murmur3x86_128(bytes, 0)) out += h.toString(16).padStart(8, '0');
  return out;
}

/** Digest of a frame key to its id; never cleared, so it lives as long as the worker. */
const frameIds = new Map<string, number>();

/** Same key, same id, for the worker's life; ids from 1. */
export function frameIdOf(key: string): number {
  const d = digest128(key);
  let id = frameIds.get(d);
  if (id === undefined) {
    id = frameIds.size + 1;
    frameIds.set(d, id);
  }
  return id;
}

const serials = new WeakMap<object, number>();
let lastSerial = 0;

/** Stable per object identity, from 1: puts an input's identity into a key. */
export function serialOf(o: object): number {
  let s = serials.get(o);
  if (s === undefined) {
    s = ++lastSerial;
    serials.set(o, s);
  }
  return s;
}

export interface WeakLike<T> {
  deref(): T | undefined;
}

export interface ViewInfo {
  capacity: LeverCapacity;
  unknownLots: number;
}

/**
 * Zoning views by key, held weakly: a view lives while a timeline in use (or a compile in
 * progress) holds it strongly through its frames.
 */
export interface ViewCache {
  /** A live view, or undefined. */
  get(key: string): ZoningView | undefined;
  put(key: string, view: ZoningView, info: ViewInfo): void;
  info(view: ZoningView): ViewInfo | undefined;
  /** Live entries, for tests. */
  size(): number;
}

const realWeak = <T extends object>(v: T): WeakLike<T> => new WeakRef(v);

export function createViewCache(
  weak: <T extends object>(v: T) => WeakLike<T> = realWeak
): ViewCache {
  const refs = new Map<string, WeakLike<ZoningView>>();
  const infos = new WeakMap<ZoningView, ViewInfo>();
  const registry =
    typeof FinalizationRegistry === 'undefined'
      ? null
      : new FinalizationRegistry<{ key: string; ref: WeakLike<ZoningView> }>(({ key, ref }) => {
          if (refs.get(key) === ref) refs.delete(key);
        });

  return {
    get(key) {
      const ref = refs.get(key);
      if (ref === undefined) return undefined;
      const v = ref.deref();
      if (v === undefined) refs.delete(key);
      return v;
    },
    put(key, view, info) {
      const ref = weak(view);
      refs.set(key, ref);
      infos.set(view, info);
      registry?.register(view, { key, ref });
    },
    info(view) {
      return infos.get(view);
    },
    size() {
      for (const [key, ref] of refs) if (ref.deref() === undefined) refs.delete(key);
      return refs.size;
    }
  };
}

/** The worker's view cache. */
export const VIEWS: ViewCache = createViewCache();
