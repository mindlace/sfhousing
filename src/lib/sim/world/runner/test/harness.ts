// Test-only, Node-only: file- and map-backed fetches for the timeline host's dataset, and a fake
// clock for its timers. Test values, not data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, type Manifest } from '$lib/data/manifest';
import type { FetchLike } from '$lib/sim/chunks';
import type { FetchBytesLike } from '$lib/sim/scenario/load';

/** How an injected failure fails one fetch attempt (as the scenario host harness's `Failure`). */
export type Failure = { status: number } | 'reject' | 'body';

export interface MapFetch {
  fetch: FetchLike;
  fetchBytes: FetchBytesLike;
  /** Every URL requested, in order. */
  fetched: string[];
  fetchesOf(url: string): string[];
  /** The next `times` attempts at `url` fail as `how`. */
  fail(url: string, times: number, how: Failure): void;
}

/**
 * `fetch` (JSON, a fresh clone per read) and `fetchBytes` (a fresh `ArrayBuffer` per read) over
 * `body(url)`: undefined is a 404. Failures can be injected per URL.
 */
export function bodyFetch(body: (url: string) => unknown): MapFetch {
  const fetched: string[] = [];
  const failures = new Map<string, Failure[]>();
  function open<B>(url: string, read: (b: unknown) => B) {
    fetched.push(url);
    const how = failures.get(url)?.shift();
    if (how === 'reject') return Promise.reject(new TypeError(`fetch failed: ${url}`));
    if (how === 'body') {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: (): Promise<B> => Promise.reject(new TypeError(`body read failed: ${url}`))
      });
    }
    if (how !== undefined)
      return Promise.resolve({ ok: false, status: how.status, body: async () => read({}) });
    const b = body(url);
    return Promise.resolve(
      b === undefined
        ? { ok: false, status: 404, body: async () => read({}) }
        : { ok: true, status: 200, body: async () => read(b) }
    );
  }
  return {
    fetch: (url) =>
      open(url, (b) => structuredClone(b)).then((r) => ({
        ok: r.ok,
        status: r.status,
        json: () => r.body()
      })),
    fetchBytes: (url) =>
      open(url, (b) =>
        b instanceof Uint8Array ? (b.slice().buffer as ArrayBuffer) : new ArrayBuffer(0)
      ).then((r) => ({ ok: r.ok, status: r.status, arrayBuffer: () => r.body() })),
    fetched,
    fetchesOf: (url) => fetched.filter((u) => u === url),
    fail(url, times, how) {
      const q = failures.get(url) ?? [];
      for (let i = 0; i < times; i++) q.push(how);
      failures.set(url, q);
    }
  };
}

/** `bodyFetch` over a map of bodies (`Uint8Array` for binary files), as the scenario harness serves. */
export function mapFetch(bodies: ReadonlyMap<string, unknown>): MapFetch {
  return bodyFetch((url) => bodies.get(url));
}

/**
 * A dataset directory (`e2e/fixtures/data/fixture-0` or a pipeline output) served at
 * `/data/<datasetVersion>/`: JSON files parsed, every other file as bytes. A relative `dir` is
 * read from the repository root.
 */
export function datasetFetch(dir: string): {
  manifest: Manifest;
  fetch: FetchLike;
  fetchBytes: FetchBytesLike;
} {
  const root = fileURLToRoot();
  const base = dir.startsWith('/') ? dir : join(root, dir);
  const manifest = parseManifest(JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')));
  const prefix = `/data/${manifest.datasetVersion}/`;
  const f = bodyFetch((url) => {
    if (!url.startsWith(prefix)) return undefined;
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(base, url.slice(prefix.length)));
    } catch {
      return undefined;
    }
    return /\.(json|geojson)$/.test(url)
      ? JSON.parse(bytes.toString('utf8'))
      : new Uint8Array(bytes);
  });
  return { manifest, fetch: f.fetch, fetchBytes: f.fetchBytes };
}

const fileURLToRoot = (): string => fileURLToPath(new URL('../../../../../../', import.meta.url));

export interface FakeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(h: unknown): void;
  /** Charges `ms` of compute time: the clock moves without firing a timer. */
  tick(ms: number): void;
  /** Settles microtasks, then fires the earliest due timer (moving the clock to it) and settles again; false when none is pending. */
  runNext(): Promise<boolean>;
  /** Fires timers until `pred()` holds (settling first); throws when it never does within `max` timers. */
  runUntil(pred: () => boolean, max?: number): Promise<void>;
}

/** Node drains every microtask after a macrotask: a few turns settle the promise chains. */
const settle = async () => {
  for (let k = 0; k < 4; k++) await new Promise<void>((r) => setImmediate(r));
};

export function fakeClock(): FakeClock {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const next = (): [number, { at: number; fn: () => void }] | null => {
    let best: [number, { at: number; fn: () => void }] | null = null;
    for (const e of timers)
      if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0])) best = e;
    return best;
  };
  const clock: FakeClock = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    tick(ms) {
      t += ms;
    },
    async runNext() {
      await settle();
      const e = next();
      if (!e) return false;
      timers.delete(e[0]);
      t = Math.max(t, e[1].at);
      e[1].fn();
      await settle();
      return true;
    },
    async runUntil(pred, max = 10_000) {
      await settle();
      for (let k = 0; k < max; k++) {
        if (pred()) return;
        if (!(await clock.runNext())) break;
      }
      if (!pred()) throw new Error('runUntil: the condition never held');
    }
  };
  return clock;
}
